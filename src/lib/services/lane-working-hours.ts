import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { laneWorkingHours } from "@/lib/db/schema/lane_working_hours";
import { lanes } from "@/lib/db/schema/lanes";

export type LaneWorkingHoursContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

export type LaneWorkingHourRow = {
  id: string;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
};

const timePattern = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function normalizeTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

const HourEntry = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startsAt: z.string().regex(timePattern, "starts_at は HH:MM または HH:MM:SS"),
    endsAt: z.string().regex(timePattern, "ends_at は HH:MM または HH:MM:SS"),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (normalizeTime(val.startsAt) >= normalizeTime(val.endsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "starts_at must be before ends_at",
        path: ["endsAt"],
      });
    }
  });

export const ReplaceLaneWorkingHoursInput = z
  .object({
    hours: z.array(HourEntry),
  })
  .strict();
export type ReplaceLaneWorkingHoursInput = z.input<typeof ReplaceLaneWorkingHoursInput>;

export class LaneNotFoundError extends Error {
  constructor(laneId: string) {
    super(`lane ${laneId} not found in this company`);
    this.name = "LaneNotFoundError";
  }
}

export class DuplicateDayOfWeekError extends Error {
  constructor(days: number[]) {
    super(`day_of_week duplicated in input: ${days.join(",")}`);
    this.name = "DuplicateDayOfWeekError";
  }
}

export async function listLaneWorkingHoursByLaneId(
  laneId: string,
  ctx: LaneWorkingHoursContext,
): Promise<LaneWorkingHourRow[]> {
  const rows = await ctx.db
    .select({
      id: laneWorkingHours.id,
      dayOfWeek: laneWorkingHours.dayOfWeek,
      startsAt: laneWorkingHours.startsAt,
      endsAt: laneWorkingHours.endsAt,
    })
    .from(laneWorkingHours)
    .where(
      and(eq(laneWorkingHours.laneId, laneId), eq(laneWorkingHours.companyId, ctx.companyId)),
    )
    .orderBy(asc(laneWorkingHours.dayOfWeek), asc(laneWorkingHours.startsAt));
  return rows as LaneWorkingHourRow[];
}

export type ReplaceLaneWorkingHoursResult = {
  removed: number;
  inserted: number;
};

export async function replaceLaneWorkingHours(
  laneId: string,
  input: ReplaceLaneWorkingHoursInput,
  ctx: LaneWorkingHoursContext,
): Promise<ReplaceLaneWorkingHoursResult> {
  const parsed = ReplaceLaneWorkingHoursInput.parse(input);

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
    const laneRows = await tx
      .select({ id: lanes.id })
      .from(lanes)
      .where(
        and(eq(lanes.id, laneId), eq(lanes.companyId, ctx.companyId), isNull(lanes.deletedAt)),
      )
      .limit(1);
    if (laneRows.length === 0) throw new LaneNotFoundError(laneId);

    const deleted = (await tx
      .delete(laneWorkingHours)
      .where(eq(laneWorkingHours.laneId, laneId))
      .returning({ id: laneWorkingHours.id })) as Array<{ id: string }>;

    let inserted = 0;
    if (parsed.hours.length > 0) {
      const values = parsed.hours.map((h) => ({
        companyId: ctx.companyId,
        laneId,
        dayOfWeek: h.dayOfWeek,
        startsAt: normalizeTime(h.startsAt),
        endsAt: normalizeTime(h.endsAt),
      }));
      const insertedRows = (await tx
        .insert(laneWorkingHours)
        .values(values)
        .returning({ id: laneWorkingHours.id })) as Array<{ id: string }>;
      inserted = insertedRows.length;
    }

    return { removed: deleted.length, inserted };
  });
}
