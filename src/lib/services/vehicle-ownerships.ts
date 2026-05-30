import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { vehicleOwnerships, type VehicleOwnership } from "@/lib/db/schema/vehicle_ownerships";

export type VehicleOwnershipContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

export class VehicleOwnershipNotFoundError extends Error {
  constructor() {
    super("vehicle ownership not found");
    this.name = "VehicleOwnershipNotFoundError";
  }
}

export class VehicleOwnershipConstraintError extends Error {
  constructor(public readonly detail: string) {
    super(`vehicle ownership constraint violated: ${detail}`);
    this.name = "VehicleOwnershipConstraintError";
  }
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const UpdateVehicleOwnershipInput = z
  .object({
    startsOn: isoDate.optional(),
    endsOn: isoDate.nullable().optional(),
    isPrimary: z.coerce.boolean().optional(),
  })
  .strict();

export type UpdateVehicleOwnershipInput = z.input<typeof UpdateVehicleOwnershipInput>;

async function loadOwnershipForCompany(
  ctx: VehicleOwnershipContext,
  id: string,
): Promise<VehicleOwnership> {
  const rows = await ctx.db
    .select()
    .from(vehicleOwnerships)
    .where(
      and(
        eq(vehicleOwnerships.id, id),
        eq(vehicleOwnerships.companyId, ctx.companyId),
        isNull(vehicleOwnerships.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0] as VehicleOwnership | undefined;
  if (!row) throw new VehicleOwnershipNotFoundError();
  return row;
}

export async function updateVehicleOwnership(
  id: string,
  input: UpdateVehicleOwnershipInput,
  ctx: VehicleOwnershipContext,
): Promise<VehicleOwnership> {
  const parsed = UpdateVehicleOwnershipInput.parse(input);

  // Drizzle nested transactions use SAVEPOINT internally.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ctx.db.transaction(async (tx: any): Promise<VehicleOwnership> => {
    const existing = await loadOwnershipForCompany({ db: tx, companyId: ctx.companyId }, id);

    const nextStartsOn = parsed.startsOn ?? existing.startsOn;
    const endsOnSpecified = "endsOn" in parsed;
    const nextEndsOn = endsOnSpecified ? (parsed.endsOn ?? null) : existing.endsOn;

    // CHECK (ends_on IS NULL OR starts_on <= ends_on) を service 側でも防衛
    if (nextEndsOn !== null && nextStartsOn > nextEndsOn) {
      throw new VehicleOwnershipConstraintError("starts_on must be <= ends_on");
    }

    // ends_on=NULL 排他: 同じ vehicle に他の active ownership が存在しないか
    if (nextEndsOn === null && existing.endsOn !== null) {
      const conflict = await tx
        .select({ id: vehicleOwnerships.id })
        .from(vehicleOwnerships)
        .where(
          and(
            eq(vehicleOwnerships.vehicleId, existing.vehicleId),
            eq(vehicleOwnerships.companyId, ctx.companyId),
            ne(vehicleOwnerships.id, id),
            isNull(vehicleOwnerships.endsOn),
            isNull(vehicleOwnerships.deletedAt),
          ),
        )
        .limit(1);
      if (conflict[0]) {
        throw new VehicleOwnershipConstraintError(
          "another active ownership exists for this vehicle",
        );
      }
    }

    const values: Partial<typeof vehicleOwnerships.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (parsed.startsOn !== undefined) values.startsOn = parsed.startsOn;
    if (endsOnSpecified) values.endsOn = parsed.endsOn ?? null;
    if (parsed.isPrimary !== undefined) values.isPrimary = parsed.isPrimary;

    const rows = await tx
      .update(vehicleOwnerships)
      .set(values)
      .where(
        and(
          eq(vehicleOwnerships.id, id),
          eq(vehicleOwnerships.companyId, ctx.companyId),
          isNull(vehicleOwnerships.deletedAt),
        ),
      )
      .returning();
    const row = rows[0] as VehicleOwnership | undefined;
    if (!row) throw new VehicleOwnershipNotFoundError();
    return row;
  });
}

export async function deleteVehicleOwnership(
  id: string,
  ctx: VehicleOwnershipContext,
): Promise<boolean> {
  // soft delete (deletedAt 列があるため master 系と同方針)
  const rows = await ctx.db
    .update(vehicleOwnerships)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(vehicleOwnerships.id, id),
        eq(vehicleOwnerships.companyId, ctx.companyId),
        isNull(vehicleOwnerships.deletedAt),
      ),
    )
    .returning({ id: vehicleOwnerships.id });
  return rows.length > 0;
}
