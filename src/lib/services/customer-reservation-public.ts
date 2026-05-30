// Phase 64-A.31a/A.31b: 顧客公開予約フローの service (read surface + write orchestration)。
// ---------------------------------------------------------------------------
//
// spec/requirements.md §12.1 顧客予約フロー step1-3 (店舗選択 / メニュー選択 / 空き日時選択)
// の公開 (匿名訪問者) 向け read エンドポイント、および step1-5 を確定する write orchestration
// (createPublicReservation) を提供する。spec/data-model.md §10.0 availability。
//
// A.31b write orchestration (境界チェック → gate → create): 公開 POST が露出する書込経路は
//   gate (checkReservationSlotAvailable) も create (createCustomerReservation) も「URL companyId」
//   「visible_to_customers」「lane↔store」を検証しない (両者は store-first で company を導出し、
//   可視性・URL 改竄・lane の所属店舗を見ない)。これらは read surface (listAvailableSlotsForStoreMenu)
//   だけが守る境界であり write に転送されないため、createPublicReservation が read と同一の境界
//   チェーン (company→store→menu+visible→候補 lane membership) を gate→create の前段で再強制する。
//   read の boundary を変える際は本 write boundary も対称に変えること (drift 防止のため co-locate)。
//
// テナント境界 (最重要): 顧客は Supabase Auth user ではなく、公開 URL の companyId (UUID) が
//   唯一の company scope。FK は同一 company を保証しないため、全 read で companyId を明示検証する
//   (URL の companyId と store/menu/lane の company_id 不一致を弾く = URL 改竄防御)。
//   companies / stores が inactive / soft-deleted なら公開対象外 (fail-safe)。
//
// lane 集約 (A.30 の per-lane エンジンの上に積む): spec の予約フローで顧客は lane を選ばない
//   (店舗→メニュー→空き日時)。listAvailableSlots は単一 lane 前提のため、本モジュールが
//   「店舗でそのメニューを提供できる候補 lane」を列挙し、各 lane に listAvailableSlots を呼んで
//   union する。各 slot は具体的な laneId に bind して返す (同一時刻が複数 lane で空くと決定論的に
//   1 本へ collapse)。
//
// gate→create invariant (A.30 最重要): UI は本 picker が返す {startAt, endAt, laneId} をそのまま
//   返送し、公開 POST route は「その laneId」で checkReservationSlotAvailable → 同じ laneId で
//   createCustomerReservation を呼ぶ (A.31b)。集約値で gate して別 lane で create、を防ぐため
//   slot を laneId に bind するのが本モジュールの責務。
//
// menu 可視性 (A.31a で導入): listAvailableSlotsForStoreMenu は workMenu の visible_to_customers=true
//   を独立検証する (listPublicWorkMenus が非公開メニューを出さないのに加え、slots エンドポイントを
//   直接叩いても非公開メニューの枠を取れないようにする defense-in-depth)。
//
// spec/CLAUDE.md ADR-0010 補項 (顧客 facing は service_role) / ADR-0011 use-case canonical 準拠。

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db as serviceRoleDb } from "@/lib/db/client";
import { companies } from "@/lib/db/schema/companies";
import { laneWorkMenus } from "@/lib/db/schema/lane_work_menus";
import { lanes } from "@/lib/db/schema/lanes";
import { stores } from "@/lib/db/schema/stores";
import { workMenus } from "@/lib/db/schema/work_menus";
import {
  createCustomerReservation,
  customerInputSchema,
  vehicleInputSchema,
} from "@/lib/services/customer-reservation-create";
import {
  checkReservationSlotAvailable,
  type CheckReservationSlotResult,
  listAvailableSlots,
} from "@/lib/services/reservation-availability";

// Drizzle does not expose a common DB/transaction interface that fits this project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type PublicReadOptions = {
  // 現在時刻 (lead/advance 計算の基準)。test では固定値を注入。
  now?: Date;
  db?: Db;
};

const uuidSchema = z.string().uuid();

// company が公開予約を受け付ける状態か (active / not-deleted)。
// A.32b: verification-code 発行 orchestration も同じ company gate を再利用するため export
//   (存在しない company UUID で issue の INSERT が FK 23503 → 500 になるのを防ぎ、sibling route と
//    同じ company_not_found に正規化する)。
export async function isPublicCompanyActive(db: Db, companyId: string): Promise<boolean> {
  const rows = await db
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(eq(companies.id, companyId), isNull(companies.deletedAt), eq(companies.isActive, true)),
    )
    .limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// step1: 店舗一覧 (公開)
// ---------------------------------------------------------------------------

export type PublicStore = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
};

export type ListPublicStoresResult =
  | { ok: true; stores: PublicStore[] }
  | { ok: false; reason: "company_not_found" };

export async function listPublicStores(
  rawCompanyId: string,
  options: PublicReadOptions = {},
): Promise<ListPublicStoresResult> {
  const parsed = uuidSchema.safeParse(rawCompanyId);
  if (!parsed.success) return { ok: false, reason: "company_not_found" };
  const companyId = parsed.data;
  const db: Db = options.db ?? serviceRoleDb;

  if (!(await isPublicCompanyActive(db, companyId))) {
    return { ok: false, reason: "company_not_found" };
  }

  const rows = await db
    .select({
      id: stores.id,
      name: stores.name,
      address: stores.address,
      phone: stores.phone,
    })
    .from(stores)
    .where(
      and(eq(stores.companyId, companyId), isNull(stores.deletedAt), eq(stores.isActive, true)),
    )
    .orderBy(stores.name);

  return { ok: true, stores: rows };
}

// ---------------------------------------------------------------------------
// step2: 作業メニュー一覧 (公開、店舗で提供可能かつ visible_to_customers=true のみ)
// ---------------------------------------------------------------------------

export type PublicWorkMenu = {
  id: string;
  name: string;
  durationMinutes: number;
  priceMinor: number;
};

export type ListPublicWorkMenusResult =
  | { ok: true; menus: PublicWorkMenu[] }
  | { ok: false; reason: "company_not_found" | "store_not_found" };

export async function listPublicWorkMenus(
  rawCompanyId: string,
  rawStoreId: string,
  options: PublicReadOptions = {},
): Promise<ListPublicWorkMenusResult> {
  const companyParsed = uuidSchema.safeParse(rawCompanyId);
  if (!companyParsed.success) return { ok: false, reason: "company_not_found" };
  const storeParsed = uuidSchema.safeParse(rawStoreId);
  if (!storeParsed.success) return { ok: false, reason: "store_not_found" };
  const companyId = companyParsed.data;
  const storeId = storeParsed.data;
  const db: Db = options.db ?? serviceRoleDb;

  if (!(await isPublicCompanyActive(db, companyId))) {
    return { ok: false, reason: "company_not_found" };
  }

  // store は同一 company + active + not-deleted (URL 改竄防御)。
  const storeRows = await db
    .select({ id: stores.id })
    .from(stores)
    .where(
      and(
        eq(stores.id, storeId),
        eq(stores.companyId, companyId),
        isNull(stores.deletedAt),
        eq(stores.isActive, true),
      ),
    )
    .limit(1);
  if (storeRows.length === 0) return { ok: false, reason: "store_not_found" };

  // visible_to_customers=true かつ「その店舗の active lane が提供可能」なメニューのみ。
  // 候補 lane が無いメニュー (= 空き枠が出ない dead-end) を公開一覧から除く。
  // 複数 lane が同一メニューを提供すると行が重複するため selectDistinct で collapse。
  const rows = await db
    .selectDistinct({
      id: workMenus.id,
      name: workMenus.name,
      durationMinutes: workMenus.durationMinutes,
      priceMinor: workMenus.priceMinor,
    })
    .from(workMenus)
    .innerJoin(laneWorkMenus, eq(laneWorkMenus.workMenuId, workMenus.id))
    .innerJoin(lanes, eq(lanes.id, laneWorkMenus.laneId))
    .where(
      and(
        eq(workMenus.companyId, companyId),
        isNull(workMenus.deletedAt),
        eq(workMenus.isActive, true),
        eq(workMenus.visibleToCustomers, true),
        eq(lanes.storeId, storeId),
        eq(lanes.companyId, companyId),
        isNull(lanes.deletedAt),
        eq(lanes.isActive, true),
      ),
    )
    .orderBy(workMenus.name);

  return { ok: true, menus: rows };
}

// ---------------------------------------------------------------------------
// step3: 空き日時 picker (lane 集約)
// ---------------------------------------------------------------------------

export const listAvailableSlotsForStoreMenuSchema = z.object({
  companyId: z.string().uuid(),
  storeId: z.string().uuid(),
  workMenuId: z.string().uuid(),
  // JST 暦日 'YYYY-MM-DD'。
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

export type ListAvailableSlotsForStoreMenuInput = z.infer<
  typeof listAvailableSlotsForStoreMenuSchema
>;

// per-lane の AvailableSlot に「どの lane で空いているか」を付与した公開 slot。
export type PublicAvailableSlot = { startAt: Date; endAt: Date; laneId: string };

export type ListAvailableSlotsForStoreMenuResult =
  | { ok: true; slots: PublicAvailableSlot[] }
  | { ok: false; reason: "company_not_found" | "store_not_found" | "work_menu_not_found" };

export async function listAvailableSlotsForStoreMenu(
  rawInput: ListAvailableSlotsForStoreMenuInput,
  options: PublicReadOptions = {},
): Promise<ListAvailableSlotsForStoreMenuResult> {
  // 入力 (UUID / date 形式) は route 層で検証済み前提。malformed は parse が throw する
  // (既存 availability service と同じ契約)。
  const input = listAvailableSlotsForStoreMenuSchema.parse(rawInput);
  const db: Db = options.db ?? serviceRoleDb;

  // 1) company gate。
  if (!(await isPublicCompanyActive(db, input.companyId))) {
    return { ok: false, reason: "company_not_found" };
  }

  // 2) store gate (同一 company + active + not-deleted)。
  const storeRows = await db
    .select({ id: stores.id })
    .from(stores)
    .where(
      and(
        eq(stores.id, input.storeId),
        eq(stores.companyId, input.companyId),
        isNull(stores.deletedAt),
        eq(stores.isActive, true),
      ),
    )
    .limit(1);
  if (storeRows.length === 0) return { ok: false, reason: "store_not_found" };

  // 3) menu gate (同一 company + active + not-deleted + visible_to_customers)。
  //    非公開メニューの枠を slots エンドポイント直叩きで取れないようにする (defense-in-depth)。
  const menuRows = await db
    .select({ id: workMenus.id })
    .from(workMenus)
    .where(
      and(
        eq(workMenus.id, input.workMenuId),
        eq(workMenus.companyId, input.companyId),
        isNull(workMenus.deletedAt),
        eq(workMenus.isActive, true),
        eq(workMenus.visibleToCustomers, true),
      ),
    )
    .limit(1);
  if (menuRows.length === 0) return { ok: false, reason: "work_menu_not_found" };

  // 4) 候補 lane: その店舗の active / not-deleted lane で、当該メニューを提供できるもの。
  const laneRows = await db
    .select({ id: lanes.id })
    .from(lanes)
    .innerJoin(
      laneWorkMenus,
      and(eq(laneWorkMenus.laneId, lanes.id), eq(laneWorkMenus.workMenuId, input.workMenuId)),
    )
    .where(
      and(
        eq(lanes.storeId, input.storeId),
        eq(lanes.companyId, input.companyId),
        isNull(lanes.deletedAt),
        eq(lanes.isActive, true),
      ),
    );
  const laneIds: string[] = laneRows.map((r: { id: string }) => r.id);
  if (laneIds.length === 0) return { ok: true, slots: [] };

  // 5) 各候補 lane に A.30 の per-lane picker を呼んで union。
  //    同一 (startAt, endAt) が複数 lane で空く場合は決定論的に最小 laneId へ collapse
  //    (UI は時刻を 1 度だけ表示し、bind 先 laneId が安定する → gate→create の同一性が保たれる)。
  //    N+1: lane 数だけ listAvailableSlots を呼ぶ (店舗あたり lane 数は小さい MVP 前提)。
  const byKey = new Map<string, PublicAvailableSlot>();
  for (const laneId of laneIds) {
    const res = await listAvailableSlots(
      { storeId: input.storeId, laneId, workMenuId: input.workMenuId, date: input.date },
      { db, now: options.now },
    );
    // gate 通過後に listAvailableSlots が context 失敗する=並行削除等の稀ケース。skip (defensive)。
    if (!res.ok) continue;
    for (const slot of res.slots) {
      const key = `${slot.startAt.getTime()}|${slot.endAt.getTime()}`;
      const existing = byKey.get(key);
      if (existing === undefined || laneId < existing.laneId) {
        byKey.set(key, { startAt: slot.startAt, endAt: slot.endAt, laneId });
      }
    }
  }

  const slots = [...byKey.values()].sort(
    (a, b) =>
      a.startAt.getTime() - b.startAt.getTime() ||
      (a.laneId < b.laneId ? -1 : a.laneId > b.laneId ? 1 : 0),
  );
  return { ok: true, slots };
}

// ---------------------------------------------------------------------------
// step4-5 確定: 公開予約 write orchestration (境界チェック → gate → create)
// ---------------------------------------------------------------------------

// 公開予約の境界検証の失敗理由 (gate/create が守らない 4 観点)。
type PublicReservationTargetFailure =
  | "company_not_found"
  | "store_not_found"
  | "work_menu_not_found"
  | "lane_not_found";

// (companyId, storeId, workMenuId, laneId) が「listAvailableSlotsForStoreMenu が候補にし得る
// 正当な tuple」かを検証する。read surface (step1-3) と同一の境界チェーンを write 前段で再強制:
//   1) company active / not-deleted
//   2) store: 同一 company + active + not-deleted (URL companyId 改竄防御)
//   3) menu: 同一 company + active + not-deleted + visible_to_customers (非公開メニュー直接予約防御)
//   4) lane: 同一 store + 同一 company + active + not-deleted + 当該 menu を提供 (lane_work_menus)
// gate (resolveContext) は lane↔company しか見ず lane↔store / 可視性 / URL companyId を見ないため、
// この境界が write path の唯一の防御線になる (advisor #5 adversarial gate 指摘)。
async function resolvePublicReservationTarget(
  db: Db,
  input: { companyId: string; storeId: string; workMenuId: string; laneId: string },
): Promise<{ ok: true } | { ok: false; reason: PublicReservationTargetFailure }> {
  if (!(await isPublicCompanyActive(db, input.companyId))) {
    return { ok: false, reason: "company_not_found" };
  }

  const storeRows = await db
    .select({ id: stores.id })
    .from(stores)
    .where(
      and(
        eq(stores.id, input.storeId),
        eq(stores.companyId, input.companyId),
        isNull(stores.deletedAt),
        eq(stores.isActive, true),
      ),
    )
    .limit(1);
  if (storeRows.length === 0) return { ok: false, reason: "store_not_found" };

  const menuRows = await db
    .select({ id: workMenus.id })
    .from(workMenus)
    .where(
      and(
        eq(workMenus.id, input.workMenuId),
        eq(workMenus.companyId, input.companyId),
        isNull(workMenus.deletedAt),
        eq(workMenus.isActive, true),
        eq(workMenus.visibleToCustomers, true),
      ),
    )
    .limit(1);
  if (menuRows.length === 0) return { ok: false, reason: "work_menu_not_found" };

  // lane は当該 store 所属 + 同一 company + 有効 + 当該 menu を提供できること
  // (listAvailableSlotsForStoreMenu の候補 lane 導出と対称)。
  const laneRows = await db
    .select({ id: lanes.id })
    .from(lanes)
    .innerJoin(
      laneWorkMenus,
      and(eq(laneWorkMenus.laneId, lanes.id), eq(laneWorkMenus.workMenuId, input.workMenuId)),
    )
    .where(
      and(
        eq(lanes.id, input.laneId),
        eq(lanes.storeId, input.storeId),
        eq(lanes.companyId, input.companyId),
        isNull(lanes.deletedAt),
        eq(lanes.isActive, true),
      ),
    )
    .limit(1);
  if (laneRows.length === 0) return { ok: false, reason: "lane_not_found" };

  return { ok: true };
}

export type CreatePublicReservationOptions = {
  // gate (lead/advance) の基準時刻。test では固定値を注入。
  now?: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  db?: Db;
};

// 公開予約確定の入力。workMenuId は公開 path では必須 (省略すると create が menu 検証ごと
// スキップするため = visible_to_customers gate が外れる)。startAt/endAt は picker が返した値を
// そのまま受ける (gate が menu.duration と一致を強制し、改竄を duration_mismatch で弾く)。
export const createPublicReservationSchema = z
  .object({
    companyId: z.string().uuid(),
    storeId: z.string().uuid(),
    workMenuId: z.string().uuid(),
    laneId: z.string().uuid(),
    startAt: z.date(),
    endAt: z.date(),
    customer: customerInputSchema,
    vehicle: vehicleInputSchema,
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.startAt.getTime() < v.endAt.getTime(), {
    message: "startAt must be before endAt",
    path: ["endAt"],
  });

export type CreatePublicReservationInput = z.infer<typeof createPublicReservationSchema>;

export type CreatePublicReservationResult =
  | {
      ok: true;
      reservationId: string;
      customerId: string;
      vehicleId: string;
      statusId: string;
    }
  | {
      ok: false;
      reason: // 境界 (resolvePublicReservationTarget)
        | "company_not_found"
        | "store_not_found"
        | "work_menu_not_found"
        | "lane_not_found"
        // availability gate (checkReservationSlotAvailable)
        | "duration_mismatch"
        | "too_soon"
        | "too_far"
        | "closed"
        | "outside_business_hours"
        // create (createCustomerReservation)
        | "slot_unavailable"
        | "status_not_seeded";
    };

type GateFailureReason = Extract<CheckReservationSlotResult, { ok: false }>["reason"];

// gate の失敗 reason を公開 result の reason に正規化。lane_menu_unsupported は lane_not_found に畳む
// (公開 surface はどの lane 検証が落ちたかを区別しない)。context 失敗 (store/lane/work_menu_not_found)
// は通常境界チェックで先に弾かれるため、ここに来るのは並行削除等の稀ケース (defensive に素通し)。
function normalizeGateReason(
  reason: GateFailureReason,
): Extract<CreatePublicReservationResult, { ok: false }>["reason"] {
  return reason === "lane_menu_unsupported" ? "lane_not_found" : reason;
}

// 公開予約フロー step1-5 を 1 件確定する。境界チェーン → availability gate → create を順に行い、
// 最初に失敗した段の reason を返す。最重要 invariant: picker が返した laneId を gate と create で
// 同一に保つ (本関数は laneId を一切書き換えず両者へ素通しする)。二重予約は create の exclusion
// 制約 (23P01 → slot_unavailable) が最終防衛線で、gate→create 間の race を clean に弾く。
export async function createPublicReservation(
  rawInput: CreatePublicReservationInput,
  options: CreatePublicReservationOptions = {},
): Promise<CreatePublicReservationResult> {
  const input = createPublicReservationSchema.parse(rawInput);
  const db: Db = options.db ?? serviceRoleDb;

  // 1) 境界 (company / store / menu+visible / lane membership)。gate も create も守らない層。
  const target = await resolvePublicReservationTarget(db, {
    companyId: input.companyId,
    storeId: input.storeId,
    workMenuId: input.workMenuId,
    laneId: input.laneId,
  });
  if (!target.ok) return { ok: false, reason: target.reason };

  // 2) availability gate (営業時間 / 定休日 / lead / advance / duration)。untrusted datetime を潰す。
  const gate = await checkReservationSlotAvailable(
    {
      storeId: input.storeId,
      laneId: input.laneId,
      workMenuId: input.workMenuId,
      startAt: input.startAt,
      endAt: input.endAt,
    },
    { db, now: options.now },
  );
  if (!gate.ok) return { ok: false, reason: normalizeGateReason(gate.reason) };

  // 3) create (同一 laneId / workMenuId)。durationMinutes は picker の窓 (= menu.duration) から導出。
  const durationMinutes = Math.round((input.endAt.getTime() - input.startAt.getTime()) / 60000);
  const created = await createCustomerReservation(
    {
      storeId: input.storeId,
      laneId: input.laneId,
      workMenuId: input.workMenuId,
      customer: input.customer,
      vehicle: input.vehicle,
      startAt: input.startAt,
      endAt: input.endAt,
      durationMinutes,
      notes: input.notes,
    },
    { db, ipAddress: options.ipAddress, userAgent: options.userAgent },
  );
  if (!created.ok) {
    // 境界+gate を通過後に store/lane/menu 失敗が出るのは並行削除等の稀ケース。reason を素通し。
    return { ok: false, reason: created.reason };
  }

  return {
    ok: true,
    reservationId: created.reservationId,
    customerId: created.customerId,
    vehicleId: created.vehicleId,
    statusId: created.statusId,
  };
}
