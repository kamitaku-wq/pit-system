import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { vendorAvailableDays, type VendorAvailableDay } from "@/lib/db/schema/vendor_available_days";
import { vendors } from "@/lib/db/schema/vendors";

export type VendorAvailableDayContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

export class VendorNotFoundError extends Error {
  constructor(vendorId: string) {
    super(`vendor ${vendorId} not found in this company`);
    this.name = "VendorNotFoundError";
  }
}

export class VendorAvailableDayConstraintError extends Error {
  constructor(public readonly detail: string) {
    super(`vendor_available_day constraint violated: ${detail}`);
    this.name = "VendorAvailableDayConstraintError";
  }
}

const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
const isoTime = z.string().regex(timeRegex, "must be HH:MM or HH:MM:SS");

const RowInput = z
  .object({
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    startsAt: isoTime.nullable().optional(),
    endsAt: isoTime.nullable().optional(),
  })
  .strict();

export const ReplaceVendorAvailableDaysInput = z
  .object({
    rows: z.array(RowInput),
  })
  .strict();

export type ReplaceVendorAvailableDaysInput = z.input<typeof ReplaceVendorAvailableDaysInput>;

export type VendorAvailableDayListItem = {
  id: string;
  dayOfWeek: number;
  startsAt: string | null;
  endsAt: string | null;
};

function normalizeTimeToHms(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // HH:MM → HH:MM:00 に補完 (PG time デフォルト書式に合わせる)
  return /^\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}:00` : trimmed;
}

async function assertVendorInCompany(
  ctx: VendorAvailableDayContext,
  vendorId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx?: any,
): Promise<void> {
  const exec = tx ?? ctx.db;
  const rows = await exec
    .select({ id: vendors.id })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), eq(vendors.companyId, ctx.companyId), isNull(vendors.deletedAt)))
    .limit(1);
  if (rows.length === 0) throw new VendorNotFoundError(vendorId);
}

export async function listVendorAvailableDaysByVendorId(
  vendorId: string,
  ctx: VendorAvailableDayContext,
): Promise<VendorAvailableDayListItem[]> {
  await assertVendorInCompany(ctx, vendorId);
  const rows = await ctx.db
    .select({
      id: vendorAvailableDays.id,
      dayOfWeek: vendorAvailableDays.dayOfWeek,
      startsAt: vendorAvailableDays.startsAt,
      endsAt: vendorAvailableDays.endsAt,
    })
    .from(vendorAvailableDays)
    .where(
      and(
        eq(vendorAvailableDays.vendorId, vendorId),
        eq(vendorAvailableDays.companyId, ctx.companyId),
      ),
    )
    .orderBy(asc(vendorAvailableDays.dayOfWeek), asc(vendorAvailableDays.startsAt));
  return rows as VendorAvailableDayListItem[];
}

export type ReplaceVendorAvailableDaysResult = {
  removed: number;
  inserted: number;
};

export async function replaceVendorAvailableDays(
  vendorId: string,
  input: ReplaceVendorAvailableDaysInput,
  ctx: VendorAvailableDayContext,
): Promise<ReplaceVendorAvailableDaysResult> {
  const parsed = ReplaceVendorAvailableDaysInput.parse(input);

  // service 側 CHECK 防衛: starts_at < ends_at (両方 NULL OR どちらか NULL 以外で starts < ends)
  for (const row of parsed.rows) {
    const startNorm = normalizeTimeToHms(row.startsAt ?? null);
    const endNorm = normalizeTimeToHms(row.endsAt ?? null);
    if (startNorm !== null && endNorm !== null && startNorm >= endNorm) {
      throw new VendorAvailableDayConstraintError(
        `starts_at must be < ends_at (got ${startNorm} / ${endNorm} on day ${row.dayOfWeek})`,
      );
    }
  }

  // Drizzle transaction; nested savepoint when ctx.db is already a transaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await ctx.db.transaction(async (tx: any): Promise<ReplaceVendorAvailableDaysResult> => {
    await assertVendorInCompany(ctx, vendorId, tx);

    const deleted = await tx
      .delete(vendorAvailableDays)
      .where(
        and(
          eq(vendorAvailableDays.vendorId, vendorId),
          eq(vendorAvailableDays.companyId, ctx.companyId),
        ),
      )
      .returning({ id: vendorAvailableDays.id });

    let inserted = 0;
    if (parsed.rows.length > 0) {
      const insertedRows = await tx
        .insert(vendorAvailableDays)
        .values(
          parsed.rows.map((row) => ({
            companyId: ctx.companyId,
            vendorId,
            dayOfWeek: row.dayOfWeek,
            startsAt: normalizeTimeToHms(row.startsAt ?? null),
            endsAt: normalizeTimeToHms(row.endsAt ?? null),
          })),
        )
        .returning({ id: vendorAvailableDays.id });
      inserted = insertedRows.length;
    }

    return { removed: deleted.length, inserted };
  });
}

export type { VendorAvailableDay };
