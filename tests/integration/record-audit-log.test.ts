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

  // ============================================================
  // E-2 extension: remaining audit assertions
  // ============================================================

  describe("users", () => {
    it("INSERT → create + email redacted", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_users_insert__') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            WITH auth_user AS (
              INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
              VALUES (gen_random_uuid(), 'authenticated', 'authenticated', 'user@example.com', now(), now(), now())
              RETURNING id
            )
            INSERT INTO users (id, company_id, email, name)
            SELECT id, ${company.id}, 'user@example.com', 'User Insert' FROM auth_user
            RETURNING id`)[0]!;
          const audit = (await tx<AuditRow[]>`
            SELECT entity_type, entity_id, action, actor_kind, before_json, after_json
            FROM audit_logs WHERE entity_id = ${row.id}::uuid AND action='create'`)[0]!;
          expect(audit.entity_type).toBe("users");
          expect(audit.action).toBe("create");
          expect(audit.before_json).toBeNull();
          expect((audit.after_json as Record<string, string>).email).toBe("u***@example.com");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("UPDATE → update + before/after email redacted", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_users_update__') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            WITH auth_user AS (
              INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
              VALUES (gen_random_uuid(), 'authenticated', 'authenticated', 'user-before@example.com', now(), now(), now())
              RETURNING id
            )
            INSERT INTO users (id, company_id, email, name)
            SELECT id, ${company.id}, 'user-before@example.com', 'User Update' FROM auth_user
            RETURNING id`)[0]!;
          await tx`UPDATE users SET email='user-after@example.com' WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='update'`)[0]!;
          expect(audit.action).toBe("update");
          expect((audit.before_json as Record<string, string>).email).toBe("u***@example.com");
          expect((audit.after_json as Record<string, string>).email).toBe("u***@example.com");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("DELETE (soft) → delete + email redacted", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_users_delete__') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            WITH auth_user AS (
              INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
              VALUES (gen_random_uuid(), 'authenticated', 'authenticated', 'user-delete@example.com', now(), now(), now())
              RETURNING id
            )
            INSERT INTO users (id, company_id, email, name)
            SELECT id, ${company.id}, 'user-delete@example.com', 'User Delete' FROM auth_user
            RETURNING id`)[0]!;
          await tx`UPDATE users SET deleted_at=now() WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='delete'`)[0]!;
          expect(audit.action).toBe("delete");
          expect((audit.before_json as Record<string, string>).email).toBe("u***@example.com");
          expect((audit.after_json as Record<string, string>).email).toBe("u***@example.com");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });
  });

  describe("vehicles DELETE", () => {
    it("DELETE (hard) → delete + vin redacted", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_vehicles_delete__') RETURNING id`)[0]!;
          const store = (await tx<{ id: string }[]>`
            INSERT INTO stores (company_id, name) VALUES (${company.id}, 'Vehicle Delete Store') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO vehicles (company_id, store_id, vin)
            VALUES (${company.id}, ${store.id}, '1HGBH41JXMN654321') RETURNING id`)[0]!;
          await tx`DELETE FROM vehicles WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='delete'`)[0]!;
          expect(audit.action).toBe("delete");
          expect(audit.after_json).toBeNull();
          expect((audit.before_json as Record<string, string>).vin).toBe("***654321");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });
  });

  describe("vendors update/delete (no redact entity)", () => {
    it("UPDATE → update + passthrough", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_vendors_update__') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO vendors (company_id, name, contact_email)
            VALUES (${company.id}, 'Vendor Before', 'before@example.com') RETURNING id`)[0]!;
          await tx`UPDATE vendors SET contact_email='after@example.com' WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='update'`)[0]!;
          expect(audit.action).toBe("update");
          expect((audit.before_json as Record<string, string>).contact_email).toBe("before@example.com");
          expect((audit.after_json as Record<string, string>).contact_email).toBe("after@example.com");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("DELETE (hard) → delete + passthrough", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_vendors_delete__') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO vendors (company_id, name, contact_email)
            VALUES (${company.id}, 'Vendor Delete', 'delete@example.com') RETURNING id`)[0]!;
          await tx`DELETE FROM vendors WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='delete'`)[0]!;
          expect(audit.action).toBe("delete");
          expect(audit.after_json).toBeNull();
          expect((audit.before_json as Record<string, string>).contact_email).toBe("delete@example.com");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });
  });

  describe("vendor_users update/delete", () => {
    it("UPDATE → update + before/after email redacted", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_vendor_users_update__') RETURNING id`)[0]!;
          const vendor = (await tx<{ id: string }[]>`
            INSERT INTO vendors (company_id, name) VALUES (${company.id}, 'Vendor User Update Vendor') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO vendor_users (vendor_id, company_id, email)
            VALUES (${vendor.id}, ${company.id}, 'vendor-user-before@example.com') RETURNING id`)[0]!;
          await tx`UPDATE vendor_users SET email='vendor-user-after@example.com' WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='update'`)[0]!;
          expect(audit.action).toBe("update");
          expect((audit.before_json as Record<string, string>).email).toBe("v***@example.com");
          expect((audit.after_json as Record<string, string>).email).toBe("v***@example.com");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("DELETE (hard) → delete + email redacted", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_vendor_users_delete__') RETURNING id`)[0]!;
          const vendor = (await tx<{ id: string }[]>`
            INSERT INTO vendors (company_id, name) VALUES (${company.id}, 'Vendor User Delete Vendor') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO vendor_users (vendor_id, company_id, email)
            VALUES (${vendor.id}, ${company.id}, 'vendor-user-delete@example.com') RETURNING id`)[0]!;
          await tx`DELETE FROM vendor_users WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='delete'`)[0]!;
          expect(audit.action).toBe("delete");
          expect(audit.after_json).toBeNull();
          expect((audit.before_json as Record<string, string>).email).toBe("v***@example.com");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });
  });

  describe("service_tickets", () => {
    it("INSERT → create + passthrough", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_service_tickets_insert__') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO service_tickets (company_id, quoted_amount_minor, tax_rate_bps, billing_status)
            VALUES (${company.id}, 12000, 1000, 'quoted') RETURNING id`)[0]!;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='create'`)[0]!;
          expect(audit.action).toBe("create");
          expect(audit.before_json).toBeNull();
          expect((audit.after_json as Record<string, number>).quoted_amount_minor).toBe(12000);
          expect((audit.after_json as Record<string, number>).tax_rate_bps).toBe(1000);
          expect((audit.after_json as Record<string, string>).billing_status).toBe("quoted");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("UPDATE → update + before/after passthrough", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_service_tickets_update__') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO service_tickets (company_id, quoted_amount_minor, billing_status)
            VALUES (${company.id}, 1000, 'quoted') RETURNING id`)[0]!;
          await tx`
            UPDATE service_tickets
            SET quoted_amount_minor=2000, billing_status='billed'
            WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='update'`)[0]!;
          expect(audit.action).toBe("update");
          expect((audit.before_json as Record<string, number>).quoted_amount_minor).toBe(1000);
          expect((audit.after_json as Record<string, number>).quoted_amount_minor).toBe(2000);
          expect((audit.before_json as Record<string, string>).billing_status).toBe("quoted");
          expect((audit.after_json as Record<string, string>).billing_status).toBe("billed");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("DELETE (hard) → delete + passthrough", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_service_tickets_delete__') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO service_tickets (company_id, quoted_amount_minor, billing_status)
            VALUES (${company.id}, 3000, 'paid') RETURNING id`)[0]!;
          await tx`DELETE FROM service_tickets WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='delete'`)[0]!;
          expect(audit.action).toBe("delete");
          expect(audit.after_json).toBeNull();
          expect((audit.before_json as Record<string, number>).quoted_amount_minor).toBe(3000);
          expect((audit.before_json as Record<string, string>).billing_status).toBe("paid");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });
  });

  describe("reservations", () => {
    it("INSERT → create + passthrough", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_reservations_insert__') RETURNING id`)[0]!;
          const store = (await tx<{ id: string }[]>`
            INSERT INTO stores (company_id, name) VALUES (${company.id}, 'Reservation Insert Store') RETURNING id`)[0]!;
          const lane = (await tx<{ id: string }[]>`
            INSERT INTO lanes (company_id, store_id, name)
            VALUES (${company.id}, ${store.id}, 'Reservation Insert Lane') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO reservations (company_id, store_id, lane_id, start_at, end_at)
            VALUES (${company.id}, ${store.id}, ${lane.id}, '2026-01-01 10:00:00+00'::timestamptz, '2026-01-01 11:00:00+00'::timestamptz)
            RETURNING id`)[0]!;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='create'`)[0]!;
          expect(audit.action).toBe("create");
          expect(audit.before_json).toBeNull();
          expect((audit.after_json as Record<string, string>).start_at).toBe("2026-01-01T10:00:00+00:00");
          expect((audit.after_json as Record<string, string>).end_at).toBe("2026-01-01T11:00:00+00:00");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("UPDATE → update + before/after passthrough", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_reservations_update__') RETURNING id`)[0]!;
          const store = (await tx<{ id: string }[]>`
            INSERT INTO stores (company_id, name) VALUES (${company.id}, 'Reservation Update Store') RETURNING id`)[0]!;
          const lane = (await tx<{ id: string }[]>`
            INSERT INTO lanes (company_id, store_id, name)
            VALUES (${company.id}, ${store.id}, 'Reservation Update Lane') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO reservations (company_id, store_id, lane_id, start_at, end_at)
            VALUES (${company.id}, ${store.id}, ${lane.id}, '2026-01-02 10:00:00+00'::timestamptz, '2026-01-02 11:00:00+00'::timestamptz)
            RETURNING id`)[0]!;
          await tx`
            UPDATE reservations
            SET start_at='2026-01-02 12:00:00+00'::timestamptz,
                end_at='2026-01-02 13:00:00+00'::timestamptz
            WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='update'`)[0]!;
          expect(audit.action).toBe("update");
          expect((audit.before_json as Record<string, string>).start_at).toBe("2026-01-02T10:00:00+00:00");
          expect((audit.before_json as Record<string, string>).end_at).toBe("2026-01-02T11:00:00+00:00");
          expect((audit.after_json as Record<string, string>).start_at).toBe("2026-01-02T12:00:00+00:00");
          expect((audit.after_json as Record<string, string>).end_at).toBe("2026-01-02T13:00:00+00:00");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("DELETE (hard) → delete + passthrough", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_reservations_delete__') RETURNING id`)[0]!;
          const store = (await tx<{ id: string }[]>`
            INSERT INTO stores (company_id, name) VALUES (${company.id}, 'Reservation Delete Store') RETURNING id`)[0]!;
          const lane = (await tx<{ id: string }[]>`
            INSERT INTO lanes (company_id, store_id, name)
            VALUES (${company.id}, ${store.id}, 'Reservation Delete Lane') RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO reservations (company_id, store_id, lane_id, start_at, end_at)
            VALUES (${company.id}, ${store.id}, ${lane.id}, '2026-01-03 10:00:00+00'::timestamptz, '2026-01-03 11:00:00+00'::timestamptz)
            RETURNING id`)[0]!;
          await tx`DELETE FROM reservations WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='delete'`)[0]!;
          expect(audit.action).toBe("delete");
          expect(audit.after_json).toBeNull();
          expect((audit.before_json as Record<string, string>).start_at).toBe("2026-01-03T10:00:00+00:00");
          expect((audit.before_json as Record<string, string>).end_at).toBe("2026-01-03T11:00:00+00:00");
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });
  });

  describe("transport_orders", () => {
    it("INSERT → create + passthrough", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_transport_orders_insert__') RETURNING id`)[0]!;
          const pickupStore = (await tx<{ id: string }[]>`
            INSERT INTO stores (company_id, name) VALUES (${company.id}, 'Transport Insert Pickup') RETURNING id`)[0]!;
          const deliveryStore = (await tx<{ id: string }[]>`
            INSERT INTO stores (company_id, name) VALUES (${company.id}, 'Transport Insert Delivery') RETURNING id`)[0]!;
          const vehicle = (await tx<{ id: string }[]>`
            INSERT INTO vehicles (company_id, store_id, vin)
            VALUES (${company.id}, ${pickupStore.id}, 'TRINSERT000000001') RETURNING id`)[0]!;
          const serviceTicket = (await tx<{ id: string }[]>`
            INSERT INTO service_tickets (company_id, vehicle_id, store_id, billing_status)
            VALUES (${company.id}, ${vehicle.id}, ${pickupStore.id}, 'unbilled') RETURNING id`)[0]!;
          const status = (await tx<{ id: string }[]>`
            INSERT INTO statuses (company_id, status_type, key, name, display_order, is_initial, is_active)
            VALUES (${company.id}, 'transport', 'requested', 'Requested', 1, true, true) RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO transport_orders (
              company_id, order_number, service_ticket_id, vehicle_id, status_id,
              movement_type, pickup_store_id, delivery_store_id, can_drive, tow_required
            )
            VALUES (
              ${company.id}, '__e2_transport_orders_insert__-001',
              ${serviceTicket.id}, ${vehicle.id}, ${status.id},
              'one_way', ${pickupStore.id}, ${deliveryStore.id}, true, false
            ) RETURNING id`)[0]!;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='create'`)[0]!;
          expect(audit.action).toBe("create");
          expect(audit.before_json).toBeNull();
          expect((audit.after_json as Record<string, string>).movement_type).toBe("one_way");
          expect((audit.after_json as Record<string, string>).order_number).toBe(
            "__e2_transport_orders_insert__-001",
          );
          expect((audit.after_json as Record<string, number>).version).toBe(1);
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("UPDATE → update + before/after passthrough", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_transport_orders_update__') RETURNING id`)[0]!;
          const pickupStore = (await tx<{ id: string }[]>`
            INSERT INTO stores (company_id, name) VALUES (${company.id}, 'Transport Update Pickup') RETURNING id`)[0]!;
          const deliveryStore = (await tx<{ id: string }[]>`
            INSERT INTO stores (company_id, name) VALUES (${company.id}, 'Transport Update Delivery') RETURNING id`)[0]!;
          const vehicle = (await tx<{ id: string }[]>`
            INSERT INTO vehicles (company_id, store_id, vin)
            VALUES (${company.id}, ${pickupStore.id}, 'TRUPDATE000000001') RETURNING id`)[0]!;
          const serviceTicket = (await tx<{ id: string }[]>`
            INSERT INTO service_tickets (company_id, vehicle_id, store_id, billing_status)
            VALUES (${company.id}, ${vehicle.id}, ${pickupStore.id}, 'unbilled') RETURNING id`)[0]!;
          const status = (await tx<{ id: string }[]>`
            INSERT INTO statuses (company_id, status_type, key, name, display_order, is_initial, is_active)
            VALUES (${company.id}, 'transport', 'requested', 'Requested', 1, true, true) RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO transport_orders (
              company_id, order_number, service_ticket_id, vehicle_id, status_id,
              movement_type, pickup_store_id, delivery_store_id, can_drive, tow_required
            )
            VALUES (
              ${company.id}, '__e2_transport_orders_update__-001',
              ${serviceTicket.id}, ${vehicle.id}, ${status.id},
              'one_way', ${pickupStore.id}, ${deliveryStore.id}, true, false
            ) RETURNING id`)[0]!;
          await tx`UPDATE transport_orders SET notes='updated', version=version + 1 WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='update'`)[0]!;
          expect(audit.action).toBe("update");
          expect((audit.before_json as Record<string, string>).movement_type).toBe("one_way");
          expect((audit.after_json as Record<string, string>).movement_type).toBe("one_way");
          expect((audit.before_json as Record<string, string | null>).notes).toBeNull();
          expect((audit.after_json as Record<string, string>).notes).toBe("updated");
          expect((audit.before_json as Record<string, number>).version).toBe(1);
          expect((audit.after_json as Record<string, number>).version).toBe(2);
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });

    it("DELETE (hard) → delete + passthrough", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_transport_orders_delete__') RETURNING id`)[0]!;
          const pickupStore = (await tx<{ id: string }[]>`
            INSERT INTO stores (company_id, name) VALUES (${company.id}, 'Transport Delete Pickup') RETURNING id`)[0]!;
          const deliveryStore = (await tx<{ id: string }[]>`
            INSERT INTO stores (company_id, name) VALUES (${company.id}, 'Transport Delete Delivery') RETURNING id`)[0]!;
          const vehicle = (await tx<{ id: string }[]>`
            INSERT INTO vehicles (company_id, store_id, vin)
            VALUES (${company.id}, ${pickupStore.id}, 'TRDELETE000000001') RETURNING id`)[0]!;
          const serviceTicket = (await tx<{ id: string }[]>`
            INSERT INTO service_tickets (company_id, vehicle_id, store_id, billing_status)
            VALUES (${company.id}, ${vehicle.id}, ${pickupStore.id}, 'unbilled') RETURNING id`)[0]!;
          const status = (await tx<{ id: string }[]>`
            INSERT INTO statuses (company_id, status_type, key, name, display_order, is_initial, is_active)
            VALUES (${company.id}, 'transport', 'requested', 'Requested', 1, true, true) RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO transport_orders (
              company_id, order_number, service_ticket_id, vehicle_id, status_id,
              movement_type, pickup_store_id, delivery_store_id, can_drive, tow_required
            )
            VALUES (
              ${company.id}, '__e2_transport_orders_delete__-001',
              ${serviceTicket.id}, ${vehicle.id}, ${status.id},
              'one_way', ${pickupStore.id}, ${deliveryStore.id}, true, false
            ) RETURNING id`)[0]!;
          await tx`DELETE FROM transport_orders WHERE id = ${row.id}::uuid`;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='delete'`)[0]!;
          expect(audit.action).toBe("delete");
          expect(audit.after_json).toBeNull();
          expect((audit.before_json as Record<string, string>).movement_type).toBe("one_way");
          expect((audit.before_json as Record<string, string>).order_number).toBe(
            "__e2_transport_orders_delete__-001",
          );
          expect((audit.before_json as Record<string, number>).version).toBe(1);
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });
  });

  describe("transport_order_invitations", () => {
    it("INSERT → create + passthrough", async () => {
      await sql.begin(async (tx) => {
        try {
          const company = (await tx<{ id: string }[]>`
            INSERT INTO companies (name) VALUES ('__e2_transport_order_invitations_insert__') RETURNING id`)[0]!;
          const pickupStore = (await tx<{ id: string }[]>`
            INSERT INTO stores (company_id, name) VALUES (${company.id}, 'Invitation Pickup') RETURNING id`)[0]!;
          const deliveryStore = (await tx<{ id: string }[]>`
            INSERT INTO stores (company_id, name) VALUES (${company.id}, 'Invitation Delivery') RETURNING id`)[0]!;
          const vehicle = (await tx<{ id: string }[]>`
            INSERT INTO vehicles (company_id, store_id, vin)
            VALUES (${company.id}, ${pickupStore.id}, 'TRINVITE000000001') RETURNING id`)[0]!;
          const serviceTicket = (await tx<{ id: string }[]>`
            INSERT INTO service_tickets (company_id, vehicle_id, store_id, billing_status)
            VALUES (${company.id}, ${vehicle.id}, ${pickupStore.id}, 'unbilled') RETURNING id`)[0]!;
          const status = (await tx<{ id: string }[]>`
            INSERT INTO statuses (company_id, status_type, key, name, display_order, is_initial, is_active)
            VALUES (${company.id}, 'transport', 'requested', 'Requested', 1, true, true) RETURNING id`)[0]!;
          const vendor = (await tx<{ id: string }[]>`
            INSERT INTO vendors (company_id, name) VALUES (${company.id}, 'Invitation Vendor') RETURNING id`)[0]!;
          const transportOrder = (await tx<{ id: string }[]>`
            INSERT INTO transport_orders (
              company_id, order_number, service_ticket_id, vehicle_id, status_id,
              movement_type, pickup_store_id, delivery_store_id, can_drive, tow_required
            )
            VALUES (
              ${company.id}, '__e2_transport_order_invitations_insert__-001',
              ${serviceTicket.id}, ${vehicle.id}, ${status.id},
              'one_way', ${pickupStore.id}, ${deliveryStore.id}, true, false
            ) RETURNING id`)[0]!;
          const row = (await tx<{ id: string }[]>`
            INSERT INTO transport_order_invitations (
              company_id, transport_order_id, vendor_id, invitee_name, invitee_phone,
              invited_at, bound_vendor_id
            )
            VALUES (
              ${company.id}, ${transportOrder.id}, ${vendor.id},
              'Invitee Name', '09012345678', now(), ${vendor.id}
            ) RETURNING id`)[0]!;
          const audit = (await tx<AuditRow[]>`
            SELECT action, before_json, after_json FROM audit_logs
            WHERE entity_id = ${row.id}::uuid AND action='create'`)[0]!;
          expect(audit.action).toBe("create");
          expect(audit.before_json).toBeNull();
          expect((audit.after_json as Record<string, string>).response).toBe("pending");
          expect((audit.after_json as Record<string, boolean>).is_winning_bid).toBe(false);
        } finally {
          throw new Error("__rollback__");
        }
      }).catch((err) => {
        if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
      });
    });
  });
});
