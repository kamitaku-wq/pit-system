import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { customers } from "@/lib/db/schema/customers";
import { serviceTickets, type ServiceTicket } from "@/lib/db/schema/service_tickets";
import { statuses } from "@/lib/db/schema/statuses";
import { stores } from "@/lib/db/schema/stores";
import { vehicles } from "@/lib/db/schema/vehicles";
import { workCategories } from "@/lib/db/schema/work_categories";
import { workMenus } from "@/lib/db/schema/work_menus";

export type ServiceTicketContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

const optionalUuid = z.string().uuid().nullable().optional();
const optionalText = z.string().trim().max(2000).nullable().optional();

export const CreateServiceTicketInput = z
  .object({
    vehicleId: optionalUuid,
    customerId: optionalUuid,
    storeId: optionalUuid,
    statusId: optionalUuid,
    workCategoryId: optionalUuid,
    workMenuId: optionalUuid,
    ticketNo: z.string().trim().min(1).max(255).nullable().optional(),
    quotedAmountMinor: z.coerce.number().int().min(0).default(0),
    taxRateBps: z.coerce.number().int().min(0).max(10000).default(1000),
    billingStatus: z.string().trim().min(1).max(100).default("unbilled"),
    notes: optionalText,
  })
  .strict();

export const UpdateServiceTicketInput = CreateServiceTicketInput.partial().strict();

export type CreateServiceTicketInput = z.input<typeof CreateServiceTicketInput>;
export type UpdateServiceTicketInput = z.input<typeof UpdateServiceTicketInput>;

export type ServiceTicketListFilters = {
  statusId?: string;
  vehicleId?: string;
  storeId?: string;
  page?: number;
  limit?: number;
};

export type ServiceTicketListItem = {
  id: string;
  ticketNo: string | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
  customerName: string | null;
  storeName: string | null;
  statusName: string | null;
  workCategoryName: string | null;
  workMenuName: string | null;
  quotedAmountMinor: number;
  taxRateBps: number;
  billingStatus: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ServiceTicketDetail = ServiceTicketListItem & {
  customerId: string | null;
  storeId: string | null;
  statusId: string | null;
  workCategoryId: string | null;
  workMenuId: string | null;
  notes: string | null;
};

type ServiceTicketJoinedRow = {
  id: string;
  ticketNo: string | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
  customerId?: string | null;
  customerName: string | null;
  storeId?: string | null;
  storeName: string | null;
  statusId?: string | null;
  statusName: string | null;
  workCategoryId?: string | null;
  workCategoryName: string | null;
  workMenuId?: string | null;
  workMenuName: string | null;
  quotedAmountMinor: number;
  taxRateBps: number;
  billingStatus: string;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeNullable(value: string | null | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

async function assertCompanyScopedRef(
  ctx: ServiceTicketContext,
  table: unknown,
  idColumn: unknown,
  companyColumn: unknown,
  id: string | null | undefined,
  label: string,
  includeDeletedAt = false,
): Promise<void> {
  if (!id) return;
  const predicates = [eq(idColumn as never, id), eq(companyColumn as never, ctx.companyId)];
  if (includeDeletedAt && "deletedAt" in (table as Record<string, unknown>)) {
    predicates.push(isNull((table as { deletedAt: never }).deletedAt));
  }
  const rows = await ctx.db
    .select({ id: idColumn })
    .from(table)
    .where(and(...predicates))
    .limit(1);
  if (!rows[0]) {
    throw new Error(`${label} not found for company`);
  }
}

async function assertReferences(ctx: ServiceTicketContext, input: CreateServiceTicketInput | UpdateServiceTicketInput) {
  await assertCompanyScopedRef(ctx, vehicles, vehicles.id, vehicles.companyId, input.vehicleId, "vehicle", true);
  await assertCompanyScopedRef(ctx, customers, customers.id, customers.companyId, input.customerId, "customer", true);
  await assertCompanyScopedRef(ctx, stores, stores.id, stores.companyId, input.storeId, "store", true);
  if (input.statusId) {
    const statusRows = await ctx.db
      .select({ id: statuses.id })
      .from(statuses)
      .where(
        and(
          eq(statuses.id, input.statusId),
          eq(statuses.companyId, ctx.companyId),
          eq(statuses.statusType, "service"),
        ),
      )
      .limit(1);
    if (!statusRows[0]) {
      throw new Error("service status not found for company");
    }
  }
  await assertCompanyScopedRef(ctx, workCategories, workCategories.id, workCategories.companyId, input.workCategoryId, "work category");
  await assertCompanyScopedRef(ctx, workMenus, workMenus.id, workMenus.companyId, input.workMenuId, "work menu", true);
}

function selectJoined(ctx: ServiceTicketContext) {
  return ctx.db
    .select({
      id: serviceTickets.id,
      ticketNo: serviceTickets.ticketNo,
      vehicleId: serviceTickets.vehicleId,
      vehicleLabel: sql<string | null>`COALESCE(${vehicles.registrationNumber}, ${vehicles.vin}, ${vehicles.model})`,
      customerId: serviceTickets.customerId,
      customerName: customers.fullName,
      storeId: serviceTickets.storeId,
      storeName: stores.name,
      statusId: serviceTickets.statusId,
      statusName: statuses.name,
      workCategoryId: serviceTickets.workCategoryId,
      workCategoryName: workCategories.name,
      workMenuId: serviceTickets.workMenuId,
      workMenuName: workMenus.name,
      quotedAmountMinor: serviceTickets.quotedAmountMinor,
      taxRateBps: serviceTickets.taxRateBps,
      billingStatus: serviceTickets.billingStatus,
      notes: serviceTickets.notes,
      createdAt: serviceTickets.createdAt,
      updatedAt: serviceTickets.updatedAt,
    })
    .from(serviceTickets)
    .leftJoin(vehicles, eq(serviceTickets.vehicleId, vehicles.id))
    .leftJoin(customers, eq(serviceTickets.customerId, customers.id))
    .leftJoin(stores, eq(serviceTickets.storeId, stores.id))
    .leftJoin(statuses, eq(serviceTickets.statusId, statuses.id))
    .leftJoin(workCategories, eq(serviceTickets.workCategoryId, workCategories.id))
    .leftJoin(workMenus, eq(serviceTickets.workMenuId, workMenus.id));
}

function toListItem(row: ServiceTicketJoinedRow): ServiceTicketListItem {
  return {
    id: row.id,
    ticketNo: row.ticketNo,
    vehicleId: row.vehicleId,
    vehicleLabel: row.vehicleLabel,
    customerName: row.customerName,
    storeName: row.storeName,
    statusName: row.statusName,
    workCategoryName: row.workCategoryName,
    workMenuName: row.workMenuName,
    quotedAmountMinor: row.quotedAmountMinor,
    taxRateBps: row.taxRateBps,
    billingStatus: row.billingStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetail(row: ServiceTicketJoinedRow): ServiceTicketDetail {
  return {
    ...toListItem(row),
    customerId: row.customerId ?? null,
    storeId: row.storeId ?? null,
    statusId: row.statusId ?? null,
    workCategoryId: row.workCategoryId ?? null,
    workMenuId: row.workMenuId ?? null,
    notes: row.notes ?? null,
  };
}

export async function createServiceTicket(
  input: CreateServiceTicketInput,
  ctx: ServiceTicketContext,
): Promise<ServiceTicket> {
  const parsed = CreateServiceTicketInput.parse(input);
  await assertReferences(ctx, parsed);
  const rows = await ctx.db
    .insert(serviceTickets)
    .values({
      companyId: ctx.companyId,
      vehicleId: normalizeNullable(parsed.vehicleId),
      customerId: normalizeNullable(parsed.customerId),
      storeId: normalizeNullable(parsed.storeId),
      statusId: normalizeNullable(parsed.statusId),
      workCategoryId: normalizeNullable(parsed.workCategoryId),
      workMenuId: normalizeNullable(parsed.workMenuId),
      ticketNo: normalizeNullable(parsed.ticketNo),
      quotedAmountMinor: parsed.quotedAmountMinor,
      taxRateBps: parsed.taxRateBps,
      billingStatus: parsed.billingStatus,
      notes: normalizeNullable(parsed.notes),
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("service ticket insert returned no rows");
  return row;
}

export async function updateServiceTicket(
  id: string,
  input: UpdateServiceTicketInput,
  ctx: ServiceTicketContext,
): Promise<ServiceTicket | null> {
  const parsed = UpdateServiceTicketInput.parse(input);
  await assertReferences(ctx, parsed);
  const values: Partial<typeof serviceTickets.$inferInsert> = {};
  if ("vehicleId" in parsed) values.vehicleId = normalizeNullable(parsed.vehicleId);
  if ("customerId" in parsed) values.customerId = normalizeNullable(parsed.customerId);
  if ("storeId" in parsed) values.storeId = normalizeNullable(parsed.storeId);
  if ("statusId" in parsed) values.statusId = normalizeNullable(parsed.statusId);
  if ("workCategoryId" in parsed) values.workCategoryId = normalizeNullable(parsed.workCategoryId);
  if ("workMenuId" in parsed) values.workMenuId = normalizeNullable(parsed.workMenuId);
  if ("ticketNo" in parsed) values.ticketNo = normalizeNullable(parsed.ticketNo);
  if ("quotedAmountMinor" in parsed) values.quotedAmountMinor = parsed.quotedAmountMinor;
  if ("taxRateBps" in parsed) values.taxRateBps = parsed.taxRateBps;
  if ("billingStatus" in parsed && parsed.billingStatus !== undefined) values.billingStatus = parsed.billingStatus;
  if ("notes" in parsed) values.notes = normalizeNullable(parsed.notes);
  values.updatedAt = new Date();

  const rows = await ctx.db
    .update(serviceTickets)
    .set(values)
    .where(and(eq(serviceTickets.id, id), eq(serviceTickets.companyId, ctx.companyId)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteServiceTicket(id: string, ctx: ServiceTicketContext): Promise<boolean> {
  const rows = await ctx.db
    .delete(serviceTickets)
    .where(and(eq(serviceTickets.id, id), eq(serviceTickets.companyId, ctx.companyId)))
    .returning({ id: serviceTickets.id });
  return rows.length > 0;
}

export async function listServiceTickets(
  filters: ServiceTicketListFilters,
  ctx: ServiceTicketContext,
): Promise<{ rows: ServiceTicketListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * limit;
  const predicates = [
    eq(serviceTickets.companyId, ctx.companyId),
    filters.statusId ? eq(serviceTickets.statusId, filters.statusId) : undefined,
    filters.vehicleId ? eq(serviceTickets.vehicleId, filters.vehicleId) : undefined,
    filters.storeId ? eq(serviceTickets.storeId, filters.storeId) : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

  const [rows, totalRows] = await Promise.all([
    selectJoined(ctx)
      .where(and(...predicates))
      .orderBy(desc(serviceTickets.createdAt))
      .limit(limit)
      .offset(offset),
    ctx.db.select({ value: count() }).from(serviceTickets).where(and(...predicates)),
  ]);

  return {
    rows: rows.map((row: ServiceTicketJoinedRow) => toListItem(row)),
    total: Number(totalRows[0]?.value ?? 0),
  };
}

export async function getServiceTicketById(id: string, ctx: ServiceTicketContext): Promise<ServiceTicketDetail | null> {
  const rows = await selectJoined(ctx)
    .where(and(eq(serviceTickets.id, id), eq(serviceTickets.companyId, ctx.companyId)))
    .limit(1);
  return rows[0] ? toDetail(rows[0]) : null;
}
