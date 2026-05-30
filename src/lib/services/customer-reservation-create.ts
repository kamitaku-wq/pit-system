// Phase 64-A.29: 顧客予約作成 (customer-facing, service_role)。
// ---------------------------------------------------------------------------
//
// spec/requirements.md §12.1 顧客予約フロー (真の源)。roadmap β-3 Lane B の中核。
//
// 顧客は Supabase Auth user ではないため company scope を引数で受け取れない。
// 選択された店舗 (storeId) から companyId を導出し (token-first ではなく store-first)、
// lane / workMenu が同一 company に属することを cross-tenant 検証してから INSERT する
// (FK は同一 company を保証しないため、A.24 の「join では company_id を信用しない」規律を踏襲)。
//
// 作成タイミング (A.29 ユーザー判断): 認証後に 'confirmed' で作成 (create-on-confirm)。
//   → email 6 桁コード検証は本 service の呼び出し前 (route 層 / 後続 phase) で行う。
//     本 service は「検証済みの予約を 1 件確定作成する」write core に責務を限定する。
//   → reservation status は seed 済みの 'confirmed' (is_initial=true) を割り当て。
//
// 二重予約は DB の exclusion 制約 (reservations_no_overlap: store+lane+tstzrange) が
// 最終防衛線。violation (23P01) は tx を abort させるため、savepoint/tx の外で捕捉して
// slot_unavailable に map する (tx 内 catch では aborted-transaction で COMMIT 失敗するため)。
//
// 顧客・車両は入力値から新規作成する (customers / vehicles に UNIQUE 制約なし、MVP は dedup 非対応)。
//   → 既存顧客・既存車両とのマッチング/マージは将来 phase (admin 側で運用)。
//
// availability (営業時間 / 定休日 / lane 稼働時間 / reservation_settings 予約可能枠) の
// サーバ側検証は本 service には **含めない** (記録された deferral)。
//   → 公開 route で本 service を露出する phase (A.30 以降) は、空き枠 picker と共有する
//     availability 検証を本 service 呼び出し前に必ず実施すること (untrusted client 入力の gate)。
//     本 service は cross-tenant 整合 + 二重予約 (exclusion) のみを保証する。
//
// spec/CLAUDE.md §ADR-0010 補項 (顧客 facing は service_role 利用境界) / ADR-0011 use-case canonical 準拠。

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db as serviceRoleDb } from "@/lib/db/client";
import { auditLogs } from "@/lib/db/schema/audit_logs";
import { customers } from "@/lib/db/schema/customers";
import { lanes } from "@/lib/db/schema/lanes";
import { reservations } from "@/lib/db/schema/reservations";
import { reservationStatusHistory } from "@/lib/db/schema/reservation_status_history";
import { statuses } from "@/lib/db/schema/statuses";
import { stores } from "@/lib/db/schema/stores";
import { vehicles } from "@/lib/db/schema/vehicles";
import { workMenus } from "@/lib/db/schema/work_menus";

// Drizzle does not expose a common DB/transaction interface that fits this project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type CreateCustomerReservationOptions = {
  ipAddress?: string | null;
  userAgent?: string | null;
  db?: Db;
};

// 顧客情報入力 (spec §12.1 step 4)。fullName のみ必須。
// A.31b: 公開予約 wrapper (createPublicReservation) が同一形状を再利用するため export
// (顧客/車両入力の契約を 1 箇所に集約し drift を防ぐ)。
export const customerInputSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  fullNameKana: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().max(50).optional(),
  postalCode: z.string().trim().max(20).optional(),
  address: z.string().trim().max(500).optional(),
});

// 車両情報入力 (spec §12.1 step 5)。全項目任意 (最低限 registrationNumber 想定だが強制しない)。
// A.31b: 公開予約 wrapper が再利用するため export。
export const vehicleInputSchema = z.object({
  registrationNumber: z.string().trim().max(50).optional(),
  vin: z.string().trim().max(64).optional(),
  maker: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  modelYear: z.number().int().min(1900).max(2200).optional(),
  color: z.string().trim().max(50).optional(),
});

export const createCustomerReservationSchema = z
  .object({
    storeId: z.string().uuid(),
    laneId: z.string().uuid(),
    workMenuId: z.string().uuid().optional(),
    customer: customerInputSchema,
    vehicle: vehicleInputSchema,
    startAt: z.date(),
    endAt: z.date(),
    durationMinutes: z
      .number()
      .int()
      .positive()
      .max(24 * 60)
      .optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.startAt.getTime() < v.endAt.getTime(), {
    message: "startAt must be before endAt",
    path: ["endAt"],
  });

export type CreateCustomerReservationInput = z.infer<typeof createCustomerReservationSchema>;

export type CreateCustomerReservationResult =
  | {
      ok: true;
      reservationId: string;
      customerId: string;
      vehicleId: string;
      statusId: string;
    }
  | {
      ok: false;
      reason:
        | "store_not_found"
        | "lane_not_found"
        | "work_menu_not_found"
        | "status_not_seeded"
        | "slot_unavailable";
    };

// reservations_no_overlap EXCLUDE 制約違反 (二重予約)。
function isExclusionViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return (err as { code?: unknown }).code === "23P01";
}

export async function createCustomerReservation(
  rawInput: CreateCustomerReservationInput,
  options: CreateCustomerReservationOptions = {},
): Promise<CreateCustomerReservationResult> {
  const input = createCustomerReservationSchema.parse(rawInput);
  const baseDb: Db = options.db ?? serviceRoleDb;

  try {
    return await baseDb.transaction(async (tx: Db): Promise<CreateCustomerReservationResult> => {
      // 1) store から company を導出 (store-first)。soft-deleted / inactive な店舗には予約不可
      //    (defense-in-depth: company 検証と同じく「存在 ≠ 予約可能」を service で強制)。
      const storeRows = await tx
        .select({ id: stores.id, companyId: stores.companyId })
        .from(stores)
        .where(
          and(eq(stores.id, input.storeId), isNull(stores.deletedAt), eq(stores.isActive, true)),
        )
        .limit(1);
      if (storeRows.length === 0) {
        return { ok: false, reason: "store_not_found" };
      }
      const companyId: string = storeRows[0].companyId;

      // 2) lane が同一 company に属し、有効 (not-deleted / active) であることを検証
      //    (FK は company も削除状態も保証しない)。
      const laneRows = await tx
        .select({ id: lanes.id })
        .from(lanes)
        .where(
          and(
            eq(lanes.id, input.laneId),
            eq(lanes.companyId, companyId),
            isNull(lanes.deletedAt),
            eq(lanes.isActive, true),
          ),
        )
        .limit(1);
      if (laneRows.length === 0) {
        return { ok: false, reason: "lane_not_found" };
      }

      // 3) workMenu (任意) も同一 company + 有効 (not-deleted / active) 検証。
      if (input.workMenuId !== undefined) {
        const menuRows = await tx
          .select({ id: workMenus.id })
          .from(workMenus)
          .where(
            and(
              eq(workMenus.id, input.workMenuId),
              eq(workMenus.companyId, companyId),
              isNull(workMenus.deletedAt),
              eq(workMenus.isActive, true),
            ),
          )
          .limit(1);
        if (menuRows.length === 0) {
          return { ok: false, reason: "work_menu_not_found" };
        }
      }

      // 4) 初期 reservation status ('confirmed', is_initial=true) を解決。
      const statusRows = await tx
        .select({ id: statuses.id })
        .from(statuses)
        .where(
          and(
            eq(statuses.companyId, companyId),
            eq(statuses.statusType, "reservation"),
            eq(statuses.isInitial, true),
          ),
        )
        .limit(1);
      if (statusRows.length === 0) {
        return { ok: false, reason: "status_not_seeded" };
      }
      const initialStatusId: string = statusRows[0].id;

      // 5) 顧客を新規作成 (MVP: dedup 非対応)。
      const customerRows = await tx
        .insert(customers)
        .values({
          companyId,
          fullName: input.customer.fullName,
          fullNameKana: input.customer.fullNameKana ?? null,
          email: input.customer.email ?? null,
          phone: input.customer.phone ?? null,
          postalCode: input.customer.postalCode ?? null,
          address: input.customer.address ?? null,
        })
        .returning({ id: customers.id });
      const customerId: string = customerRows[0].id;

      // 6) 車両を新規作成 (storeId に紐付け)。
      const vehicleRows = await tx
        .insert(vehicles)
        .values({
          companyId,
          storeId: input.storeId,
          registrationNumber: input.vehicle.registrationNumber ?? null,
          vin: input.vehicle.vin ?? null,
          maker: input.vehicle.maker ?? null,
          model: input.vehicle.model ?? null,
          modelYear: input.vehicle.modelYear ?? null,
          color: input.vehicle.color ?? null,
        })
        .returning({ id: vehicles.id });
      const vehicleId: string = vehicleRows[0].id;

      // 7) 予約を 'confirmed' で作成。二重予約は exclusion 制約 (23P01) が tx を abort させ、
      //    本 tx 外の catch で slot_unavailable に map する (ここでは throw を伝播させる)。
      const reservationRows = await tx
        .insert(reservations)
        .values({
          companyId,
          storeId: input.storeId,
          laneId: input.laneId,
          workMenuId: input.workMenuId ?? null,
          statusId: initialStatusId,
          customerId,
          vehicleId,
          startAt: input.startAt,
          endAt: input.endAt,
          durationMinutes: input.durationMinutes ?? null,
          notes: input.notes ?? null,
        })
        .returning({ id: reservations.id });
      const reservationId: string = reservationRows[0].id;

      // 8) status history (from=null -> confirmed)。changedByUserId は顧客作成のため null。
      await tx.insert(reservationStatusHistory).values({
        companyId,
        reservationId,
        fromStatusId: null,
        toStatusId: initialStatusId,
        changedByUserId: null,
        reason: "customer_create",
      });

      // 9) 監査ログ (action='create', actorKind='customer')。PII は after_json に入れない。
      await tx.insert(auditLogs).values({
        companyId,
        entityType: "reservation",
        entityId: reservationId,
        action: "create",
        actorKind: "customer",
        afterJson: {
          kind: "customer_reservation_create",
          storeId: input.storeId,
          laneId: input.laneId,
          statusId: initialStatusId,
        },
        ipAddress: options.ipAddress ?? null,
        userAgent: options.userAgent ?? null,
      });

      return { ok: true, reservationId, customerId, vehicleId, statusId: initialStatusId };
    });
  } catch (err) {
    if (isExclusionViolation(err)) {
      return { ok: false, reason: "slot_unavailable" };
    }
    throw err;
  }
}
