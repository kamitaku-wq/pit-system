import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withAuthenticatedDb<T>(
  authUserId: string,
  fn: (tx: DrizzleTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE authenticated`);
    await tx.execute(sql`
      SELECT set_config(
        'request.jwt.claims',
        ${JSON.stringify({ sub: authUserId, role: "authenticated" })},
        true
      )
    `);

    return fn(tx);
  });
}
