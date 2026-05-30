import { config } from "dotenv";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { customers } from "@/lib/db/schema/customers";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { stores } from "@/lib/db/schema/stores";
import { vehicles } from "@/lib/db/schema/vehicles";
import {
  createServiceTicket,
  deleteServiceTicket,
  getServiceTicketById,
  listServiceTickets,
  updateServiceTicket,
} from "@/lib/services/service-tickets";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

// Drizzle does not expose a shared transaction type for postgres-js transactions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

type Fixture = {
  companyId: string;
  otherCompanyId: string;
  vehicleId: string;
  customerId: string;
  storeId: string;
};

afterAll(async () => {
  await queryClient?.end();
});

async function withRollback(fn: (outerTx: Tx) => Promise<void>): Promise<void> {
  await db!
    .transaction(async (outerTx) => {
      try {
        await fn(outerTx);
      } finally {
        throw new Error(ROLLBACK);
      }
    })
    .catch((err) => {
      if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
    });
}

async function seedFixture(outerTx: Tx): Promise<Fixture> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [company, otherCompany] = await outerTx
    .insert(companies)
    .values([
      { name: `__st_company_${suffix}__`, code: `st_${suffix}` },
      { name: `__st_other_${suffix}__`, code: `st_o_${suffix}` },
    ])
    .returning({ id: companies.id });
  const [store] = await outerTx
    .insert(stores)
    .values({ companyId: company.id, code: `st_${suffix}`, name: "整備店舗A" })
    .returning({ id: stores.id });
  const [vehicle] = await outerTx
    .insert(vehicles)
    .values({ companyId: company.id, storeId: store.id, registrationNumber: `品川300-${suffix}` })
    .returning({ id: vehicles.id });
  const [customer] = await outerTx
    .insert(customers)
    .values({ companyId: company.id, fullName: `顧客 ${suffix}` })
    .returning({ id: customers.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
    vehicleId: vehicle.id,
    customerId: customer.id,
    storeId: store.id,
  };
}

describeIntegration("service ticket services", () => {
  it("creates a service ticket scoped to the admin company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createServiceTicket(
        {
          vehicleId: fixture.vehicleId,
          customerId: fixture.customerId,
          storeId: fixture.storeId,
          ticketNo: `ST-${crypto.randomUUID()}`,
          quotedAmountMinor: 12345,
          taxRateBps: 1000,
          billingStatus: "unbilled",
          notes: "初回見積",
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(created.companyId).toBe(fixture.companyId);
      expect(created.quotedAmountMinor).toBe(12345);
      expect(created.billingStatus).toBe("unbilled");
    });
  });

  it("lists only tickets for the requested company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const other = await seedFixture(outerTx);
      await createServiceTicket({ ticketNo: "ST-LIST-A" }, { db: outerTx, companyId: fixture.companyId });
      await createServiceTicket({ ticketNo: "ST-LIST-B" }, { db: outerTx, companyId: other.companyId });

      const result = await listServiceTickets({}, { db: outerTx, companyId: fixture.companyId });

      expect(result.rows.map((row) => row.ticketNo)).toContain("ST-LIST-A");
      expect(result.rows.map((row) => row.ticketNo)).not.toContain("ST-LIST-B");
      expect(result.total).toBeGreaterThanOrEqual(1);
    });
  });

  it("updates a service ticket in company scope", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createServiceTicket({ ticketNo: "ST-UPD" }, { db: outerTx, companyId: fixture.companyId });

      const updated = await updateServiceTicket(
        created.id,
        { quotedAmountMinor: 98765, billingStatus: "ready", notes: "更新済み" },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(updated?.quotedAmountMinor).toBe(98765);
      expect(updated?.billingStatus).toBe("ready");
      const detail = await getServiceTicketById(created.id, { db: outerTx, companyId: fixture.companyId });
      expect(detail?.notes).toBe("更新済み");
    });
  });

  it("deletes a service ticket in company scope", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createServiceTicket({ ticketNo: "ST-DEL" }, { db: outerTx, companyId: fixture.companyId });

      await expect(deleteServiceTicket(created.id, { db: outerTx, companyId: fixture.otherCompanyId })).resolves.toBe(false);
      await expect(deleteServiceTicket(created.id, { db: outerTx, companyId: fixture.companyId })).resolves.toBe(true);

      const rows = await outerTx.select({ value: count() }).from(serviceTickets).where(eq(serviceTickets.id, created.id));
      expect(Number(rows[0]?.value ?? 0)).toBe(0);
    });
  });
});
