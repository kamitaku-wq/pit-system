import { config } from "dotenv";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Phase 64-C follow-up #1 (security hardening / post/0031):
//   transport_orders.status_id / version の column-level UPDATE 権限を authenticated から剥奪し、
//   vendor (authenticated role) が respond_to_transport_order / complete_transport_order RPC を
//   迂回して status を直接書き換えるバイパスを封鎖したことを検証する。
//
// 手法:
//   1. ACL の source of truth = has_column_privilege() を直接照会し、status_id/version が剥奪され、
//      scheduled_*/updated_at が温存されている (過剰除去でない) ことを確定する。
//   2. 行動テスト: SET LOCAL ROLE authenticated 下の直接 UPDATE が SQLSTATE 42501 で拒否されることを
//      確認する。column 権限チェックは RLS の行評価より前 (ExecCheckRTPerms) に走るため、
//      0 行マッチ (seed 不要) でも permission denied が発火する。これにより自社案件含め authenticated は
//      status_id/version を一切書けないことが示される。
//   harness は tenant-isolation.test.ts と同じ postgres.js sql.begin + SET LOCAL ROLE 方式。

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const sqlClient =
  databaseUrl && databaseUrl.length > 0 ? postgres(databaseUrl, { prepare: false }) : undefined;
const describeIntegration = describe.skipIf(sqlClient === undefined);

afterAll(async () => {
  await sqlClient?.end();
});

// authenticated role 下の直接 UPDATE を試み、捕捉したエラーの SQLSTATE を返す。
// sql.begin は UPDATE 失敗時に自動 ROLLBACK し、reject を伝播する (seed していないため後始末不要)。
async function expectUpdateRejected(updateStatement: string): Promise<string | undefined> {
  const sql = sqlClient!;
  let code: string | undefined;
  try {
    await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE authenticated`;
      await tx.unsafe(updateStatement);
    });
  } catch (err) {
    code = (err as { code?: string }).code;
  }
  return code;
}

describeIntegration(
  "transport_orders status grant hardening (Phase 64-C follow-up #1 / post/0031)",
  () => {
    it("revokes UPDATE(status_id, version) from authenticated while retaining scheduled_*/updated_at", async () => {
      const sql = sqlClient!;
      const rows = await sql<
        {
          status_id: boolean;
          version: boolean;
          scheduled_pickup_at: boolean;
          scheduled_delivery_at: boolean;
          scheduled_return_at: boolean;
          updated_at: boolean;
        }[]
      >`
      SELECT
        has_column_privilege('authenticated', 'public.transport_orders', 'status_id', 'UPDATE') AS status_id,
        has_column_privilege('authenticated', 'public.transport_orders', 'version', 'UPDATE') AS version,
        has_column_privilege('authenticated', 'public.transport_orders', 'scheduled_pickup_at', 'UPDATE') AS scheduled_pickup_at,
        has_column_privilege('authenticated', 'public.transport_orders', 'scheduled_delivery_at', 'UPDATE') AS scheduled_delivery_at,
        has_column_privilege('authenticated', 'public.transport_orders', 'scheduled_return_at', 'UPDATE') AS scheduled_return_at,
        has_column_privilege('authenticated', 'public.transport_orders', 'updated_at', 'UPDATE') AS updated_at
    `;
      const priv = rows[0];
      expect(priv).toBeDefined();
      // 剥奪済 (バイパス封鎖)
      expect(priv?.status_id).toBe(false);
      expect(priv?.version).toBe(false);
      // 温存済 (vendor の予定入力 scheduleTransportOrder が依然動作する = 過剰除去でない)
      expect(priv?.scheduled_pickup_at).toBe(true);
      expect(priv?.scheduled_delivery_at).toBe(true);
      expect(priv?.scheduled_return_at).toBe(true);
      expect(priv?.updated_at).toBe(true);
    });

    it("rejects direct status_id UPDATE by authenticated role with 42501 (column privilege precedes RLS)", async () => {
      const code = await expectUpdateRejected(
        "UPDATE transport_orders SET status_id = gen_random_uuid() WHERE id = gen_random_uuid()",
      );
      expect(code).toBe("42501");
    });

    it("rejects direct version UPDATE by authenticated role with 42501", async () => {
      const code = await expectUpdateRejected(
        "UPDATE transport_orders SET version = version + 1 WHERE id = gen_random_uuid()",
      );
      expect(code).toBe("42501");
    });
  },
);
