import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { customers } from "@/lib/db/schema/customers";
import { stores } from "@/lib/db/schema/stores";
import { vehicleOwnerships, type VehicleOwnership } from "@/lib/db/schema/vehicle_ownerships";
import { vehicles, type Vehicle } from "@/lib/db/schema/vehicles";

export type VehicleContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

const optionalUuid = z.string().uuid().nullable().optional();
const optionalText = z.string().trim().max(255).nullable().optional();

export const CreateVehicleInput = z
  .object({
    storeId: optionalUuid,
    vin: optionalText,
    registrationNumber: optionalText,
    maker: optionalText,
    model: optionalText,
    modelYear: z.coerce.number().int().min(1900).max(2100).nullable().optional(),
    color: optionalText,
  })
  .strict();

export const UpdateVehicleInput = CreateVehicleInput.partial().strict();

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "startsOn must be YYYY-MM-DD")
  .optional();

export const TransferOwnershipInput = z
  .object({
    customerId: z.string().uuid(),
    startsOn: isoDate,
    isPrimary: z.coerce.boolean().optional(),
  })
  .strict();

export type CreateVehicleInput = z.input<typeof CreateVehicleInput>;
export type UpdateVehicleInput = z.input<typeof UpdateVehicleInput>;
export type TransferOwnershipInput = z.input<typeof TransferOwnershipInput>;

export type VehicleListFilters = {
  storeId?: string;
  q?: string;
  page?: number;
  limit?: number;
};

export type VehicleListItem = {
  id: string;
  vin: string | null;
  registrationNumber: string | null;
  maker: string | null;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  storeId: string | null;
  storeName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type VehicleDetail = VehicleListItem;

export type VehicleOwnershipListItem = {
  id: string;
  customerId: string;
  customerName: string | null;
  startsOn: string;
  endsOn: string | null;
  isPrimary: boolean;
};

function normalizeNullable(value: string | null | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

async function assertCompanyScopedRef(
  ctx: VehicleContext,
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

async function assertReferences(ctx: VehicleContext, input: CreateVehicleInput | UpdateVehicleInput) {
  await assertCompanyScopedRef(ctx, stores, stores.id, stores.companyId, input.storeId, "store", true);
}

function selectJoined(ctx: VehicleContext) {
  return ctx.db
    .select({
      id: vehicles.id,
      vin: vehicles.vin,
      registrationNumber: vehicles.registrationNumber,
      maker: vehicles.maker,
      model: vehicles.model,
      modelYear: vehicles.modelYear,
      color: vehicles.color,
      storeId: vehicles.storeId,
      storeName: stores.name,
      createdAt: vehicles.createdAt,
      updatedAt: vehicles.updatedAt,
    })
    .from(vehicles)
    .leftJoin(stores, eq(vehicles.storeId, stores.id));
}

export async function createVehicle(input: CreateVehicleInput, ctx: VehicleContext): Promise<Vehicle> {
  const parsed = CreateVehicleInput.parse(input);
  await assertReferences(ctx, parsed);
  const rows = await ctx.db
    .insert(vehicles)
    .values({
      companyId: ctx.companyId,
      storeId: normalizeNullable(parsed.storeId),
      vin: normalizeNullable(parsed.vin),
      registrationNumber: normalizeNullable(parsed.registrationNumber),
      maker: normalizeNullable(parsed.maker),
      model: normalizeNullable(parsed.model),
      modelYear: parsed.modelYear ?? null,
      color: normalizeNullable(parsed.color),
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("vehicle insert returned no rows");
  return row;
}

export async function updateVehicle(
  id: string,
  input: UpdateVehicleInput,
  ctx: VehicleContext,
): Promise<Vehicle | null> {
  const parsed = UpdateVehicleInput.parse(input);
  await assertReferences(ctx, parsed);
  const values: Partial<typeof vehicles.$inferInsert> = {};
  if ("storeId" in parsed) values.storeId = normalizeNullable(parsed.storeId);
  if ("vin" in parsed) values.vin = normalizeNullable(parsed.vin);
  if ("registrationNumber" in parsed) values.registrationNumber = normalizeNullable(parsed.registrationNumber);
  if ("maker" in parsed) values.maker = normalizeNullable(parsed.maker);
  if ("model" in parsed) values.model = normalizeNullable(parsed.model);
  if ("modelYear" in parsed) values.modelYear = parsed.modelYear ?? null;
  if ("color" in parsed) values.color = normalizeNullable(parsed.color);
  values.updatedAt = new Date();

  const rows = await ctx.db
    .update(vehicles)
    .set(values)
    .where(and(eq(vehicles.id, id), eq(vehicles.companyId, ctx.companyId), isNull(vehicles.deletedAt)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteVehicle(id: string, ctx: VehicleContext): Promise<boolean> {
  // soft delete (deletedAt 列があるため、hard delete ではなく soft)
  const rows = await ctx.db
    .update(vehicles)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(vehicles.id, id), eq(vehicles.companyId, ctx.companyId), isNull(vehicles.deletedAt)))
    .returning({ id: vehicles.id });
  return rows.length > 0;
}

export async function listVehicles(
  filters: VehicleListFilters,
  ctx: VehicleContext,
): Promise<{ rows: VehicleListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const trimmedQ = filters.q?.trim();
  const predicates = [
    eq(vehicles.companyId, ctx.companyId),
    isNull(vehicles.deletedAt),
    filters.storeId ? eq(vehicles.storeId, filters.storeId) : undefined,
    trimmedQ
      ? sql`(${vehicles.registrationNumber} ILIKE ${"%" + trimmedQ + "%"} OR ${vehicles.vin} ILIKE ${"%" + trimmedQ + "%"} OR ${vehicles.maker} ILIKE ${"%" + trimmedQ + "%"} OR ${vehicles.model} ILIKE ${"%" + trimmedQ + "%"})`
      : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

  const [rows, totalRows] = await Promise.all([
    selectJoined(ctx).where(and(...predicates)).orderBy(desc(vehicles.createdAt)).limit(limit).offset(offset),
    ctx.db.select({ value: count() }).from(vehicles).where(and(...predicates)),
  ]);

  return {
    rows: rows as VehicleListItem[],
    total: Number(totalRows[0]?.value ?? 0),
  };
}

export async function getVehicleById(id: string, ctx: VehicleContext): Promise<VehicleDetail | null> {
  const rows = await selectJoined(ctx)
    .where(and(eq(vehicles.id, id), eq(vehicles.companyId, ctx.companyId), isNull(vehicles.deletedAt)))
    .limit(1);
  return (rows[0] as VehicleDetail | undefined) ?? null;
}

export async function listOwnershipsByVehicle(
  vehicleId: string,
  ctx: VehicleContext,
): Promise<VehicleOwnershipListItem[]> {
  await assertCompanyScopedRef(ctx, vehicles, vehicles.id, vehicles.companyId, vehicleId, "vehicle", true);
  const rows = await ctx.db
    .select({
      id: vehicleOwnerships.id,
      customerId: vehicleOwnerships.customerId,
      customerName: customers.fullName,
      startsOn: vehicleOwnerships.startsOn,
      endsOn: vehicleOwnerships.endsOn,
      isPrimary: vehicleOwnerships.isPrimary,
    })
    .from(vehicleOwnerships)
    .leftJoin(customers, eq(vehicleOwnerships.customerId, customers.id))
    .where(
      and(
        eq(vehicleOwnerships.vehicleId, vehicleId),
        eq(vehicleOwnerships.companyId, ctx.companyId),
        isNull(vehicleOwnerships.deletedAt),
      ),
    )
    .orderBy(desc(vehicleOwnerships.startsOn));
  return rows as VehicleOwnershipListItem[];
}

export async function transferOwnership(
  vehicleId: string,
  input: TransferOwnershipInput,
  ctx: VehicleContext,
): Promise<VehicleOwnership> {
  const parsed = TransferOwnershipInput.parse(input);
  await assertCompanyScopedRef(ctx, vehicles, vehicles.id, vehicles.companyId, vehicleId, "vehicle", true);
  await assertCompanyScopedRef(ctx, customers, customers.id, customers.companyId, parsed.customerId, "customer", true);

  const today = new Date().toISOString().slice(0, 10);

  // Drizzle nested transactions use SAVEPOINT internally.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ctx.db.transaction(async (tx: any): Promise<VehicleOwnership> => {
    await tx
      .update(vehicleOwnerships)
      .set({ endsOn: today, updatedAt: new Date() })
      .where(
        and(
          eq(vehicleOwnerships.vehicleId, vehicleId),
          eq(vehicleOwnerships.companyId, ctx.companyId),
          isNull(vehicleOwnerships.endsOn),
          isNull(vehicleOwnerships.deletedAt),
        ),
      );

    const insertValues: Partial<typeof vehicleOwnerships.$inferInsert> = {
      companyId: ctx.companyId,
      vehicleId,
      customerId: parsed.customerId,
      isPrimary: parsed.isPrimary ?? true,
    };
    if (parsed.startsOn) insertValues.startsOn = parsed.startsOn;

    const rows = await tx
      .insert(vehicleOwnerships)
      .values(insertValues as typeof vehicleOwnerships.$inferInsert)
      .returning();
    const row = rows[0];
    if (!row) throw new Error("vehicle ownership insert returned no rows");
    return row;
  });
}
