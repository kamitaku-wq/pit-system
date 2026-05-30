// Phase 66: 社内ユーザー Google ログインの「許可ドメイン」判定 (純粋関数、unit test 対象)。
//
// セキュリティの核: Google が返す検証済み email のドメインだけを信用し、許可ドメインと
// **厳密一致** で照合する。endsWith / includes は使わない (サブドメイン詐称
// `x@kaisha.co.jp.evil.com` や `attacker@evil-kaisha.co.jp` を弾くため)。

// email からドメイン部 (最後の @ 以降) を小文字で取り出す。不正な形なら null。
// 複数 @ を含む不正アドレスは最後の @ 以降を採用 (Google は正規アドレスのみ返すが防御的に)。
export function normalizeEmailDomain(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return null;
  const domain = trimmed.slice(at + 1);
  // ドメインに @ や空白が残る / 空 / ドットを含まないものは不正扱い。
  if (domain.length === 0 || domain.includes("@") || /\s/.test(domain) || !domain.includes(".")) {
    return null;
  }
  return domain;
}

// 許可ドメイン集合の正規化 (小文字 trim、空要素除去、@ 先頭除去)。
export function normalizeAllowedDomains(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const d = entry.trim().toLowerCase().replace(/^@/, "");
    if (d.length > 0) out.push(d);
  }
  return out;
}

// email のドメインが許可集合に厳密一致するか。許可集合が空なら常に false (fail-closed)。
export function isEmailDomainAllowed(
  email: string | null | undefined,
  allowedDomains: readonly string[],
): boolean {
  const domain = normalizeEmailDomain(email);
  if (domain === null) return false;
  const allowed = normalizeAllowedDomains(allowedDomains);
  if (allowed.length === 0) return false;
  return allowed.includes(domain);
}
