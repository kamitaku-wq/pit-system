import { index, inet, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";
import { vendorUsers } from "./vendor_users";

// 監査ログ。
// spec/data-model.md §3.14
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorVendorUserId: uuid("actor_vendor_user_id").references(() => vendorUsers.id, {
      onDelete: "set null",
    }),
    actorKind: text("actor_kind").notNull(),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("ix_audit_logs_entity").on(t.entityType, t.entityId),
    actorIdx: index("ix_audit_logs_actor").on(t.actorUserId, t.createdAt),
  }),
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
