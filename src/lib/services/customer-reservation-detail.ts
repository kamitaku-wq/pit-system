/**
 * Reservation detail loader (Phase 64-A.24, customer-facing service_role)
 *
 * 顧客 facing flow で consume 済みの reservation の詳細を取得する read-only service。
 *
 * 設計判断:
 * 1. RLS bypass (drizzle `db` 直) で取得。顧客は Supabase Auth user ではないため
 *    `withAuthenticatedDb` を経由できない。
 * 2. **cross-tenant safety を join に明示**: reservation の companyId を先に取得し、
 *    各 leftJoin に `AND <table>.company_id = <reservation.company_id>` を組み込む。
 *    raw migration の FK 制約は同 companyId を保証しないため (理論上 migration ミスや
 *    手動 INSERT で漏洩する余地あり)、app 層で明示的に防御する。
 * 3. **read-only / no audit**: 詳細閲覧は consume を伴わない。閲覧監査が必要になったら
 *    audit_logs.action CHECK 制約 (`'create'`,`'update'`,`'delete'`,`'restore'`) の
 *    範囲で `after_json.kind` 命名を増やす設計判断が必要 → 別 phase に持ち越し。
 * 4. nullable FK (workMenu / vehicle / customer / status) は leftJoin で null 許容。
 *    NOT NULL FK (store / lane) も leftJoin で書き、結果 null なら corrupt data として
 *    UI 層で扱う (本来起こらない)。
 * 5. 戻り型は flat にせず構造化 (`{ reservation, store, lane, workMenu, vehicle, customer, status }`)。
 *    UI が section ごとに dst で扱いやすい。
 */

import { and, eq } from "drizzle-orm";
import { db as serviceRoleDb } from "@/lib/db/client";
import { customers } from "@/lib/db/schema/customers";
import { lanes } from "@/lib/db/schema/lanes";
import { reservations } from "@/lib/db/schema/reservations";
import { statuses } from "@/lib/db/schema/statuses";
import { stores } from "@/lib/db/schema/stores";
import { vehicles } from "@/lib/db/schema/vehicles";
import { workMenus } from "@/lib/db/schema/work_menus";

export type ReservationDetail = {
  reservation: {
    id: string;
    companyId: string;
    startAt: Date;
    endAt: Date;
    notes: string | null;
  };
  store: { id: string; name: string; code: string | null } | null;
  lane: { id: string; name: string } | null;
  workMenu: {
    id: string;
    name: string;
    code: string;
    durationMinutes: number;
  } | null;
  vehicle: {
    id: string;
    registrationNumber: string | null;
    maker: string | null;
    model: string | null;
  } | null;
  customer: {
    id: string;
    fullName: string;
    phone: string | null;
  } | null;
  status: { id: string; key: string; name: string } | null;
};

export type GetReservationDetailOptions = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any;
};

export async function getReservationDetailViaServiceRole(
  reservationId: string,
  options: GetReservationDetailOptions = {},
): Promise<ReservationDetail | null> {
  const baseDb = options.db ?? serviceRoleDb;

  // Step 1: reservation を取得して companyId を確定 (cross-tenant filter の基準)
  const reservationRows = await baseDb
    .select({
      id: reservations.id,
      companyId: reservations.companyId,
      storeId: reservations.storeId,
      laneId: reservations.laneId,
      workMenuId: reservations.workMenuId,
      vehicleId: reservations.vehicleId,
      customerId: reservations.customerId,
      statusId: reservations.statusId,
      startAt: reservations.startAt,
      endAt: reservations.endAt,
      notes: reservations.notes,
    })
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .limit(1);

  if (reservationRows.length === 0) {
    return null;
  }
  const r = reservationRows[0];

  // Step 2: 各関連テーブルを 1 クエリで leftJoin (cross-tenant filter を join 条件に明示)
  const joinRows = await baseDb
    .select({
      // store
      storeId: stores.id,
      storeName: stores.name,
      storeCode: stores.code,
      // lane
      laneId: lanes.id,
      laneName: lanes.name,
      // workMenu
      workMenuId: workMenus.id,
      workMenuName: workMenus.name,
      workMenuCode: workMenus.code,
      workMenuDuration: workMenus.durationMinutes,
      // vehicle
      vehicleId: vehicles.id,
      vehicleRegistrationNumber: vehicles.registrationNumber,
      vehicleMaker: vehicles.maker,
      vehicleModel: vehicles.model,
      // customer
      customerId: customers.id,
      customerFullName: customers.fullName,
      customerPhone: customers.phone,
      // status
      statusId: statuses.id,
      statusKey: statuses.key,
      statusName: statuses.name,
    })
    .from(reservations)
    .leftJoin(
      stores,
      and(eq(stores.id, reservations.storeId), eq(stores.companyId, r.companyId)),
    )
    .leftJoin(
      lanes,
      and(eq(lanes.id, reservations.laneId), eq(lanes.companyId, r.companyId)),
    )
    .leftJoin(
      workMenus,
      and(
        eq(workMenus.id, reservations.workMenuId),
        eq(workMenus.companyId, r.companyId),
      ),
    )
    .leftJoin(
      vehicles,
      and(
        eq(vehicles.id, reservations.vehicleId),
        eq(vehicles.companyId, r.companyId),
      ),
    )
    .leftJoin(
      customers,
      and(
        eq(customers.id, reservations.customerId),
        eq(customers.companyId, r.companyId),
      ),
    )
    .leftJoin(
      statuses,
      and(
        eq(statuses.id, reservations.statusId),
        eq(statuses.companyId, r.companyId),
      ),
    )
    .where(eq(reservations.id, reservationId))
    .limit(1);

  if (joinRows.length === 0) {
    return null;
  }
  const j = joinRows[0];

  return {
    reservation: {
      id: r.id,
      companyId: r.companyId,
      startAt: r.startAt,
      endAt: r.endAt,
      notes: r.notes,
    },
    store:
      j.storeId !== null
        ? { id: j.storeId, name: j.storeName, code: j.storeCode }
        : null,
    lane: j.laneId !== null ? { id: j.laneId, name: j.laneName } : null,
    workMenu:
      j.workMenuId !== null
        ? {
            id: j.workMenuId,
            name: j.workMenuName,
            code: j.workMenuCode,
            durationMinutes: j.workMenuDuration,
          }
        : null,
    vehicle:
      j.vehicleId !== null
        ? {
            id: j.vehicleId,
            registrationNumber: j.vehicleRegistrationNumber,
            maker: j.vehicleMaker,
            model: j.vehicleModel,
          }
        : null,
    customer:
      j.customerId !== null
        ? {
            id: j.customerId,
            fullName: j.customerFullName,
            phone: j.customerPhone,
          }
        : null,
    status:
      j.statusId !== null
        ? { id: j.statusId, key: j.statusKey, name: j.statusName }
        : null,
  };
}
