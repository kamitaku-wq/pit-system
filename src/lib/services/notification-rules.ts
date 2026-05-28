import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { notificationRules, type NotificationRule } from "@/lib/db/schema/notification_rules";

export type NotificationRuleContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

export const NOTIFICATION_RULE_TARGET_TYPES = ["vendor", "customer", "store_user"] as const;
export type NotificationRuleTargetType = (typeof NOTIFICATION_RULE_TARGET_TYPES)[number];

export const NOTIFICATION_RULE_CHANNELS = ["email", "portal", "line", "sms", "both"] as const;
export type NotificationRuleChannel = (typeof NOTIFICATION_RULE_CHANNELS)[number];

const eventTypeSchema = z.string().trim().min(1, "event_type is required").max(120);
const targetTypeSchema = z.enum(NOTIFICATION_RULE_TARGET_TYPES);
const channelSchema = z.enum(NOTIFICATION_RULE_CHANNELS);
const optionalInt = z.number().int().nullable().optional();

export const CreateNotificationRuleInput = z
  .object({
    eventType: eventTypeSchema,
    targetType: targetTypeSchema,
    channel: channelSchema,
    isEnabled: z.boolean().optional(),
    timingMinutesOffset: optionalInt,
    retryAfterMinutes: optionalInt.refine(
      (v) => v === undefined || v === null || v >= 0,
      "retry_after_minutes must be >= 0",
    ),
    maxReminders: optionalInt.refine(
      (v) => v === undefined || v === null || v >= 0,
      "max_reminders must be >= 0",
    ),
  })
  .strict();

export const UpdateNotificationRuleInput = CreateNotificationRuleInput.partial().strict();

export type CreateNotificationRuleInput = z.input<typeof CreateNotificationRuleInput>;
export type UpdateNotificationRuleInput = z.input<typeof UpdateNotificationRuleInput>;

export type NotificationRuleListFilters = {
  q?: string;
  targetType?: NotificationRuleTargetType;
  channel?: NotificationRuleChannel;
  isEnabled?: boolean;
  page?: number;
  limit?: number;
};

export type NotificationRuleListItem = {
  id: string;
  companyId: string;
  eventType: string;
  targetType: string;
  channel: string;
  isEnabled: boolean;
  timingMinutesOffset: number | null;
  retryAfterMinutes: number | null;
  maxReminders: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationRuleDetail = NotificationRuleListItem;

export class NotificationRuleConflictError extends Error {
  constructor(eventType: string, targetType: string, channel: string) {
    super(
      `notification_rule (${eventType}, ${targetType}, ${channel}) already exists in this company`,
    );
    this.name = "NotificationRuleConflictError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}

function selectListColumns(ctx: NotificationRuleContext) {
  return ctx.db
    .select({
      id: notificationRules.id,
      companyId: notificationRules.companyId,
      eventType: notificationRules.eventType,
      targetType: notificationRules.targetType,
      channel: notificationRules.channel,
      isEnabled: notificationRules.isEnabled,
      timingMinutesOffset: notificationRules.timingMinutesOffset,
      retryAfterMinutes: notificationRules.retryAfterMinutes,
      maxReminders: notificationRules.maxReminders,
      createdAt: notificationRules.createdAt,
      updatedAt: notificationRules.updatedAt,
    })
    .from(notificationRules);
}

export async function createNotificationRule(
  input: CreateNotificationRuleInput,
  ctx: NotificationRuleContext,
): Promise<NotificationRule> {
  const parsed = CreateNotificationRuleInput.parse(input);
  try {
    const rows = await ctx.db
      .insert(notificationRules)
      .values({
        companyId: ctx.companyId,
        eventType: parsed.eventType.trim(),
        targetType: parsed.targetType,
        channel: parsed.channel,
        isEnabled: parsed.isEnabled ?? true,
        timingMinutesOffset: parsed.timingMinutesOffset ?? null,
        retryAfterMinutes: parsed.retryAfterMinutes ?? null,
        maxReminders: parsed.maxReminders ?? null,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("notification_rule insert returned no rows");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new NotificationRuleConflictError(
        parsed.eventType.trim(),
        parsed.targetType,
        parsed.channel,
      );
    }
    throw err;
  }
}

export async function updateNotificationRule(
  id: string,
  input: UpdateNotificationRuleInput,
  ctx: NotificationRuleContext,
): Promise<NotificationRule | null> {
  const parsed = UpdateNotificationRuleInput.parse(input);
  const values: Partial<typeof notificationRules.$inferInsert> = {};
  if ("eventType" in parsed && parsed.eventType !== undefined)
    values.eventType = parsed.eventType.trim();
  if ("targetType" in parsed && parsed.targetType !== undefined)
    values.targetType = parsed.targetType;
  if ("channel" in parsed && parsed.channel !== undefined) values.channel = parsed.channel;
  if ("isEnabled" in parsed && parsed.isEnabled !== undefined) values.isEnabled = parsed.isEnabled;
  if ("timingMinutesOffset" in parsed) values.timingMinutesOffset = parsed.timingMinutesOffset ?? null;
  if ("retryAfterMinutes" in parsed) values.retryAfterMinutes = parsed.retryAfterMinutes ?? null;
  if ("maxReminders" in parsed) values.maxReminders = parsed.maxReminders ?? null;
  values.updatedAt = new Date();

  try {
    const rows = await ctx.db
      .update(notificationRules)
      .set(values)
      .where(and(eq(notificationRules.id, id), eq(notificationRules.companyId, ctx.companyId)))
      .returning();
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new NotificationRuleConflictError(
        typeof values.eventType === "string" ? values.eventType : "?",
        typeof values.targetType === "string" ? values.targetType : "?",
        typeof values.channel === "string" ? values.channel : "?",
      );
    }
    throw err;
  }
}

export async function deleteNotificationRule(
  id: string,
  ctx: NotificationRuleContext,
): Promise<boolean> {
  const rows = await ctx.db
    .delete(notificationRules)
    .where(and(eq(notificationRules.id, id), eq(notificationRules.companyId, ctx.companyId)))
    .returning({ id: notificationRules.id });
  return rows.length > 0;
}

export async function listNotificationRules(
  filters: NotificationRuleListFilters,
  ctx: NotificationRuleContext,
): Promise<{ rows: NotificationRuleListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const trimmedQ = filters.q?.trim();
  const predicates = [
    eq(notificationRules.companyId, ctx.companyId),
    filters.targetType ? eq(notificationRules.targetType, filters.targetType) : undefined,
    filters.channel ? eq(notificationRules.channel, filters.channel) : undefined,
    filters.isEnabled !== undefined
      ? eq(notificationRules.isEnabled, filters.isEnabled)
      : undefined,
    trimmedQ
      ? sql`${notificationRules.eventType} ILIKE ${"%" + trimmedQ + "%"}`
      : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

  const [rows, totalRows] = await Promise.all([
    selectListColumns(ctx)
      .where(and(...predicates))
      .orderBy(
        asc(notificationRules.eventType),
        asc(notificationRules.targetType),
        asc(notificationRules.channel),
        desc(notificationRules.createdAt),
      )
      .limit(limit)
      .offset(offset),
    ctx.db.select({ value: count() }).from(notificationRules).where(and(...predicates)),
  ]);

  return {
    rows: rows as NotificationRuleListItem[],
    total: Number(totalRows[0]?.value ?? 0),
  };
}

export async function getNotificationRuleById(
  id: string,
  ctx: NotificationRuleContext,
): Promise<NotificationRuleDetail | null> {
  const rows = await selectListColumns(ctx)
    .where(and(eq(notificationRules.id, id), eq(notificationRules.companyId, ctx.companyId)))
    .limit(1);
  return (rows[0] as NotificationRuleDetail | undefined) ?? null;
}
