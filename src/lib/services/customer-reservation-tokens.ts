/**
 * customer_reservation_tokens use-case service (Phase 64-A.21)
 *
 * 設計判断 (handoff §76 / advisor 確定):
 * 1. DB drift: spec/data-model.md §3.7 は stale (customer_id NOT NULL + purpose 列を記載) だが、
 *    実 DDL (`alpha-1-public/11_reservations.sql`) と drizzle schema は
 *    customer_id nullable + no purpose + used_at + soft delete (deleted_at)。
 *    permissions ケース同型で DB を真実採用、spec 改定は別 phase。
 * 2. master CRUD ではなく use-case service: issueToken / verifyAndConsumeToken / revokeToken が主、
 *    一覧/詳細は admin 診断補助。new ページなし (token 発行は将来の予約発行 server-side flow から呼ぶ)。
 * 3. verify+consume は **1 文の UPDATE + RETURNING** で atomic 実装 (race condition 防止)。
 *    0 行返却時は別 SELECT で reason 区別 (not_found / expired / used / revoked)。
 * 4. MVP は single-use 固定: spec §3.7 注釈 "view 用途は multi-use 想定" は purpose 列実装まで保留。
 * 5. token hash 方式: crypto.randomBytes(32) = 256 bit エントロピー → sha256 hex 64 chars hash。
 *    生 token は issueToken の戻り値で 1 回だけ返却、DB には hash のみ保存。
 * 6. rate limit なし (MVP 後ろ送り。256 bit エントロピー前提)。
 * 7. service_role 経路は Phase 4 顧客 UI 統合時に別関数追加。今 phase は全て company-scoped。
 */

import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { z } from "zod";
import { db as serviceRoleDb } from "@/lib/db/client";
import { auditLogs } from "@/lib/db/schema/audit_logs";
import {
  customerReservationTokens,
  type CustomerReservationToken,
} from "@/lib/db/schema/customer_reservation_tokens";
import { reservations } from "@/lib/db/schema/reservations";

export type CustomerReservationTokenContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

// ---------------------------------------------------------------------------
// Token generation / hashing
// ---------------------------------------------------------------------------

const TOKEN_BYTES = 32; // 256-bit entropy

function generateRawToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("hex");
}

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const TTL_MIN_MINUTES = 1;
const TTL_MAX_MINUTES = 60 * 24 * 30; // 30 days

export const IssueTokenInput = z
  .object({
    reservationId: z.string().uuid(),
    customerId: z.string().uuid().nullable().optional(),
    ttlMinutes: z.number().int().min(TTL_MIN_MINUTES).max(TTL_MAX_MINUTES),
  })
  .strict();

export type IssueTokenInput = z.input<typeof IssueTokenInput>;

const rawTokenSchema = z
  .string()
  .trim()
  .min(1, "rawToken is required")
  .max(256, "rawToken too long");

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type IssueTokenResult = {
  id: string;
  rawToken: string;
  expiresAt: Date;
};

export type VerifyReason =
  | "ok"
  | "not_found"
  | "expired"
  | "used"
  | "revoked";

export type VerifyAndConsumeResult =
  | { ok: true; reason: "ok"; token: CustomerReservationToken }
  | { ok: false; reason: Exclude<VerifyReason, "ok"> };

export type CustomerReservationTokenListItem = {
  id: string;
  companyId: string;
  reservationId: string;
  customerId: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CustomerReservationTokenDetail = CustomerReservationTokenListItem;

export type CustomerReservationTokenListFilters = {
  reservationId?: string;
  customerId?: string;
  status?: "active" | "used" | "expired" | "revoked";
  page?: number;
  limit?: number;
  includeRevoked?: boolean;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TokenReservationNotFoundError extends Error {
  constructor(reservationId: string) {
    super(
      `reservation ${reservationId} not found in this company (cannot issue token)`,
    );
    this.name = "TokenReservationNotFoundError";
  }
}

export class TokenHashCollisionError extends Error {
  constructor() {
    super("token_hash collision (extremely unlikely; please retry)");
    this.name = "TokenHashCollisionError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return (err as { code?: unknown }).code === "23505";
}

// ---------------------------------------------------------------------------
// SELECT projection helper
// ---------------------------------------------------------------------------

function selectListColumns(ctx: CustomerReservationTokenContext) {
  return ctx.db
    .select({
      id: customerReservationTokens.id,
      companyId: customerReservationTokens.companyId,
      reservationId: customerReservationTokens.reservationId,
      customerId: customerReservationTokens.customerId,
      expiresAt: customerReservationTokens.expiresAt,
      usedAt: customerReservationTokens.usedAt,
      deletedAt: customerReservationTokens.deletedAt,
      createdAt: customerReservationTokens.createdAt,
      updatedAt: customerReservationTokens.updatedAt,
    })
    .from(customerReservationTokens);
}

// ---------------------------------------------------------------------------
// issueToken: 新規発行 (raw token は 1 回だけ返却)
// ---------------------------------------------------------------------------

export async function issueToken(
  input: IssueTokenInput,
  ctx: CustomerReservationTokenContext,
): Promise<IssueTokenResult> {
  const parsed = IssueTokenInput.parse(input);

  // reservation が同テナント内に存在するか検証 (不正な reservationId を弾く)
  const reservationRows = await ctx.db
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.id, parsed.reservationId),
        eq(reservations.companyId, ctx.companyId),
      ),
    )
    .limit(1);
  if (reservationRows.length === 0) {
    throw new TokenReservationNotFoundError(parsed.reservationId);
  }

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + parsed.ttlMinutes * 60 * 1000);

  try {
    const rows = await ctx.db
      .insert(customerReservationTokens)
      .values({
        companyId: ctx.companyId,
        reservationId: parsed.reservationId,
        customerId: parsed.customerId ?? null,
        tokenHash,
        expiresAt,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("customer_reservation_tokens insert returned no rows");

    return {
      id: row.id,
      rawToken,
      expiresAt: row.expiresAt,
    };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new TokenHashCollisionError();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// verifyAndConsumeToken: atomic UPDATE + RETURNING で race condition 防止
// ---------------------------------------------------------------------------

export async function verifyAndConsumeToken(
  rawToken: string,
  ctx: CustomerReservationTokenContext,
): Promise<VerifyAndConsumeResult> {
  const parsed = rawTokenSchema.parse(rawToken);
  const tokenHash = hashToken(parsed);

  // 1 文の UPDATE で verify と consume を atomic に実施。
  // 0 行返却 = いずれかの条件が満たされない (理由は別 SELECT で特定)。
  const updated = await ctx.db
    .update(customerReservationTokens)
    .set({ usedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(customerReservationTokens.tokenHash, tokenHash),
        eq(customerReservationTokens.companyId, ctx.companyId),
        isNull(customerReservationTokens.usedAt),
        isNull(customerReservationTokens.deletedAt),
        sql`${customerReservationTokens.expiresAt} > now()`,
      ),
    )
    .returning();

  if (updated.length > 0) {
    return { ok: true, reason: "ok", token: updated[0] as CustomerReservationToken };
  }

  // 失敗理由を区別するため、hash で再 SELECT (company scope, 削除済み含む)
  const existing = await ctx.db
    .select()
    .from(customerReservationTokens)
    .where(
      and(
        eq(customerReservationTokens.tokenHash, tokenHash),
        eq(customerReservationTokens.companyId, ctx.companyId),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    return { ok: false, reason: "not_found" };
  }
  const row = existing[0] as CustomerReservationToken;
  if (row.deletedAt !== null) {
    return { ok: false, reason: "revoked" };
  }
  if (row.usedAt !== null) {
    return { ok: false, reason: "used" };
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  // 上記すべて NG ではないがアトミック UPDATE が当たらなかった (理論上ありえないが安全側)
  return { ok: false, reason: "not_found" };
}

// ---------------------------------------------------------------------------
// revokeToken: soft delete (deleted_at にタイムスタンプ)
// ---------------------------------------------------------------------------

export async function revokeToken(
  id: string,
  ctx: CustomerReservationTokenContext,
): Promise<boolean> {
  const rows = await ctx.db
    .update(customerReservationTokens)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(customerReservationTokens.id, id),
        eq(customerReservationTokens.companyId, ctx.companyId),
        isNull(customerReservationTokens.deletedAt),
      ),
    )
    .returning({ id: customerReservationTokens.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// listTokens: 一覧 (admin 診断補助、token_hash は返さない)
// ---------------------------------------------------------------------------

export async function listTokens(
  filters: CustomerReservationTokenListFilters,
  ctx: CustomerReservationTokenContext,
): Promise<{ rows: CustomerReservationTokenListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const includeRevoked = filters.includeRevoked === true;

  const predicates = [
    eq(customerReservationTokens.companyId, ctx.companyId),
    includeRevoked ? undefined : isNull(customerReservationTokens.deletedAt),
    filters.reservationId
      ? eq(customerReservationTokens.reservationId, filters.reservationId)
      : undefined,
    filters.customerId
      ? eq(customerReservationTokens.customerId, filters.customerId)
      : undefined,
    filters.status === "active"
      ? and(
          isNull(customerReservationTokens.usedAt),
          isNull(customerReservationTokens.deletedAt),
          sql`${customerReservationTokens.expiresAt} > now()`,
        )
      : undefined,
    filters.status === "used"
      ? sql`${customerReservationTokens.usedAt} IS NOT NULL`
      : undefined,
    filters.status === "expired"
      ? and(
          isNull(customerReservationTokens.usedAt),
          isNull(customerReservationTokens.deletedAt),
          sql`${customerReservationTokens.expiresAt} <= now()`,
        )
      : undefined,
    filters.status === "revoked"
      ? sql`${customerReservationTokens.deletedAt} IS NOT NULL`
      : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

  const [rows, totalRows] = await Promise.all([
    selectListColumns(ctx)
      .where(and(...predicates))
      .orderBy(desc(customerReservationTokens.createdAt))
      .limit(limit)
      .offset(offset),
    ctx.db
      .select({ value: count() })
      .from(customerReservationTokens)
      .where(and(...predicates)),
  ]);

  return {
    rows: rows as CustomerReservationTokenListItem[],
    total: Number(totalRows[0]?.value ?? 0),
  };
}

// ---------------------------------------------------------------------------
// getTokenById: 詳細 (token_hash は返さない)
// ---------------------------------------------------------------------------

export async function getTokenById(
  id: string,
  ctx: CustomerReservationTokenContext,
): Promise<CustomerReservationTokenDetail | null> {
  const rows = await selectListColumns(ctx)
    .where(
      and(
        eq(customerReservationTokens.id, id),
        eq(customerReservationTokens.companyId, ctx.companyId),
      ),
    )
    .limit(1);
  return (rows[0] as CustomerReservationTokenDetail | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// verifyAndConsumeTokenViaServiceRole: Phase 64-A.23 顧客 facing wrapper
// ---------------------------------------------------------------------------
//
// 顧客は Supabase Auth user ではないため company scope を引数で受け取れない。
// token hash から company を導出し、RLS bypass の serviceRoleDb 上で
// SELECT (company 取得) → atomic UPDATE+RETURNING → 成功時のみ audit_logs INSERT
// を 1 tx で実行する。
//
// spec/CLAUDE.md §ADR-0010 補項 / spec/data-model.md §14.5-14.6 準拠。
// audit_logs.companyId / entityId は NOT NULL のため、失敗時 (not_found 等) は
// 監査ログを残さない (caller が必要なら別途警告)。
//
// 戻り型は既存 verifyAndConsumeToken と同じ discriminated union。

export type VerifyViaServiceRoleOptions = {
  ipAddress?: string | null;
  userAgent?: string | null;
  db?: CustomerReservationTokenContext["db"];
};

// ---------------------------------------------------------------------------
// loadTokenStatusViaServiceRole: GET render 用 read-only 検証 (consume しない)
// ---------------------------------------------------------------------------
//
// GET で token を消費すると Slack/Discord unfurl、ブラウザ prefetch、メール scanner
// (Microsoft ATP / Proofpoint) で token が焼かれて顧客が開く前に "used" になる。
// HTTP GET は safe/idempotent でなければならない (RFC 7231) ため、
// GET page では本関数で status のみ確認し、実際の consume は form POST で
// verifyAndConsumeTokenViaServiceRole を呼ぶ 2 段構成にする。
//
// 監査ログは残さない (consume していないため)。

export type LoadTokenStatusResult =
  | { ok: true; reason: "ok"; tokenId: string; reservationId: string }
  | { ok: false; reason: Exclude<VerifyReason, "ok"> };

export async function loadTokenStatusViaServiceRole(
  rawToken: string,
  options: VerifyViaServiceRoleOptions = {},
): Promise<LoadTokenStatusResult> {
  const parsed = rawTokenSchema.parse(rawToken);
  const tokenHash = hashToken(parsed);
  const baseDb = options.db ?? serviceRoleDb;

  const rows = await baseDb
    .select()
    .from(customerReservationTokens)
    .where(eq(customerReservationTokens.tokenHash, tokenHash))
    .limit(1);

  if (rows.length === 0) {
    return { ok: false, reason: "not_found" };
  }
  const row = rows[0] as CustomerReservationToken;

  if (row.deletedAt !== null) {
    return { ok: false, reason: "revoked" };
  }
  if (row.usedAt !== null) {
    return { ok: false, reason: "used" };
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    reason: "ok",
    tokenId: row.id,
    reservationId: row.reservationId,
  };
}

export async function verifyAndConsumeTokenViaServiceRole(
  rawToken: string,
  options: VerifyViaServiceRoleOptions = {},
): Promise<VerifyAndConsumeResult> {
  const parsed = rawTokenSchema.parse(rawToken);
  const tokenHash = hashToken(parsed);
  const baseDb = options.db ?? serviceRoleDb;

  return baseDb.transaction(
    async (tx: CustomerReservationTokenContext["db"]): Promise<VerifyAndConsumeResult> => {
      const existing = await tx
        .select()
        .from(customerReservationTokens)
        .where(eq(customerReservationTokens.tokenHash, tokenHash))
        .limit(1);

      if (existing.length === 0) {
        return { ok: false, reason: "not_found" };
      }
      const candidate = existing[0] as CustomerReservationToken;

      if (candidate.deletedAt !== null) {
        return { ok: false, reason: "revoked" };
      }
      if (candidate.usedAt !== null) {
        return { ok: false, reason: "used" };
      }
      if (candidate.expiresAt.getTime() <= Date.now()) {
        return { ok: false, reason: "expired" };
      }

      const updated = await tx
        .update(customerReservationTokens)
        .set({ usedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(customerReservationTokens.id, candidate.id),
            isNull(customerReservationTokens.usedAt),
            isNull(customerReservationTokens.deletedAt),
            sql`${customerReservationTokens.expiresAt} > now()`,
          ),
        )
        .returning();

      if (updated.length === 0) {
        // 競合: SELECT 後に他リクエストが consume / revoke / expire させた
        return { ok: false, reason: "used" };
      }
      const consumed = updated[0] as CustomerReservationToken;

      // audit_logs.action は CHECK 制約 ('create','update','delete','restore') 限定。
      // token consume は usedAt の UPDATE なので action='update'、kind を after_json で区別。
      await tx.insert(auditLogs).values({
        companyId: consumed.companyId,
        entityType: "customer_reservation_token",
        entityId: consumed.id,
        action: "update",
        actorKind: "system",
        afterJson: {
          kind: "customer_verify_consume",
          reservationId: consumed.reservationId,
        },
        ipAddress: options.ipAddress ?? null,
        userAgent: options.userAgent ?? null,
      });

      return { ok: true, reason: "ok", token: consumed };
    },
  );
}
