import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";

// 陸送・外注業者。
// spec/data-model.md §3.6
export const vendors = pgTable(
  "vendors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    contactPersonName: text("contact_person_name"),
    email: text("email"),
    phone: text("phone"),
    notificationMethod: text("notification_method").notNull().default("both"),
    isShared: boolean("is_shared").notNull().default(false),
    priority: integer("priority").default(0),
    isActive: boolean("is_active"),
    displayOrder: integer("display_order"),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    notificationMethodCheck: check(
      "vendors_notification_method_check",
      sql`${t.notificationMethod} IN ('email', 'portal', 'both')`,
    ),
  }),
);

export type Vendor = typeof vendors.$inferSelect;
export type NewVendor = typeof vendors.$inferInsert;
