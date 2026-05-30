// 店舗別ピット稼働の集計 (Phase 69 S2 / requirements §29.5.1)。
// ---------------------------------------------------------------------------
// 稼働率 = 予約済み分数 / 稼働可能分数 × 100。
//   予約済み分数 = reservations(store/lane/日) の (end_at - start_at) 合算。
//   稼働可能分数 = lane_working_hours(対象 day_of_week の starts_at〜ends_at) 合算 − 休業日(0)。
//
// 設計: 純計算 (timezone 非依存・DB 非依存) と DB 取得 seam を分離する。
//   純関数 → unit テストで検証 (本ファイルのエクスポート)。
//   getStorePitUtilization (DB 取得) → integration テストで検証 (DB 必須・保留)。
//
// confirmed デザイン (c1-dashboard / c2-calendar / c6-floor): 店舗カードに稼働率バー・
// 予約件数・容量・店間件数・要対応バッジを表示する。本 service はその集計値を返す。

import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { laneWorkingHours } from "@/lib/db/schema/lane_working_hours";
import { lanes } from "@/lib/db/schema/lanes";
import { reservations } from "@/lib/db/schema/reservations";
import { storeHolidays } from "@/lib/db/schema/store_holidays";
import { stores } from "@/lib/db/schema/stores";

// ---------------------------------------------------------------------------
// 純計算 (unit テスト対象)
// ---------------------------------------------------------------------------

/** "HH:MM" | "HH:MM:SS" → 0時からの分数。不正値は 0。 */
export function timeToMinutes(t: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t.trim());
  if (!m) return 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 24 || min < 0 || min > 59) return 0;
  return h * 60 + min;
}

export type WorkingHourEntry = { dayOfWeek: number; startsAt: string; endsAt: string };

/** 指定 day_of_week の稼働分数を合算。ends<=starts の異常エントリは無視 (0 扱い)。 */
export function sumWorkingMinutesForDay(entries: WorkingHourEntry[], dayOfWeek: number): number {
  let total = 0;
  for (const e of entries) {
    if (e.dayOfWeek !== dayOfWeek) continue;
    const span = timeToMinutes(e.endsAt) - timeToMinutes(e.startsAt);
    if (span > 0) total += span;
  }
  return total;
}

export type ReservationSpan = { startAt: Date; endAt: Date };

/** 予約の (end_at - start_at) を分で合算。end<=start は無視。 */
export function sumReservationMinutes(spans: ReservationSpan[]): number {
  let total = 0;
  for (const s of spans) {
    const ms = s.endAt.getTime() - s.startAt.getTime();
    if (ms > 0) total += Math.round(ms / 60000);
  }
  return total;
}

/** 稼働率 (%) を整数で返す。稼働可能分が 0 以下なら 0。 */
export function computeUtilizationRate(reservedMin: number, availableMin: number): number {
  if (availableMin <= 0) return 0;
  return Math.round((reservedMin / availableMin) * 100);
}

/** JST カレンダー日付 (YYYY-MM-DD) の曜日 (0=日〜6=土)。TZ 非依存 (カレンダー日付の曜日は一意)。 */
export function jstDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** JST カレンダー日付の UTC 区間 [start, end)。JST=UTC+9 (DST なし)。 */
export function jstDayRange(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export type LaneUtilization = {
  laneId: string;
  capacity: number | null;
  availableMinutes: number;
  reservedMinutes: number;
  utilizationRate: number;
  reservationCount: number;
};

export type StoreUtilization = {
  storeId: string;
  storeName: string;
  laneCount: number;
  totalCapacity: number;
  availableMinutes: number;
  reservedMinutes: number;
  utilizationRate: number;
  reservationCount: number;
  transferCount: number;
  needsAttentionCount: number;
  isHoliday: boolean;
  lanes: LaneUtilization[];
};

export type LaneInput = {
  laneId: string;
  capacity: number | null;
  workingHours: WorkingHourEntry[];
  reservations: ReservationSpan[];
};

export type StoreUtilizationInput = {
  storeId: string;
  storeName: string;
  dayOfWeek: number;
  isHoliday: boolean;
  lanes: LaneInput[];
  transferCount?: number;
  needsAttentionCount?: number;
};

/** 取得済みの行から 1 店舗の稼働集計を組む (純関数)。 */
export function aggregateStoreUtilization(input: StoreUtilizationInput): StoreUtilization {
  const laneUtils: LaneUtilization[] = input.lanes.map((lane) => {
    const availableMinutes = input.isHoliday
      ? 0
      : sumWorkingMinutesForDay(lane.workingHours, input.dayOfWeek);
    const reservedMinutes = sumReservationMinutes(lane.reservations);
    return {
      laneId: lane.laneId,
      capacity: lane.capacity,
      availableMinutes,
      reservedMinutes,
      utilizationRate: computeUtilizationRate(reservedMinutes, availableMinutes),
      reservationCount: lane.reservations.length,
    };
  });

  const availableMinutes = laneUtils.reduce((s, l) => s + l.availableMinutes, 0);
  const reservedMinutes = laneUtils.reduce((s, l) => s + l.reservedMinutes, 0);
  const reservationCount = laneUtils.reduce((s, l) => s + l.reservationCount, 0);
  const totalCapacity = input.lanes.reduce((s, l) => s + (l.capacity ?? 0), 0);

  return {
    storeId: input.storeId,
    storeName: input.storeName,
    laneCount: input.lanes.length,
    totalCapacity,
    availableMinutes,
    reservedMinutes,
    utilizationRate: computeUtilizationRate(reservedMinutes, availableMinutes),
    reservationCount,
    transferCount: input.transferCount ?? 0,
    needsAttentionCount: input.needsAttentionCount ?? 0,
    isHoliday: input.isHoliday,
    lanes: laneUtils,
  };
}

// ---------------------------------------------------------------------------
// DB 取得 seam (integration テスト対象・DB 必須・本セッションでは未実行)
// ---------------------------------------------------------------------------

export type PitUtilizationContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

/**
 * 指定 JST 日付の全店舗ピット稼働を取得して集計する。
 * dayOfWeek の規約は lane_working_hours の書込側 (0=日〜6=土, Date.getUTCDay 相当) を前提。
 * 不一致が疑われる場合は integration テストで要確認 (DB 適用後)。
 */
export async function getStorePitUtilization(
  ctx: PitUtilizationContext,
  params: { date: string },
): Promise<StoreUtilization[]> {
  const { db, companyId } = ctx;
  const dayOfWeek = jstDayOfWeek(params.date);
  const { start, end } = jstDayRange(params.date);

  const storeRows = await db
    .select({ id: stores.id, name: stores.name })
    .from(stores)
    .where(eq(stores.companyId, companyId));
  if (storeRows.length === 0) return [];
  const storeIds = storeRows.map((s: { id: string }) => s.id);

  const laneRows = await db
    .select({ id: lanes.id, storeId: lanes.storeId, capacity: lanes.capacity })
    .from(lanes)
    .where(and(eq(lanes.companyId, companyId), eq(lanes.isActive, true)));
  const laneIds = laneRows.map((l: { id: string }) => l.id);

  const whRows: Array<{ laneId: string; dayOfWeek: number; startsAt: string; endsAt: string }> =
    laneIds.length > 0
      ? await db
          .select({
            laneId: laneWorkingHours.laneId,
            dayOfWeek: laneWorkingHours.dayOfWeek,
            startsAt: laneWorkingHours.startsAt,
            endsAt: laneWorkingHours.endsAt,
          })
          .from(laneWorkingHours)
          .where(
            and(
              eq(laneWorkingHours.companyId, companyId),
              eq(laneWorkingHours.dayOfWeek, dayOfWeek),
              inArray(laneWorkingHours.laneId, laneIds),
            ),
          )
      : [];

  const resRows =
    laneIds.length > 0
      ? await db
          .select({
            laneId: reservations.laneId,
            startAt: reservations.startAt,
            endAt: reservations.endAt,
          })
          .from(reservations)
          .where(
            and(
              eq(reservations.companyId, companyId),
              inArray(reservations.laneId, laneIds),
              gte(reservations.startAt, start),
              lt(reservations.startAt, end),
              isNull(reservations.deletedAt),
            ),
          )
      : [];

  const holidayRows = await db
    .select({ storeId: storeHolidays.storeId, isClosed: storeHolidays.isClosed })
    .from(storeHolidays)
    .where(and(eq(storeHolidays.companyId, companyId), eq(storeHolidays.holidayDate, params.date)));
  const closedStoreIds = new Set<string>(
    holidayRows
      .filter((h: { isClosed: boolean }) => h.isClosed)
      .map((h: { storeId: string }) => h.storeId),
  );

  // group working hours / reservations by lane
  const whByLane = new Map<string, WorkingHourEntry[]>();
  for (const w of whRows as Array<{ laneId: string } & WorkingHourEntry>) {
    const list = whByLane.get(w.laneId) ?? [];
    list.push({ dayOfWeek: w.dayOfWeek, startsAt: w.startsAt, endsAt: w.endsAt });
    whByLane.set(w.laneId, list);
  }
  const resByLane = new Map<string, ReservationSpan[]>();
  for (const r of resRows as Array<{ laneId: string; startAt: Date; endAt: Date }>) {
    const list = resByLane.get(r.laneId) ?? [];
    list.push({ startAt: r.startAt, endAt: r.endAt });
    resByLane.set(r.laneId, list);
  }
  const lanesByStore = new Map<string, Array<{ id: string; capacity: number | null }>>();
  for (const l of laneRows as Array<{ id: string; storeId: string; capacity: number | null }>) {
    const list = lanesByStore.get(l.storeId) ?? [];
    list.push({ id: l.id, capacity: l.capacity });
    lanesByStore.set(l.storeId, list);
  }

  return (storeRows as Array<{ id: string; name: string }>).map((store) =>
    aggregateStoreUtilization({
      storeId: store.id,
      storeName: store.name,
      dayOfWeek,
      isHoliday: closedStoreIds.has(store.id),
      lanes: (lanesByStore.get(store.id) ?? []).map((lane) => ({
        laneId: lane.id,
        capacity: lane.capacity,
        workingHours: whByLane.get(lane.id) ?? [],
        reservations: resByLane.get(lane.id) ?? [],
      })),
    }),
  );
}
