import { bigint, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { reservations } from "./reservations";
import { serviceTickets } from "./service_tickets";
import { transportOrders } from "./transport_orders";
import { users } from "./users";

// 添付ファイル。
// spec/data-model.md §3.15
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    serviceTicketId: uuid("service_ticket_id").references(() => serviceTickets.id, {
      onDelete: "cascade",
    }),
    reservationId: uuid("reservation_id").references(() => reservations.id, {
      onDelete: "cascade",
    }),
    transportOrderId: uuid("transport_order_id").references(() => transportOrders.id, {
      onDelete: "cascade",
    }),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    storageBucket: text("storage_bucket").notNull(),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type"),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    checksum: text("checksum"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    storageUnique: unique("attachments_storage_bucket_storage_key_unique").on(
      t.storageBucket,
      t.storageKey,
    ),
  }),
);

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
