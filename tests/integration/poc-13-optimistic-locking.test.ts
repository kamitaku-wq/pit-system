import { config } from "dotenv";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");

const rowId = "55555555-5555-5555-5555-555555555555";
const parallelism = 10;
const initialVersion = 1;

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DIRECT_URL or DATABASE_URL must be set for integration tests");
}

const sql = postgres(databaseUrl, { prepare: false });

interface UpdateOutcome {
  index: number;
  affected: number;
}

beforeAll(async () => {
  await sql`DELETE FROM public._version_test WHERE id = ${rowId}::uuid`;
  await sql`
    INSERT INTO public._version_test (id, name, version)
    VALUES (${rowId}::uuid, 'initial', ${initialVersion})
  `;
});

afterAll(async () => {
  try {
    await sql`DELETE FROM public._version_test WHERE id = ${rowId}::uuid`;
  } finally {
    await sql.end();
  }
});

it(
  "lets exactly one of N parallel WHERE-version updates succeed (optimistic locking)",
  async () => {
    const tasks: Array<Promise<UpdateOutcome>> = Array.from(
      { length: parallelism },
      (_, i) =>
        sql`
          UPDATE public._version_test
          SET name = ${"worker-${i}"}, version = version + 1, updated_at = now()
          WHERE id = ${rowId}::uuid AND version = ${initialVersion}
          RETURNING id, version
        `.then((rows): UpdateOutcome => ({ index: i, affected: rows.length })),
    );

    const results = await Promise.allSettled(tasks);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<UpdateOutcome> => r.status === "fulfilled",
    );
    const errorCount = results.length - fulfilled.length;
    const successCount = fulfilled.filter((r) => r.value.affected === 1).length;
    const conflictCount = fulfilled.filter((r) => r.value.affected === 0).length;

    expect(errorCount).toBe(0);
    expect(successCount).toBe(1);
    expect(conflictCount).toBe(parallelism - 1);

    const [final] = await sql<{ version: number; name: string }[]>`
      SELECT name, version FROM public._version_test WHERE id = ${rowId}::uuid
    `;
    expect(final?.version).toBe(initialVersion + 1);
  },
  30_000,
);
