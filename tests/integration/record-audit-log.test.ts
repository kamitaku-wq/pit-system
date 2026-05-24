import { config } from "dotenv";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

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

describe("record_audit_log matrix (9 tables x 3 actions)", () => {
  // ============================================================
  // Tier 1: 単純 FK (company だけ) — users / customers / vendors
  // ============================================================

  describe("customers", () => {
    it("INSERT → create + phone/email redacted", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_customer_insert__') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO customers (company_id, full_name, phone, email)
            VALUES (${company.id}, 'Tester', '09012345678', 'tester@example.com')
            RETURNING id`)[0]!;
          const audit = (await tx<AuditRow[]>`
            SELECT entity_type, entity_id, action, actor_kind, before_json, after_json
            FROM audit_logs WHERE entity_id = ${row.id}::uuid`)[0]!;
          expect(audit.entity_type).toBe("customers");
          expect(audit.action).toBe("create");
          expect(audit.before_json).toBeNull();
          expect((audit.after_json as Record<string, string>).phone).toBe("***5678");
          expect((audit.after_json as Record<string, string>).email).toBe("t***@example.com");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("UPDATE → update + before/after redacted", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_customer_update__') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO customers (company_id, full_name, phone) VALUES (${company.id}, 'X', '09011112222') RETURNING id`)[0]!;
          await tx`UPDATE customers SET phone='08033334444' WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT entity_type, action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='update'`)[0]!;
          expect(audit.action).toBe("update");
          expect((audit.before_json as Record<string, string>).phone).toBe("***2222");
          expect((audit.after_json as Record<string, string>).phone).toBe("***4444");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("DELETE (hard) → delete + before redacted", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_customer_delete__') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO customers (company_id, full_name, phone) VALUES (${company.id}, 'D', '09099887766') RETURNING id`)[0]!;
          await tx`DELETE FROM customers WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='delete'`)[0]!;
          expect(audit.action).toBe("delete");
          expect(audit.after_json).toBeNull();
          expect((audit.before_json as Record<string, string>).phone).toBe("***7766");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });
  });

  describe("vehicles", () => {
    it("INSERT → create + vin redacted to ***LAST6", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_vehicle__') RETURNING id`)[0]!;
          const store = (await tx<{ id: string }[]>`
            INSERT INTO stores (company_id, name) VALUES (${company.id}, 'TestStore') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO vehicles (company_id, store_id, vin, registration_number)
            VALUES (${company.id}, ${store.id}, '1HGBH41JXMN109186', 'XX-1234') RETURNING id`)[0]!;
          const audit = (await tx<AuditRow[]>`
            SELECT action, after_json FROM audit_logs WHERE entity_id = ${row.id}::uuid AND action='create'`)[0]!;
          expect(audit.action).toBe("create");
          expect((audit.after_json as Record<string, string>).vin).toBe("***109186");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("UPDATE → update + vin redacted", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_vehicle_upd__') RETURNING id`)[0]!;
          const store = (await tx<{ id: string }[]>`
            INSERT INTO stores (company_id, name) VALUES (${company.id}, 'TS') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO vehicles (company_id, store_id, vin) VALUES (${company.id}, ${store.id}, 'AAAAAAAAAAAAAAAAA') RETURNING id`)[0]!;
          await tx`UPDATE vehicles SET vin='BBBBBBBBBBBBBBBBB' WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs WHERE entity_id = ${row.id}::uuid AND action='update'`)[0]!;
          expect((audit.before_json as Record<string, string>).vin).toBe("***AAAAAA");
          expect((audit.after_json as Record<string, string>).vin).toBe("***BBBBBB");
        } finally {
          throw new Error("__rollback__");
        }
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
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_vu__') RETURNING id`)[0]!;
          const vendor = (await tx<{ id: string }[]>`
            INSERT INTO vendors (company_id, name) VALUES (${company.id}, 'Vendor1') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO vendor_users (vendor_id, company_id, email)
            VALUES (${vendor.id}, ${company.id}, 'vu@example.com') RETURNING id`)[0]!;
          const audit = (await tx<AuditRow[]>`
            SELECT action, actor_kind, after_json FROM audit_logs WHERE entity_id = ${row.id}::uuid AND action='create'`)[0]!;
          expect(audit.action).toBe("create");
          expect(audit.actor_kind).toBe("system");
          expect((audit.after_json as Record<string, string>).email).toBe("v***@example.com");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });
  });

  // ============================================================
  // Tier 3: vendors (no redact entity)
  // ============================================================

  describe("vendors (no redact entity)", () => {
    it("INSERT → create + passthrough (no PII redact)", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_vendor__') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO vendors (company_id, name, contact_email)
            VALUES (${company.id}, 'V1', 'v1@example.com') RETURNING id`)[0]!;
          const audit = (await tx<AuditRow[]>`
            SELECT action, after_json FROM audit_logs WHERE entity_id = ${row.id}::uuid AND action='create'`)[0]!;
          expect((audit.after_json as Record<string, string>).contact_email).toBe("v1@example.com");
        } finally {
          throw new Error("__rollback__");
        }
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
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_softdel__') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO customers (company_id, full_name) VALUES (${company.id}, 'X') RETURNING id`)[0]!;
          await tx`UPDATE customers SET deleted_at=now() WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action FROM audit_logs WHERE entity_id = ${row.id}::uuid ORDER BY created_at DESC LIMIT 1`)[0]!;
          expect(audit.action).toBe("delete");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("restore (deleted_at NOT NULL→NULL) → action='restore'", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_restore__') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO customers (company_id, full_name, deleted_at) VALUES (${company.id}, 'X', now()) RETURNING id`)[0]!;
          await tx`UPDATE customers SET deleted_at=NULL WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action FROM audit_logs WHERE entity_id = ${row.id}::uuid ORDER BY created_at DESC LIMIT 1`)[0]!;
          expect(audit.action).toBe("restore");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });
  });
});
