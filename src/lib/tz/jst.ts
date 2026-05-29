// JST (Asia/Tokyo) 固定のタイムゾーン変換ヘルパ。
// ---------------------------------------------------------------------------
//
// spec/data-model.md §1.9: 全 timestamp は timestamptz で UTC 保存、表示は JST 固定。
// requirements.md §69: TZ = UTC 保存 / JST 表示固定。
// JST は DST を持たない (固定 +09:00) が、+9h の手計算ではなく date-fns-tz を使い、
// 将来 companies.time_zone を参照する拡張 (海外展開) への置き換え点を 1 箇所に閉じ込める。
//
// 時刻列 (time without time zone: store_business_hours.opens_at 等) は「JST 壁時計」、
// 予約は timestamptz (UTC instant)。両者を突合するため、UTC instant ⇔ JST 壁時計の
// 変換をここに集約する。machine の TZ 設定に依存しないよう formatInTimeZone /
// fromZonedTime を用いる (toZonedTime + local getter は machine TZ 依存のため避ける)。

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const JST_TIME_ZONE = "Asia/Tokyo";

// UTC instant の JST 曜日 (0=日, 1=月, ..., 6=土)。
// day_of_week 列の規約 (spec/data-model.md: 0=Sun) と JS Date.getDay() / Postgres DOW に一致。
export function jstDayOfWeek(instant: Date): number {
  // 'i' = ISO 曜日 (1=月 .. 7=日)。% 7 で 日=0, 月=1, ..., 土=6 に正規化。
  const isoDay = Number(formatInTimeZone(instant, JST_TIME_ZONE, "i"));
  return isoDay % 7;
}

// UTC instant の JST 暦日 'YYYY-MM-DD' (store_holidays.holiday_date との突合用)。
export function jstDateString(instant: Date): string {
  return formatInTimeZone(instant, JST_TIME_ZONE, "yyyy-MM-dd");
}

// UTC instant の「JST 暦日 00:00 からの経過分」(0-1439)。
export function jstMinutesOfDay(instant: Date): number {
  const [hh, mm] = formatInTimeZone(instant, JST_TIME_ZONE, "HH:mm").split(":");
  return Number(hh) * 60 + Number(mm);
}

// JST 暦日 'YYYY-MM-DD' + 時刻 'HH:MM' or 'HH:MM:SS' → UTC instant。
export function jstDateTimeToUtc(dateStr: string, timeStr: string): Date {
  return fromZonedTime(`${dateStr}T${normalizeTime(timeStr)}`, JST_TIME_ZONE);
}

// 時刻文字列 'HH:MM' or 'HH:MM:SS' → 0:00 からの経過分。
export function timeStringToMinutes(timeStr: string): number {
  const [hh, mm] = timeStr.split(":");
  return Number(hh) * 60 + Number(mm);
}

// 'H:M' / 'HH:MM' / 'HH:MM:SS' を 'HH:MM:SS' に正規化。
function normalizeTime(timeStr: string): string {
  const [h = "0", m = "0", s = "0"] = timeStr.split(":");
  const pad = (v: string): string => v.padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
