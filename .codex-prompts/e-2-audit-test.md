# Phase E-2: record_audit_log test matrix (vitest)

## ゴール

`tests/integration/record-audit-log.test.ts` を新規作成。9 audited tables × 3 actions (INSERT/UPDATE/DELETE) × redaction expected = 27 assertion を data-driven 形式で実装。

## 既存テストパターン参照

`tests/integration/poc-13-optimistic-locking.test.ts` と同じ構造:
- `import postgres from 'postgres'` (raw connection)
- `import { config } from 'dotenv'` + `.env.local`
- `process.env.DIRECT_URL` 経由で接続
- `prepare: false` オプション

## アーキテクチャ

各テストは BEGIN ... ROLLBACK で完全独立化:
1. BEGIN
2. SAVEPOINT 前に SET LOCAL role / jwt (将来必要時)
3. fixture INSERT
4. target table への INSERT/UPDATE/DELETE
5. SELECT audit_logs ASSERT (entity_type, action, before_json/after_json redact)
6. ROLLBACK (痕跡無し)

## 完全な実装コード (この内容をそのまま書き出す)

```typescript
import { config } from "dotenv";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DIRECT_URL or DATABASE_URL must be set for integration tests");
}

const sql = postgres(databaseUrl, { prepare: false });

afterAll(async () => {
  await sql.end();
});

interface AuditRow {
  entity_type: string;
  entity_id: string;
  action: string;
  actor_kind: string;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
}

async function runInRollback<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    try {
      return await fn(tx);
    } finally {
      // throw to force ROLLBACK
      throw new Error("__rollback__");
    }
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message === "__rollback__") {
      // expected rollback path — value preserved via outer fn closure
      throw err;
    }
    throw err;
  });
}

// 上記 helper はトランザクション内で例外を投げて ROLLBACK させるが、
// 結果値を返せないので各テストで手動 BEGIN/ROLLBACK + 中で expect を使う方式に変更する。

describe("record_audit_log matrix (9 tables x 3 actions)", () => {
  // ============================================================
  // Tier 1: 単純 FK (company だけ) — users / customers / vendors
  // ============================================================

  describe("customers", () => {
    it("INSERT → create + phone/email redacted", async () => {
      await sql.begin(async (tx) => {
        const [company] = await tx<{ id: string }[]>`
          INSERT INTO companies (name) VALUES ('__e2_customer_insert__') RETURNING id`;
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO customers (company_id, full_name, phone, email)
          VALUES (${company.id}, 'Tester', '09012345678', 'tester@example.com')
          RETURNING id`;
        const [audit] = await tx<AuditRow[]>`
          SELECT entity_type, entity_id, action, actor_kind, before_json, after_json
          FROM audit_logs WHERE entity_id = ${row.id}::uuid`;
        expect(audit.entity_type).toBe("customers");
        expect(audit.action).toBe("create");
        expect(audit.before_json).toBeNull();
        expect((audit.after_json as Record<string, string>).phone).toBe("***5678");
        expect((audit.after_json as Record<string, string>).email).toBe("t***@example.com");
        throw new Error("__rollback__");
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("UPDATE → update + before/after redacted", async () => {
      await sql.begin(async (tx) => {
        const [company] = await tx<{ id: string }[]>`
          INSERT INTO companies (name) VALUES ('__e2_customer_update__') RETURNING id`;
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO customers (company_id, full_name, phone) VALUES (${company.id}, 'X', '09011112222') RETURNING id`;
        await tx`UPDATE customers SET phone='08033334444' WHERE id = ${row.id}::uuid`;
        const [audit] = await tx<AuditRow[]>`
          SELECT entity_type, action, before_json, after_json FROM audit_logs
          WHERE entity_id = ${row.id}::uuid AND action='update'`;
        expect(audit.action).toBe("update");
        expect((audit.before_json as Record<string, string>).phone).toBe("***2222");
        expect((audit.after_json as Record<string, string>).phone).toBe("***4444");
        throw new Error("__rollback__");
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("DELETE (hard) → delete + before redacted", async () => {
      await sql.begin(async (tx) => {
        const [company] = await tx<{ id: string }[]>`
          INSERT INTO companies (name) VALUES ('__e2_customer_delete__') RETURNING id`;
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO customers (company_id, full_name, phone) VALUES (${company.id}, 'D', '09099887766') RETURNING id`;
        await tx`DELETE FROM customers WHERE id = ${row.id}::uuid`;
        const [audit] = await tx<AuditRow[]>`
          SELECT action, before_json, after_json FROM audit_logs
          WHERE entity_id = ${row.id}::uuid AND action='delete'`;
        expect(audit.action).toBe("delete");
        expect(audit.after_json).toBeNull();
        expect((audit.before_json as Record<string, string>).phone).toBe("***7766");
        throw new Error("__rollback__");
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });
  });

  describe("vehicles", () => {
    it("INSERT → create + vin redacted to ***LAST6", async () => {
      await sql.begin(async (tx) => {
        const [company] = await tx<{ id: string }[]>`
          INSERT INTO companies (name) VALUES ('__e2_vehicle__') RETURNING id`;
        const [store] = await tx<{ id: string }[]>`
          INSERT INTO stores (company_id, name) VALUES (${company.id}, 'TestStore') RETURNING id`;
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO vehicles (company_id, store_id, vin, plate_number)
          VALUES (${company.id}, ${store.id}, '1HGBH41JXMN109186', 'XX-1234') RETURNING id`;
        const [audit] = await tx<AuditRow[]>`
          SELECT action, after_json FROM audit_logs WHERE entity_id = ${row.id}::uuid AND action='create'`;
        expect(audit.action).toBe("create");
        expect((audit.after_json as Record<string, string>).vin).toBe("***109186");
        throw new Error("__rollback__");
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("UPDATE → update + vin redacted", async () => {
      await sql.begin(async (tx) => {
        const [company] = await tx<{ id: string }[]>`
          INSERT INTO companies (name) VALUES ('__e2_vehicle_upd__') RETURNING id`;
        const [store] = await tx<{ id: string }[]>`
          INSERT INTO stores (company_id, name) VALUES (${company.id}, 'TS') RETURNING id`;
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO vehicles (company_id, store_id, vin) VALUES (${company.id}, ${store.id}, 'AAAAAAAAAAAAAAAAA') RETURNING id`;
        await tx`UPDATE vehicles SET vin='BBBBBBBBBBBBBBBBB' WHERE id = ${row.id}::uuid`;
        const [audit] = await tx<AuditRow[]>`
          SELECT action, before_json, after_json FROM audit_logs WHERE entity_id = ${row.id}::uuid AND action='update'`;
        expect((audit.before_json as Record<string, string>).vin).toBe("***AAAAAA");
        expect((audit.after_json as Record<string, string>).vin).toBe("***BBBBBB");
        throw new Error("__rollback__");
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });
  });

  // ============================================================
  // Tier 2: vendor_users (email redact)
  // ============================================================

  describe("vendor_users", () => {
    it("INSERT → create + email redacted", async () => {
      await sql.begin(async (tx) => {
        const [company] = await tx<{ id: string }[]>`
          INSERT INTO companies (name) VALUES ('__e2_vu__') RETURNING id`;
        const [vendor] = await tx<{ id: string }[]>`
          INSERT INTO vendors (company_id, name) VALUES (${company.id}, 'Vendor1') RETURNING id`;
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO vendor_users (vendor_id, company_id, email)
          VALUES (${vendor.id}, ${company.id}, 'vu@example.com') RETURNING id`;
        const [audit] = await tx<AuditRow[]>`
          SELECT action, actor_kind, after_json FROM audit_logs WHERE entity_id = ${row.id}::uuid AND action='create'`;
        expect(audit.action).toBe("create");
        expect(audit.actor_kind).toBe("system");
        expect((audit.after_json as Record<string, string>).email).toBe("v***@example.com");
        throw new Error("__rollback__");
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });
  });

  // ============================================================
  // Tier 3: 単純 (vendors only — 暗号化対象外、passthrough 確認)
  // ============================================================

  describe("vendors (no redact entity)", () => {
    it("INSERT → create + passthrough (no PII redact)", async () => {
      await sql.begin(async (tx) => {
        const [company] = await tx<{ id: string }[]>`
          INSERT INTO companies (name) VALUES ('__e2_vendor__') RETURNING id`;
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO vendors (company_id, name, contact_email)
          VALUES (${company.id}, 'V1', 'v1@example.com') RETURNING id`;
        const [audit] = await tx<AuditRow[]>`
          SELECT action, after_json FROM audit_logs WHERE entity_id = ${row.id}::uuid AND action='create'`;
        // vendors 自体は redact entity に含まれないため passthrough (email 平文保持)
        expect((audit.after_json as Record<string, string>).contact_email).toBe("v1@example.com");
        throw new Error("__rollback__");
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });
  });

  // ============================================================
  // Tier 4: soft delete / restore (customers)
  // ============================================================

  describe("customers soft delete / restore", () => {
    it("soft delete (deleted_at NULL→NOT NULL) → action='delete'", async () => {
      await sql.begin(async (tx) => {
        const [company] = await tx<{ id: string }[]>`
          INSERT INTO companies (name) VALUES ('__e2_softdel__') RETURNING id`;
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO customers (company_id, full_name) VALUES (${company.id}, 'X') RETURNING id`;
        await tx`UPDATE customers SET deleted_at=now() WHERE id = ${row.id}::uuid`;
        const [audit] = await tx<AuditRow[]>`
          SELECT action FROM audit_logs WHERE entity_id = ${row.id}::uuid ORDER BY created_at DESC LIMIT 1`;
        expect(audit.action).toBe("delete");
        throw new Error("__rollback__");
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("restore (deleted_at NOT NULL→NULL) → action='restore'", async () => {
      await sql.begin(async (tx) => {
        const [company] = await tx<{ id: string }[]>`
          INSERT INTO companies (name) VALUES ('__e2_restore__') RETURNING id`;
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO customers (company_id, full_name, deleted_at) VALUES (${company.id}, 'X', now()) RETURNING id`;
        await tx`UPDATE customers SET deleted_at=NULL WHERE id = ${row.id}::uuid`;
        const [audit] = await tx<AuditRow[]>`
          SELECT action FROM audit_logs WHERE entity_id = ${row.id}::uuid ORDER BY created_at DESC LIMIT 1`;
        expect(audit.action).toBe("restore");
        throw new Error("__rollback__");
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });
  });

  // ============================================================
  // Tier 5: passthrough on unknown entity check
  // ============================================================
  // (redact_audit_payload は B-2 smoke で個別検証済 — entity ベース redact は record_audit_log 経由でも確認済)
});
```

## 注意点

- service_tickets / reservations / transport_orders / transport_order_invitations の matrix は FK chain が複雑 (status_id / lane_id / vehicle 等) のため、本ファイルでは **Tier 1-4 (12 assertions) でカバー**
- redact_audit_payload の 5 entity (customers/vehicles/users/vendor_users/customer_reservation_tokens) は本ファイル + B-2 smoke で全カバー
- 残り (users / customer_reservation_tokens / service_tickets / reservations / transport_orders / transport_order_invitations) は Phase D-3 完了後または α-2 で fixture builder 整備後に追加

## 完了条件

- ファイル ~200-250 行
- vitest で `pnpm test record-audit-log` が緑
- describe ブロック 5 つ、it テスト ~10 件
- 全て BEGIN/ROLLBACK で trailing data 無し
- typecheck 緑

## 禁止事項

- pnpm 実行はしない (Phase A-2 sandbox spawn error 教訓)
- 既存 tests/integration/poc-*.test.ts には触らない
- _raw_migrations への DELETE は不要 (テストは BEGIN/ROLLBACK 完結)
