import { config } from "dotenv";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");

const companyId = "33333333-3333-3333-3333-333333333333";
const storeId = "44444444-4444-4444-4444-444444444444";
const rangeStart = "2026-06-01 09:00+09";
const rangeEnd = "2026-06-01 10:00+09";
const insertCount = 100;

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DIRECT_URL or DATABASE_URL must be set for integration tests");
}

const sql = postgres(databaseUrl, { prepare: false });

function isPostgresError(error: unknown): error is { code: string; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
}

async function cleanupReservations(): Promise<void> {
  await sql`
    DELETE FROM public._reservations_slice_test
    WHERE company_id = ${companyId}::uuid
  `;
}

async function insertReservation(): Promise<unknown> {
  return sql`
    INSERT INTO public._reservations_slice_test (company_id, store_id, time_range)
    VALUES (
      ${companyId}::uuid,
      ${storeId}::uuid,
      tstzrange(${rangeStart}, ${rangeEnd}, '[)')
    )
  `;
}

beforeAll(async () => {
  await cleanupReservations();
});

afterAll(async () => {
  try {
    await cleanupReservations();
  } finally {
    await sql.end();
  }
});

it(
  "allows exactly one of 100 parallel identical reservations under the exclusion constraint",
  async () => {
    const inserts = Array.from({ length: insertCount }, () => insertReservation());
    const results = await Promise.allSettled(inserts);

    const successCount = results.filter((result) => result.status === "fulfilled").length;
    const conflictCount = results.filter(
      (result) =>
        result.status === "rejected" &&
        isPostgresError(result.reason) &&
        result.reason.code === "23P01",
    ).length;
    const otherCount = results.length - successCount - conflictCount;

    expect(successCount).toBe(1);
    expect(conflictCount).toBe(99);
    expect(otherCount).toBe(0);
  },
  30_000,
);
