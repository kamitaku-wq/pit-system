// Phase 64-A.30: 予約 availability エンジン (空き枠 picker + 公開 route gate の共有コア)。
// ---------------------------------------------------------------------------
//
// spec/data-model.md §10.0: 「予約枠」単独テーブル (service_slots) は持たず、既存テーブル群
//   (reservation_settings / lanes / lane_working_hours / store_business_hours / store_holidays /
//    lane_work_menus / reservations) の組み合わせクエリで「利用可能時間帯」を計算する。
//
// A.29 invariant (必須): createCustomerReservation は untrusted client が任意 datetime を
//   POST できるため、公開 route で露出する際に availability 検証を service 呼び出し前に gate
//   する。本モジュールがその gate (checkReservationSlotAvailable) と picker (listAvailableSlots)
//   を提供する。両者は同一の窓計算コア (computeDayWindows) を共有し、「picker が空きと出す枠を
//   gate が拒否する (or 逆)」drift を構造的に防ぐ。
//
// 信頼モデル (gate): client は startAt / endAt / durationMinutes / workMenuId を自由に送れる。
//   gate は以下を列挙して潰す:
//     - cross-tenant (store→company 導出、lane / workMenu が同一 company・有効)
//     - lane がその workMenu に対応 (lane_work_menus M2M)
//     - duration が menu と一致 (workMenu 指定時は endAt を信用せず menu.duration を強制)
//     - 定休日 / 営業時間外 (store_business_hours ∩ lane_working_hours − store_holidays)
//     - lead time 前 / advance 窓外 (reservation_settings)
//   二重予約 (overlap) は reservations の EXCLUDE 制約が最終防衛線のため gate では検証しない
//   (gate→create 間で racy なのは overlap のみで、EXCLUDE が敗者を slot_unavailable で clean に弾く)。
//   buffer (buffer_before/after) は EXCLUDE では強制されないため picker 側 advisory として扱う
//   (MVP default 0)。
//
// 時刻計算: 全て JST (Asia/Tokyo 固定) で行う。time 列は JST 壁時計、reservations は UTC instant。
//   src/lib/tz/jst.ts に変換を集約。day_of_week は 0=日..6=土 (spec/data-model.md)。

import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db as serviceRoleDb } from "@/lib/db/client";
import { laneWorkingHours } from "@/lib/db/schema/lane_working_hours";
import { laneWorkMenus } from "@/lib/db/schema/lane_work_menus";
import { lanes } from "@/lib/db/schema/lanes";
import { reservations } from "@/lib/db/schema/reservations";
import { reservationSettings } from "@/lib/db/schema/reservation_settings";
import { storeBusinessHours } from "@/lib/db/schema/store_business_hours";
import { storeHolidays } from "@/lib/db/schema/store_holidays";
import { stores } from "@/lib/db/schema/stores";
import { workMenus } from "@/lib/db/schema/work_menus";
import {
  jstDateString,
  jstDateTimeToUtc,
  jstDayOfWeek,
  timeStringToMinutes,
} from "@/lib/tz/jst";

// Drizzle does not expose a common DB/transaction interface that fits this project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type AvailabilityOptions = {
  // 現在時刻 (lead/advance 計算の基準)。test では固定値を注入。
  now?: Date;
  db?: Db;
};

// reservation_settings 該当行なし時のフォールバック (raw-migration 14_settings.sql の DEFAULT に一致)。
// reservation_settings は company 作成時に auto-seed されないため「行なし」は正常ケース。
const SETTINGS_DEFAULTS = {
  slotIntervalMinutes: 30,
  minLeadTimeMinutes: 0,
  maxAdvanceDays: 90,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
} as const;

type ResolvedSettings = typeof SETTINGS_DEFAULTS;

// cross-tenant 検証の失敗理由 (gate / picker 共通)。
type ContextFailureReason =
  | "store_not_found"
  | "lane_not_found"
  | "work_menu_not_found"
  | "lane_menu_unsupported";

type ResolvedContext = {
  companyId: string;
  // workMenu 指定時の所要時間 (分)。未指定時は null。
  menuDurationMinutes: number | null;
};

// JST 壁時計の分単位区間 [startMin, endMin] (同一暦日内)。
type DayWindow = { startMin: number; endMin: number };

// ---------------------------------------------------------------------------
// 共有: cross-tenant 検証 (store-first company 導出 + lane / workMenu 整合)
// ---------------------------------------------------------------------------

async function resolveContext(
  db: Db,
  params: { storeId: string; laneId: string; workMenuId?: string },
): Promise<{ ok: true; ctx: ResolvedContext } | { ok: false; reason: ContextFailureReason }> {
  // 1) store → company (not-deleted / active のみ予約対象)。
  const storeRows = await db
    .select({ companyId: stores.companyId })
    .from(stores)
    .where(and(eq(stores.id, params.storeId), isNull(stores.deletedAt), eq(stores.isActive, true)))
    .limit(1);
  if (storeRows.length === 0) return { ok: false, reason: "store_not_found" };
  const companyId: string = storeRows[0].companyId;

  // 2) lane が同一 company + 有効 (FK は company も削除状態も保証しない)。
  const laneRows = await db
    .select({ id: lanes.id })
    .from(lanes)
    .where(
      and(
        eq(lanes.id, params.laneId),
        eq(lanes.companyId, companyId),
        isNull(lanes.deletedAt),
        eq(lanes.isActive, true),
      ),
    )
    .limit(1);
  if (laneRows.length === 0) return { ok: false, reason: "lane_not_found" };

  // 3) workMenu (任意) も同一 company + 有効。所要時間を取得し、lane 対応 (M2M) を検証。
  let menuDurationMinutes: number | null = null;
  if (params.workMenuId !== undefined) {
    const menuRows = await db
      .select({ id: workMenus.id, durationMinutes: workMenus.durationMinutes })
      .from(workMenus)
      .where(
        and(
          eq(workMenus.id, params.workMenuId),
          eq(workMenus.companyId, companyId),
          isNull(workMenus.deletedAt),
          eq(workMenus.isActive, true),
        ),
      )
      .limit(1);
    if (menuRows.length === 0) return { ok: false, reason: "work_menu_not_found" };
    menuDurationMinutes = menuRows[0].durationMinutes;

    // lane がその workMenu を提供可能か (lane_work_menus M2M)。
    const linkRows = await db
      .select({ id: laneWorkMenus.id })
      .from(laneWorkMenus)
      .where(
        and(
          eq(laneWorkMenus.laneId, params.laneId),
          eq(laneWorkMenus.workMenuId, params.workMenuId),
        ),
      )
      .limit(1);
    if (linkRows.length === 0) return { ok: false, reason: "lane_menu_unsupported" };
  }

  return { ok: true, ctx: { companyId, menuDurationMinutes } };
}

// ---------------------------------------------------------------------------
// 共有: reservation_settings 解決 (per-store → company default → schema default)
// ---------------------------------------------------------------------------

async function resolveSettings(db: Db, companyId: string, storeId: string): Promise<ResolvedSettings> {
  const rows = await db
    .select({
      storeId: reservationSettings.storeId,
      slotIntervalMinutes: reservationSettings.slotIntervalMinutes,
      minLeadTimeMinutes: reservationSettings.minLeadTimeMinutes,
      maxAdvanceDays: reservationSettings.maxAdvanceDays,
      bufferBeforeMinutes: reservationSettings.bufferBeforeMinutes,
      bufferAfterMinutes: reservationSettings.bufferAfterMinutes,
    })
    .from(reservationSettings)
    .where(eq(reservationSettings.companyId, companyId));

  // per-store 行を優先、なければ company default (store_id IS NULL)。
  const perStore = rows.find((r: { storeId: string | null }) => r.storeId === storeId);
  const companyDefault = rows.find((r: { storeId: string | null }) => r.storeId === null);
  const chosen = perStore ?? companyDefault;
  if (!chosen) return { ...SETTINGS_DEFAULTS };
  return {
    slotIntervalMinutes: chosen.slotIntervalMinutes,
    minLeadTimeMinutes: chosen.minLeadTimeMinutes,
    maxAdvanceDays: chosen.maxAdvanceDays,
    bufferBeforeMinutes: chosen.bufferBeforeMinutes,
    bufferAfterMinutes: chosen.bufferAfterMinutes,
  };
}

// ---------------------------------------------------------------------------
// 共有: 窓計算コア (営業時間 ∩ lane 稼働 − 定休日)
// ---------------------------------------------------------------------------

// 指定 JST 暦日の予約可能区間 (JST 壁時計分) を返す。定休日 / 営業時間なしなら []。
async function computeDayWindows(
  db: Db,
  params: { storeId: string; laneId: string; jstDate: string; dayOfWeek: number },
): Promise<DayWindow[]> {
  // 定休日 (is_closed=true) なら終日クローズ。
  const holidayRows = await db
    .select({ id: storeHolidays.id })
    .from(storeHolidays)
    .where(
      and(
        eq(storeHolidays.storeId, params.storeId),
        eq(storeHolidays.holidayDate, params.jstDate),
        eq(storeHolidays.isClosed, true),
      ),
    )
    .limit(1);
  if (holidayRows.length > 0) return [];

  // 店舗営業時間 (accepts_reservations=true)。複数行 (午前/午後等) を許容。
  const businessRows = await db
    .select({ opensAt: storeBusinessHours.opensAt, closesAt: storeBusinessHours.closesAt })
    .from(storeBusinessHours)
    .where(
      and(
        eq(storeBusinessHours.storeId, params.storeId),
        eq(storeBusinessHours.dayOfWeek, params.dayOfWeek),
        eq(storeBusinessHours.acceptsReservations, true),
      ),
    );
  if (businessRows.length === 0) return [];

  // lane 稼働時間。複数行を許容。
  const laneRows = await db
    .select({ startsAt: laneWorkingHours.startsAt, endsAt: laneWorkingHours.endsAt })
    .from(laneWorkingHours)
    .where(
      and(eq(laneWorkingHours.laneId, params.laneId), eq(laneWorkingHours.dayOfWeek, params.dayOfWeek)),
    );
  if (laneRows.length === 0) return [];

  // 営業時間区間 × lane 稼働区間の交差を全ペアで計算。
  const windows: DayWindow[] = [];
  for (const b of businessRows) {
    const bStart = timeStringToMinutes(b.opensAt);
    const bEnd = timeStringToMinutes(b.closesAt);
    for (const l of laneRows) {
      const lStart = timeStringToMinutes(l.startsAt);
      const lEnd = timeStringToMinutes(l.endsAt);
      const start = Math.max(bStart, lStart);
      const end = Math.min(bEnd, lEnd);
      if (start < end) windows.push({ startMin: start, endMin: end });
    }
  }
  return mergeWindows(windows);
}

// 重なる / 隣接する区間をマージし、startMin 昇順に整列。
function mergeWindows(windows: DayWindow[]): DayWindow[] {
  if (windows.length <= 1) return windows;
  const sorted = [...windows].sort((a, b) => a.startMin - b.startMin);
  const merged: DayWindow[] = [];
  for (const cur of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && cur.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, cur.endMin);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// GATE: 特定 start/end が予約可能かを検証 (route が createCustomerReservation 前に呼ぶ)
// ---------------------------------------------------------------------------

export const checkReservationSlotSchema = z
  .object({
    storeId: z.string().uuid(),
    laneId: z.string().uuid(),
    workMenuId: z.string().uuid().optional(),
    startAt: z.date(),
    endAt: z.date(),
  })
  .refine((v) => v.startAt.getTime() < v.endAt.getTime(), {
    message: "startAt must be before endAt",
    path: ["endAt"],
  });

export type CheckReservationSlotInput = z.infer<typeof checkReservationSlotSchema>;

export type CheckReservationSlotResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | ContextFailureReason
        | "duration_mismatch"
        | "too_soon"
        | "too_far"
        | "closed"
        | "outside_business_hours";
    };

export async function checkReservationSlotAvailable(
  rawInput: CheckReservationSlotInput,
  options: AvailabilityOptions = {},
): Promise<CheckReservationSlotResult> {
  const input = checkReservationSlotSchema.parse(rawInput);
  const db: Db = options.db ?? serviceRoleDb;
  const now = options.now ?? new Date();

  const resolved = await resolveContext(db, {
    storeId: input.storeId,
    laneId: input.laneId,
    workMenuId: input.workMenuId,
  });
  if (!resolved.ok) return { ok: false, reason: resolved.reason };

  // workMenu 指定時は client の endAt を信用せず menu.duration と一致を強制
  // (untrusted client が極小窓を送り既存予約の隙間に滑り込むのを防ぐ)。
  if (resolved.ctx.menuDurationMinutes !== null) {
    const requestedMinutes = (input.endAt.getTime() - input.startAt.getTime()) / 60000;
    if (requestedMinutes !== resolved.ctx.menuDurationMinutes) {
      return { ok: false, reason: "duration_mismatch" };
    }
  }

  const settings = await resolveSettings(db, resolved.ctx.companyId, input.storeId);

  // lead time: 予約開始は now + min_lead_time 以降。
  const earliestStartMs = now.getTime() + settings.minLeadTimeMinutes * 60000;
  if (input.startAt.getTime() < earliestStartMs) return { ok: false, reason: "too_soon" };

  // advance: 予約日は now の JST 暦日 + max_advance_days 以内。
  const lastAllowedJstDate = jstDateString(
    new Date(now.getTime() + settings.maxAdvanceDays * 86400000),
  );
  const startJstDate = jstDateString(input.startAt);
  if (startJstDate > lastAllowedJstDate) return { ok: false, reason: "too_far" };

  // 営業時間 / 定休日。
  const windows = await computeDayWindows(db, {
    storeId: input.storeId,
    laneId: input.laneId,
    jstDate: startJstDate,
    dayOfWeek: jstDayOfWeek(input.startAt),
  });
  if (windows.length === 0) return { ok: false, reason: "closed" };

  // start/end を「startAt の JST 暦日 00:00 からの経過分」で測る
  // (cross-day や endAt のずれを robust に弾く: 営業時間は同日終了のため end が翌日なら窓外)。
  const jstMidnight = jstDateTimeToUtc(startJstDate, "00:00:00").getTime();
  const startMin = (input.startAt.getTime() - jstMidnight) / 60000;
  const endMin = (input.endAt.getTime() - jstMidnight) / 60000;
  const fits = windows.some((w) => w.startMin <= startMin && endMin <= w.endMin);
  if (!fits) return { ok: false, reason: "outside_business_hours" };

  return { ok: true };
}

// ---------------------------------------------------------------------------
// PICKER: 指定 JST 暦日の空き枠を列挙 (UI の空き枠 picker 用)
// ---------------------------------------------------------------------------

export const listAvailableSlotsSchema = z.object({
  storeId: z.string().uuid(),
  laneId: z.string().uuid(),
  workMenuId: z.string().uuid().optional(),
  // JST 暦日 'YYYY-MM-DD'。
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  // workMenu 未指定時の所要時間 (分)。未指定なら slot_interval を使う。
  durationMinutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60)
    .optional(),
});

export type ListAvailableSlotsInput = z.infer<typeof listAvailableSlotsSchema>;

export type AvailableSlot = { startAt: Date; endAt: Date };

export type ListAvailableSlotsResult =
  | { ok: true; slots: AvailableSlot[] }
  | { ok: false; reason: ContextFailureReason };

export async function listAvailableSlots(
  rawInput: ListAvailableSlotsInput,
  options: AvailabilityOptions = {},
): Promise<ListAvailableSlotsResult> {
  const input = listAvailableSlotsSchema.parse(rawInput);
  const db: Db = options.db ?? serviceRoleDb;
  const now = options.now ?? new Date();

  const resolved = await resolveContext(db, {
    storeId: input.storeId,
    laneId: input.laneId,
    workMenuId: input.workMenuId,
  });
  if (!resolved.ok) return { ok: false, reason: resolved.reason };

  const settings = await resolveSettings(db, resolved.ctx.companyId, input.storeId);
  const duration =
    resolved.ctx.menuDurationMinutes ?? input.durationMinutes ?? settings.slotIntervalMinutes;

  // advance 窓外の日付は即空。
  const lastAllowedJstDate = jstDateString(
    new Date(now.getTime() + settings.maxAdvanceDays * 86400000),
  );
  if (input.date > lastAllowedJstDate) return { ok: true, slots: [] };

  // 対象日の dow (正午 JST を基準に算出して DST/境界の影響を避ける — JST は DST なしだが堅牢に)。
  const dayOfWeek = jstDayOfWeek(jstDateTimeToUtc(input.date, "12:00:00"));
  const windows = await computeDayWindows(db, {
    storeId: input.storeId,
    laneId: input.laneId,
    jstDate: input.date,
    dayOfWeek,
  });
  if (windows.length === 0) return { ok: true, slots: [] };

  const jstMidnightMs = jstDateTimeToUtc(input.date, "00:00:00").getTime();
  const earliestStartMs = now.getTime() + settings.minLeadTimeMinutes * 60000;

  // 当日の既存予約 (not-deleted) を取得し buffer で pad して占有区間とする。
  const dayStart = new Date(jstMidnightMs);
  const dayEnd = new Date(jstMidnightMs + 24 * 60 * 60000);
  const existing = await db
    .select({ startAt: reservations.startAt, endAt: reservations.endAt })
    .from(reservations)
    .where(
      and(
        eq(reservations.laneId, input.laneId),
        isNull(reservations.deletedAt),
        lt(reservations.startAt, dayEnd),
        gt(reservations.endAt, dayStart),
      ),
    );
  const blocked = existing.map((r: { startAt: Date; endAt: Date }) => ({
    start: r.startAt.getTime() - settings.bufferBeforeMinutes * 60000,
    end: r.endAt.getTime() + settings.bufferAfterMinutes * 60000,
  }));

  const slots: AvailableSlot[] = [];
  for (const w of windows) {
    for (let startMin = w.startMin; startMin + duration <= w.endMin; startMin += settings.slotIntervalMinutes) {
      const startMs = jstMidnightMs + startMin * 60000;
      const endMs = startMs + duration * 60000;
      if (startMs < earliestStartMs) continue;
      const overlapsExisting = blocked.some(
        (b: { start: number; end: number }) => startMs < b.end && endMs > b.start,
      );
      if (overlapsExisting) continue;
      slots.push({ startAt: new Date(startMs), endAt: new Date(endMs) });
    }
  }
  return { ok: true, slots };
}
