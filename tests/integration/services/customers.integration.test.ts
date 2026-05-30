import { config } from "dotenv";
import { and, count, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { customers } from "@/lib/db/schema/customers";
import {
  createCustomer,
  deleteCustomer,
  getCustomerById,
  listCustomers,
  updateCustomer,
} from "@/lib/services/customers";

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
      { name: `__cust_company_${suffix}__`, code: `cust_${suffix}` },
      { name: `__cust_other_${suffix}__`, code: `cust_o_${suffix}` },
    ])
    .returning({ id: companies.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
  };
}

describeIntegration("customer services", () => {
  it("creates a customer scoped to the admin company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const created = await createCustomer(
        {
          fullName: `田中太郎 ${suffix}`,
          fullNameKana: "タナカタロウ",
          email: `tanaka_${suffix}@example.com`,
          phone: "090-1234-5678",
          postalCode: "100-0001",
          address: "東京都千代田区千代田1-1",
          notes: "VIP 顧客",
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(created.companyId).toBe(fixture.companyId);
      expect(created.fullName).toBe(`田中太郎 ${suffix}`);
      expect(created.email).toBe(`tanaka_${suffix}@example.com`);
      expect(created.notes).toBe("VIP 顧客");
    });
  });

  it("lists only customers for the requested company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const other = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      await createCustomer({ fullName: `CUST-LIST-A-${suffix}` }, { db: outerTx, companyId: fixture.companyId });
      await createCustomer({ fullName: `CUST-LIST-B-${suffix}` }, { db: outerTx, companyId: other.companyId });

      const result = await listCustomers({}, { db: outerTx, companyId: fixture.companyId });

      expect(result.rows.map((row) => row.fullName)).toContain(`CUST-LIST-A-${suffix}`);
      expect(result.rows.map((row) => row.fullName)).not.toContain(`CUST-LIST-B-${suffix}`);
      expect(result.total).toBeGreaterThanOrEqual(1);
    });
  });

  it("updates a customer in company scope", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createCustomer(
        { fullName: "佐藤花子", email: "old@example.com" },
        { db: outerTx, companyId: fixture.companyId },
      );

      const updated = await updateCustomer(
        created.id,
        { fullName: "佐藤花子改", phone: "080-0000-1111", notes: "更新メモ" },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(updated?.fullName).toBe("佐藤花子改");
      expect(updated?.phone).toBe("080-0000-1111");
      expect(updated?.email).toBe("old@example.com");
      const detail = await getCustomerById(created.id, { db: outerTx, companyId: fixture.companyId });
      expect(detail?.notes).toBe("更新メモ");
    });
  });

  it("soft-deletes a customer and rejects cross-tenant delete", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createCustomer(
        { fullName: "削除対象" },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(deleteCustomer(created.id, { db: outerTx, companyId: fixture.otherCompanyId })).resolves.toBe(false);
      await expect(deleteCustomer(created.id, { db: outerTx, companyId: fixture.companyId })).resolves.toBe(true);

      // soft delete: row 残るが deletedAt が立つ
      const rows = await outerTx
        .select({ value: count() })
        .from(customers)
        .where(and(eq(customers.id, created.id), isNull(customers.deletedAt)));
      expect(Number(rows[0]?.value ?? 0)).toBe(0);

      // 詳細取得は null
      const detail = await getCustomerById(created.id, { db: outerTx, companyId: fixture.companyId });
      expect(detail).toBeNull();
    });
  });

  it("filters customers by q (fullName / kana / email / phone partial match)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      await createCustomer(
        { fullName: `山田Q-${suffix}`, fullNameKana: "ヤマダキュー", email: `yamada_${suffix}@ex.com` },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createCustomer(
        { fullName: `鈴木Z-${suffix}`, phone: `070-1111-${suffix.slice(0, 4)}` },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createCustomer({ fullName: `関係なし-${suffix}` }, { db: outerTx, companyId: fixture.companyId });

      const byName = await listCustomers({ q: `山田Q-${suffix}` }, { db: outerTx, companyId: fixture.companyId });
      expect(byName.rows.map((r) => r.fullName)).toEqual([`山田Q-${suffix}`]);

      const byKana = await listCustomers({ q: "ヤマダキュー" }, { db: outerTx, companyId: fixture.companyId });
      expect(byKana.rows.find((r) => r.fullName === `山田Q-${suffix}`)).toBeDefined();

      const byEmail = await listCustomers({ q: `yamada_${suffix}` }, { db: outerTx, companyId: fixture.companyId });
      expect(byEmail.rows.find((r) => r.fullName === `山田Q-${suffix}`)).toBeDefined();

      const byPhone = await listCustomers({ q: `070-1111-${suffix.slice(0, 4)}` }, { db: outerTx, companyId: fixture.companyId });
      expect(byPhone.rows.find((r) => r.fullName === `鈴木Z-${suffix}`)).toBeDefined();
    });
  });
});
