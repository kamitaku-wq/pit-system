/**
 * reservation_verification_codes の純粋ロジック (Phase 64-A.32a)
 *
 * React/DB/server に非依存 — unit テストが serviceRoleDb を引き込まないよう、
 * コード生成・ハッシュ・正規化・定数のみをここに集約する (reservation-payload.ts と同型の分離)。
 *
 * 脅威モデル (6 桁 = ~20bit と低エントロピー):
 * - code_hash は HMAC-SHA256(pepper, companyId:email:code)。pepper は環境変数のみに保持し DB 非格納。
 *   生 SHA-256 は 10^6 空間を即時逆引きできるため「平文保存」と等価 → pepper 必須 (敵対的レビュー HIGH#2)。
 * - HMAC に companyId/email を畳み込むことで email binding を暗号構造で強制する (cross-email 一致が起きない)。
 * - 比較は timing-safe (crypto.timingSafeEqual)。
 *
 * 設計詳細: phase-handoff/phase-64-a32a-design-plan.md
 */

import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

export const RESERVATION_VERIFICATION_CODE_LENGTH = 6;
export const DEFAULT_TTL_MINUTES = 10;
export const DEFAULT_MAX_ATTEMPTS = 5;
// 同一 (company, email) の発行レート guard (再発行ブルートフォース緩和、敵対的レビュー HIGH#4)。
// 本格的な IP/global 送信レート制限 + Turnstile は A.33。
export const ISSUE_RATE_WINDOW_MINUTES = 10;
export const ISSUE_RATE_MAX = 5;
// pepper は十分なエントロピーを要求する (短い値での誤設定を fail-fast)。
export const PEPPER_MIN_LENGTH = 16;
export const PEPPER_ENV_VAR = "RESERVATION_VERIFICATION_CODE_PEPPER";

// ---------------------------------------------------------------------------
// email 正規化 (issue / verify 双方の入口で必ず呼ぶ。DB CHECK (email = lower(email)) と対称)
// ---------------------------------------------------------------------------

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// 6 桁コード生成 (unbiased CSPRNG)
// ---------------------------------------------------------------------------

// crypto.randomInt(0, max) は modulo bias のない一様乱数。padStart で先頭 0 を保持。
export function generateNumericCode(length: number = RESERVATION_VERIFICATION_CODE_LENGTH): string {
  if (!Number.isInteger(length) || length < 1 || length > 12) {
    throw new Error(`generateNumericCode: length must be 1..12 (got ${length})`);
  }
  const max = 10 ** length;
  return crypto.randomInt(0, max).toString().padStart(length, "0");
}

// ---------------------------------------------------------------------------
// pepper 解決 (lazy: module load 時に env を要求しない → import が env に依存しない)
// ---------------------------------------------------------------------------

export function resolvePepper(override?: string): string {
  const pepper = override ?? process.env[PEPPER_ENV_VAR];
  if (typeof pepper !== "string" || pepper.length < PEPPER_MIN_LENGTH) {
    throw new Error(
      `${PEPPER_ENV_VAR} must be set to a string of at least ${PEPPER_MIN_LENGTH} characters`,
    );
  }
  return pepper;
}

// ---------------------------------------------------------------------------
// code_hash = HMAC-SHA256(pepper, companyId:email:code)
// ---------------------------------------------------------------------------

export type HashCodeInput = {
  companyId: string;
  email: string;
  code: string;
  pepper: string;
};

// companyId は UUID 固定長、code は数字固定長のため `:` 連結は曖昧性なし (triple が衝突しない)。
// email は service が normalize 済みでも、ここでも normalize して取り違えを防ぐ (冪等)。
export function hashCode(input: HashCodeInput): string {
  const message = `${input.companyId}:${normalizeEmail(input.email)}:${input.code}`;
  return crypto.createHmac("sha256", input.pepper).update(message, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// timing-safe な hex 文字列比較
// ---------------------------------------------------------------------------

export function timingSafeEqualHex(a: string, b: string): boolean {
  // 長さ不一致は timingSafeEqual が throw するため先に弾く (長さの一致/不一致は秘密ではない)。
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
