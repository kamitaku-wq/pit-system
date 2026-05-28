import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { storeBusinessHours } from "@/lib/db/schema/store_business_hours";
import { stores } from "@/lib/db/schema/stores";

export type StoreBusinessHoursContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

export type StoreBusinessHourRow = {
  id: string;
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  acceptsReservations: boolean;
};

const timePattern = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function normalizeTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

const HourEntry = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    opensAt: z.string().regex(timePattern, "opens_at は HH:MM または HH:MM:SS"),
    closesAt: z.string().regex(timePattern, "closes_at は HH:MM または HH:MM:SS"),
    acceptsReservations: z.boolean().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (normalizeTime(val.opensAt) >= normalizeTime(val.closesAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "opens_at must be before closes_at",
        path: ["closesAt"],
      });
    }
  });

export const ReplaceStoreBusinessHoursInput = z
  .object({
    hours: z.array(HourEntry),
  })
  .strict();
export type ReplaceStoreBusinessHoursInput = z.input<typeof ReplaceStoreBusinessHoursInput>;

export class StoreNotFoundError extends Error {
  constructor(storeId: string) {
    super(`store ${storeId} not found in this company`);
    this.name = "StoreNotFoundError";
  }
}

export class DuplicateDayOfWeekError extends Error {
  constructor(days: number[]) {
    super(`day_of_week duplicated in input: ${days.join(",")}`);
    this.name = "DuplicateDayOfWeekError";
  }
}

export async function listStoreBusinessHoursByStoreId(
  storeId: string,
  ctx: StoreBusinessHoursContext,
): Promise<StoreBusinessHourRow[]> {
  const rows = await ctx.db
    .select({
      id: storeBusinessHours.id,
      dayOfWeek: storeBusinessHours.dayOfWeek,
      opensAt: storeBusinessHours.opensAt,
      closesAt: storeBusinessHours.closesAt,
      acceptsReservations: storeBusinessHours.acceptsReservations,
    })
    .from(storeBusinessHours)
    .where(
      and(
        eq(storeBusinessHours.storeId, storeId),
        eq(storeBusinessHours.companyId, ctx.companyId),
      ),
    )
    .orderBy(asc(storeBusinessHours.dayOfWeek), asc(storeBusinessHours.opensAt));
  return rows as StoreBusinessHourRow[];
}

export type ReplaceStoreBusinessHoursResult = {
  removed: number;
  inserted: number;
};

export async function replaceStoreBusinessHours(
  storeId: string,
  input: ReplaceStoreBusinessHoursInput,
  ctx: StoreBusinessHoursContext,
): Promise<ReplaceStoreBusinessHoursResult> {
  const parsed = ReplaceStoreBusinessHoursInput.parse(input);

  const seen = new Set<number>();
  const duplicates: number[] = [];
  for (const h of parsed.hours) {
    if (seen.has(h.dayOfWeek)) duplicates.push(h.dayOfWeek);
    seen.add(h.dayOfWeek);
  }
  if (duplicates.length > 0) {
    throw new DuplicateDayOfWeekError(Array.from(new Set(duplicates)));
  }

  // Drizzle transaction; nested savepoint when ctx.db is already a transaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await ctx.db.transaction(async (tx: any) => {
    const storeRows = await tx
      .select({ id: stores.id })
      .from(stores)
      .where(
        and(eq(stores.id, storeId), eq(stores.companyId, ctx.companyId), isNull(stores.deletedAt)),
      )
      .limit(1);
    if (storeRows.length === 0) throw new StoreNotFoundError(storeId);

    const deleted = (await tx
      .delete(storeBusinessHours)
      .where(eq(storeBusinessHours.storeId, storeId))
      .returning({ id: storeBusinessHours.id })) as Array<{ id: string }>;

    let inserted = 0;
    if (parsed.hours.length > 0) {
      const values = parsed.hours.map((h) => ({
        companyId: ctx.companyId,
        storeId,
        dayOfWeek: h.dayOfWeek,
        opensAt: normalizeTime(h.opensAt),
        closesAt: normalizeTime(h.closesAt),
        acceptsReservations: h.acceptsReservations ?? true,
      }));
      const insertedRows = (await tx
        .insert(storeBusinessHours)
        .values(values)
        .returning({ id: storeBusinessHours.id })) as Array<{ id: string }>;
      inserted = insertedRows.length;
    }

    return { removed: deleted.length, inserted };
  });
}
