import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { stores } from "@/lib/db/schema/stores";
import { vendorAvailableStores } from "@/lib/db/schema/vendor_available_stores";
import { vendors } from "@/lib/db/schema/vendors";

export type VendorAvailableStoreContext = {
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

export class StoreNotInCompanyError extends Error {
  constructor(invalidIds: string[]) {
    super(`store ids do not belong to this company: ${invalidIds.join(",")}`);
    this.name = "StoreNotInCompanyError";
  }
}

const uuidRequired = z.string().uuid();

export const ReplaceVendorAvailableStoresInput = z
  .object({
    storeIds: z.array(uuidRequired),
  })
  .strict();

export type ReplaceVendorAvailableStoresInput = z.input<typeof ReplaceVendorAvailableStoresInput>;

export type VendorStoreSelectItem = {
  id: string;
  code: string | null;
  name: string;
};

export async function listStoreIdsByVendorId(
  vendorId: string,
  ctx: VendorAvailableStoreContext,
): Promise<string[]> {
  const rows = await ctx.db
    .select({ storeId: vendorAvailableStores.storeId })
    .from(vendorAvailableStores)
    .where(
      and(
        eq(vendorAvailableStores.vendorId, vendorId),
        eq(vendorAvailableStores.companyId, ctx.companyId),
      ),
    );
  return rows.map((r: { storeId: string }) => r.storeId);
}

export async function listStoresForVendorSelect(
  ctx: VendorAvailableStoreContext,
): Promise<VendorStoreSelectItem[]> {
  const rows = await ctx.db
    .select({
      id: stores.id,
      code: stores.code,
      name: stores.name,
    })
    .from(stores)
    .where(and(eq(stores.companyId, ctx.companyId), isNull(stores.deletedAt)))
    .orderBy(asc(stores.name), asc(stores.code));
  return rows as VendorStoreSelectItem[];
}

export type ReplaceVendorAvailableStoresResult = {
  added: number;
  removed: number;
  kept: number;
};

export async function replaceVendorAvailableStores(
  vendorId: string,
  input: ReplaceVendorAvailableStoresInput,
  ctx: VendorAvailableStoreContext,
): Promise<ReplaceVendorAvailableStoresResult> {
  const parsed = ReplaceVendorAvailableStoresInput.parse(input);
  const requested = Array.from(new Set(parsed.storeIds));

  // Drizzle transaction; nested savepoint when ctx.db is already a transaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await ctx.db.transaction(async (tx: any): Promise<ReplaceVendorAvailableStoresResult> => {
    const vendorRows = await tx
      .select({ id: vendors.id })
      .from(vendors)
      .where(
        and(eq(vendors.id, vendorId), eq(vendors.companyId, ctx.companyId), isNull(vendors.deletedAt)),
      )
      .limit(1);
    if (vendorRows.length === 0) throw new VendorNotFoundError(vendorId);

    if (requested.length > 0) {
      const validRows = await tx
        .select({ id: stores.id })
        .from(stores)
        .where(
          and(
            inArray(stores.id, requested),
            eq(stores.companyId, ctx.companyId),
            isNull(stores.deletedAt),
          ),
        );
      const validSet = new Set(validRows.map((r: { id: string }) => r.id));
      const invalid = requested.filter((id) => !validSet.has(id));
      if (invalid.length > 0) throw new StoreNotInCompanyError(invalid);
    }

    const existingRows = (await tx
      .select({ storeId: vendorAvailableStores.storeId })
      .from(vendorAvailableStores)
      .where(
        and(
          eq(vendorAvailableStores.vendorId, vendorId),
          eq(vendorAvailableStores.companyId, ctx.companyId),
        ),
      )) as Array<{ storeId: string }>;
    const existing = new Set<string>(existingRows.map((r) => r.storeId));
    const requestedSet = new Set<string>(requested);

    const toAdd = requested.filter((id) => !existing.has(id));
    const toRemove: string[] = Array.from(existing).filter((id) => !requestedSet.has(id));
    const kept = requested.filter((id) => existing.has(id)).length;

    if (toRemove.length > 0) {
      await tx
        .delete(vendorAvailableStores)
        .where(
          and(
            eq(vendorAvailableStores.vendorId, vendorId),
            eq(vendorAvailableStores.companyId, ctx.companyId),
            inArray(vendorAvailableStores.storeId, toRemove),
          ),
        );
    }
    if (toAdd.length > 0) {
      await tx.insert(vendorAvailableStores).values(
        toAdd.map((storeId) => ({
          companyId: ctx.companyId,
          vendorId,
          storeId,
        })),
      );
    }

    return { added: toAdd.length, removed: toRemove.length, kept };
  });
}
