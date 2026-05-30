/**
 * attachments use-case service (Phase 64-A.22)
 *
 * 設計判断 (handoff §76 / advisor 確定):
 * 1. spec/data-model.md §12.1 は stale (entity_type/entity_id single polymorphic + storage_path + mime_type + size_bytes)。
 *    実 DDL (`alpha-1-public/16_attachments.sql`) と drizzle schema は multi-FK
 *    (service_ticket_id / reservation_id / transport_order_id, 全 nullable) + storage_bucket/key UNIQUE
 *    + content_type / byte_size + soft delete + checksum + ix_attachments_service_ticket。
 *    A.19 / A.21 と同型で DB を真実採用、spec §12.1 改定は別 phase。
 * 2. Storage 統合スコープは DB metadata のみ (signed URL 発行 / upload helper は Phase 4 統合で
 *    service_role 経由で別途追加)。今 phase は「Storage 側で既に upload 済みの metadata 登録」のみ。
 * 3. parent FK 制約: DDL に XOR CHECK が無い (3 FK 全 nullable) ため、Zod の parentType
 *    discriminator で「正確に 1 つ必須」を強制。raw-migration 変更 0 invariant 維持。
 * 4. mime_type whitelist / size cap は spec に具体値なし → MVP デフォルト
 *    (image/jpeg|png|webp + application/pdf, 10 MiB) を service 内 export const として固定、
 *    Phase 4 統合時に見直し対象 (hidden constraint コメントで明記)。
 * 5. parent entity の cross-tenant ownership 検証: A.21 と同型 pattern
 *    (registerAttachment 内で serviceTickets / reservations / transportOrders の companyId 一致を SELECT 先行)。
 *    異なる company の親 ID は AttachmentParentNotFoundError で弾く。
 * 6. master CRUD ではなく use-case service: registerAttachment / listAttachments /
 *    countAttachments / getAttachmentById / softDeleteAttachment の 5 関数。new ページなし
 *    (upload UI は Phase 4 統合で追加、admin は一覧 + 詳細 + softDelete のみ)。
 * 7. soft delete: deletedAt 有 (DB スキーマ準拠)。hard delete は今 phase で提供しない。
 */

import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { attachments, type Attachment } from "@/lib/db/schema/attachments";
import { reservations } from "@/lib/db/schema/reservations";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { transportOrders } from "@/lib/db/schema/transport_orders";

export type AttachmentContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

// ---------------------------------------------------------------------------
// MVP constraints (Phase 4 統合時に見直し対象)
// ---------------------------------------------------------------------------

export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const MAX_BYTE_SIZE = 10 * 1024 * 1024; // 10 MiB

export const PARENT_TYPES = [
  "service_ticket",
  "reservation",
  "transport_order",
] as const;

export type ParentType = (typeof PARENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const RegisterAttachmentInput = z
  .object({
    parentType: z.enum(PARENT_TYPES),
    parentId: z.string().uuid(),
    storageBucket: z.string().trim().min(1).max(63),
    storageKey: z.string().trim().min(1).max(1024),
    fileName: z.string().trim().min(1).max(255),
    contentType: z.enum(ALLOWED_MIME_TYPES).nullable().optional(),
    byteSize: z.number().int().min(0).max(MAX_BYTE_SIZE),
    checksum: z.string().trim().min(1).max(128).nullable().optional(),
    uploadedByUserId: z.string().uuid().nullable().optional(),
  })
  .strict();

export type RegisterAttachmentInput = z.input<typeof RegisterAttachmentInput>;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type AttachmentListItem = {
  id: string;
  companyId: string;
  serviceTicketId: string | null;
  reservationId: string | null;
  transportOrderId: string | null;
  uploadedByUserId: string | null;
  storageBucket: string;
  storageKey: string;
  fileName: string;
  contentType: string | null;
  byteSize: number;
  checksum: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type AttachmentDetail = AttachmentListItem;

export type AttachmentListFilters = {
  parentType?: ParentType;
  parentId?: string;
  uploadedByUserId?: string;
  includeDeleted?: boolean;
  page?: number;
  limit?: number;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AttachmentParentNotFoundError extends Error {
  constructor(parentType: ParentType, parentId: string) {
    super(
      `${parentType} ${parentId} not found in this company (cannot register attachment)`,
    );
    this.name = "AttachmentParentNotFoundError";
  }
}

export class AttachmentStorageConflictError extends Error {
  constructor(bucket: string, key: string) {
    super(`storage_bucket+storage_key already registered (${bucket}/${key})`);
    this.name = "AttachmentStorageConflictError";
  }
}

export class AttachmentNotFoundError extends Error {
  constructor(id: string) {
    super(`attachment ${id} not found in this company`);
    this.name = "AttachmentNotFoundError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return (err as { code?: unknown }).code === "23505";
}

// ---------------------------------------------------------------------------
// SELECT projection helper
// ---------------------------------------------------------------------------

function selectListColumns(ctx: AttachmentContext) {
  return ctx.db
    .select({
      id: attachments.id,
      companyId: attachments.companyId,
      serviceTicketId: attachments.serviceTicketId,
      reservationId: attachments.reservationId,
      transportOrderId: attachments.transportOrderId,
      uploadedByUserId: attachments.uploadedByUserId,
      storageBucket: attachments.storageBucket,
      storageKey: attachments.storageKey,
      fileName: attachments.fileName,
      contentType: attachments.contentType,
      byteSize: attachments.byteSize,
      checksum: attachments.checksum,
      createdAt: attachments.createdAt,
      updatedAt: attachments.updatedAt,
      deletedAt: attachments.deletedAt,
    })
    .from(attachments);
}

function buildListConditions(
  filters: AttachmentListFilters,
  ctx: AttachmentContext,
) {
  const conditions = [eq(attachments.companyId, ctx.companyId)];
  if (!filters.includeDeleted) conditions.push(isNull(attachments.deletedAt));
  if (filters.parentType && filters.parentId) {
    if (filters.parentType === "service_ticket") {
      conditions.push(eq(attachments.serviceTicketId, filters.parentId));
    } else if (filters.parentType === "reservation") {
      conditions.push(eq(attachments.reservationId, filters.parentId));
    } else {
      conditions.push(eq(attachments.transportOrderId, filters.parentId));
    }
  }
  if (filters.uploadedByUserId) {
    conditions.push(eq(attachments.uploadedByUserId, filters.uploadedByUserId));
  }
  return conditions;
}

// ---------------------------------------------------------------------------
// parent ownership verification (cross-tenant 防御)
// ---------------------------------------------------------------------------

async function verifyParentOwnership(
  ctx: AttachmentContext,
  parentType: ParentType,
  parentId: string,
): Promise<void> {
  if (parentType === "service_ticket") {
    const rows = await ctx.db
      .select({ id: serviceTickets.id })
      .from(serviceTickets)
      .where(
        and(
          eq(serviceTickets.id, parentId),
          eq(serviceTickets.companyId, ctx.companyId),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      throw new AttachmentParentNotFoundError(parentType, parentId);
    }
    return;
  }
  if (parentType === "reservation") {
    const rows = await ctx.db
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.id, parentId),
          eq(reservations.companyId, ctx.companyId),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      throw new AttachmentParentNotFoundError(parentType, parentId);
    }
    return;
  }
  // transport_order
  const rows = await ctx.db
    .select({ id: transportOrders.id })
    .from(transportOrders)
    .where(
      and(
        eq(transportOrders.id, parentId),
        eq(transportOrders.companyId, ctx.companyId),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new AttachmentParentNotFoundError(parentType, parentId);
  }
}

// ---------------------------------------------------------------------------
// registerAttachment: Storage upload 後の metadata 登録
// ---------------------------------------------------------------------------

export async function registerAttachment(
  input: RegisterAttachmentInput,
  ctx: AttachmentContext,
): Promise<AttachmentDetail> {
  const parsed = RegisterAttachmentInput.parse(input);

  await verifyParentOwnership(ctx, parsed.parentType, parsed.parentId);

  const values = {
    companyId: ctx.companyId,
    serviceTicketId:
      parsed.parentType === "service_ticket" ? parsed.parentId : null,
    reservationId:
      parsed.parentType === "reservation" ? parsed.parentId : null,
    transportOrderId:
      parsed.parentType === "transport_order" ? parsed.parentId : null,
    uploadedByUserId: parsed.uploadedByUserId ?? null,
    storageBucket: parsed.storageBucket,
    storageKey: parsed.storageKey,
    fileName: parsed.fileName,
    contentType: parsed.contentType ?? null,
    byteSize: parsed.byteSize,
    checksum: parsed.checksum ?? null,
  };

  try {
    const rows = await ctx.db
      .insert(attachments)
      .values(values)
      .returning();
    const row = rows[0];
    if (!row) {
      throw new Error("attachments insert returned no rows");
    }
    return toDetail(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AttachmentStorageConflictError(
        parsed.storageBucket,
        parsed.storageKey,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// listAttachments: parent filter / uploadedByUser filter / includeDeleted
// canonical pattern (customer-reservation-tokens.listTokens): { rows, total }
// ---------------------------------------------------------------------------

export async function listAttachments(
  filters: AttachmentListFilters,
  ctx: AttachmentContext,
): Promise<{ rows: AttachmentListItem[]; total: number }> {
  const conditions = buildListConditions(filters, ctx);

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const [rows, totalRows] = await Promise.all([
    selectListColumns(ctx)
      .where(and(...conditions))
      .orderBy(desc(attachments.createdAt))
      .limit(limit)
      .offset(offset),
    ctx.db
      .select({ value: count() })
      .from(attachments)
      .where(and(...conditions)),
  ]);

  return {
    rows: rows.map(toListItem),
    total: Number(totalRows[0]?.value ?? 0),
  };
}

// ---------------------------------------------------------------------------
// getAttachmentById
// ---------------------------------------------------------------------------

export async function getAttachmentById(
  id: string,
  ctx: AttachmentContext,
): Promise<AttachmentDetail | null> {
  const rows = await selectListColumns(ctx)
    .where(
      and(eq(attachments.id, id), eq(attachments.companyId, ctx.companyId)),
    )
    .limit(1);
  if (rows.length === 0) return null;
  return toDetail(rows[0]);
}

// ---------------------------------------------------------------------------
// softDeleteAttachment: deletedAt をセット (二重削除は AttachmentNotFoundError)
// ---------------------------------------------------------------------------

export async function softDeleteAttachment(
  id: string,
  ctx: AttachmentContext,
): Promise<AttachmentDetail> {
  const rows = await ctx.db
    .update(attachments)
    .set({ deletedAt: sql`now()` })
    .where(
      and(
        eq(attachments.id, id),
        eq(attachments.companyId, ctx.companyId),
        isNull(attachments.deletedAt),
      ),
    )
    .returning();
  const row = rows[0];
  if (!row) {
    throw new AttachmentNotFoundError(id);
  }
  return toDetail(row);
}

// ---------------------------------------------------------------------------
// row mappers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toListItem(row: any): AttachmentListItem {
  return {
    id: row.id,
    companyId: row.companyId,
    serviceTicketId: row.serviceTicketId,
    reservationId: row.reservationId,
    transportOrderId: row.transportOrderId,
    uploadedByUserId: row.uploadedByUserId,
    storageBucket: row.storageBucket,
    storageKey: row.storageKey,
    fileName: row.fileName,
    contentType: row.contentType,
    byteSize: Number(row.byteSize),
    checksum: row.checksum,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDetail(row: any): AttachmentDetail {
  return toListItem(row);
}

// re-export schema type for downstream consumers
export type { Attachment };
