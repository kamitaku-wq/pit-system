// statuses.color の解決と badge / calendar 用スタイル導出 (Phase 69 S0a)。
// DB の color (hex, admin がステータス設定で指定) を最優先し、未設定 (NULL) の場合は
// status の key の意味から既定色にフォールバックする。
// confirmed デザイン (docs/assets/screenshots/c2-calendar.png): 確定=緑 / 仮=黄 / 作業中=青。

const HEX6 = /^#[0-9a-fA-F]{6}$/;

const NEUTRAL = "#64748b"; // slate-500

// key (lowercase) → hex。company 横断の共通既定。会社固有色は DB の color で上書きされる。
const DEFAULT_BY_KEY: Record<string, string> = {
  // 確定・受諾・有効系 → green
  confirmed: "#16a34a",
  accepted: "#16a34a",
  approved: "#16a34a",
  active: "#16a34a",
  open: "#16a34a",
  // 仮・保留・打診中系 → amber
  pending: "#d97706",
  tentative: "#d97706",
  hold: "#d97706",
  invited: "#d97706",
  awaiting: "#d97706",
  requested: "#d97706",
  // 作業中・進行中系 → blue
  in_progress: "#2563eb",
  processing: "#2563eb",
  working: "#2563eb",
  dispatched: "#2563eb",
  // 完了系 → cyan / slate
  completed: "#0891b2",
  done: "#0891b2",
  closed: "#475569",
  // 中止・却下・失敗系 → red / gray
  cancelled: "#dc2626",
  canceled: "#dc2626",
  rejected: "#dc2626",
  declined: "#dc2626",
  failed: "#dc2626",
  no_show: "#b91c1c",
  expired: "#9ca3af",
};

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX6.test(value);
}

export type StatusColorInput = {
  color?: string | null;
  statusType?: string | null;
  key?: string | null;
};

/** status の表示色 (hex) を解決する。DB color を最優先、次に key 既定、最後に neutral。 */
export function resolveStatusColor(status: StatusColorInput): string {
  if (isHexColor(status.color)) return status.color;
  const key = status.key?.toLowerCase().trim();
  if (key && DEFAULT_BY_KEY[key]) return DEFAULT_BY_KEY[key];
  return NEUTRAL;
}

export type BadgeStyle = {
  color: string;
  backgroundColor: string;
  borderColor: string;
};

/** hex base から badge 用の淡色背景 (10% alpha) + 濃色文字 (20% border) を導出する。 */
export function statusBadgeStyle(status: StatusColorInput): BadgeStyle {
  const base = resolveStatusColor(status);
  return {
    color: base,
    backgroundColor: `${base}1a`,
    borderColor: `${base}33`,
  };
}

/** 既定色マップ (テスト・参照用)。 */
export const DEFAULT_STATUS_COLORS: Readonly<Record<string, string>> = DEFAULT_BY_KEY;
export const NEUTRAL_STATUS_COLOR = NEUTRAL;
