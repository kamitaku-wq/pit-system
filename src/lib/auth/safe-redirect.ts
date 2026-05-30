// Phase 66: 認証後リダイレクトのオープンリダイレクト防止。
// 内部パス (先頭 "/" かつ "//" でない) のみ許可し、外部 URL / protocol-relative URL を弾く。
// 社内ユーザーの既定遷移先は管理ダッシュボード。
export function safeNextPath(value: string | null | undefined, fallback = "/admin/dashboard"): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}
