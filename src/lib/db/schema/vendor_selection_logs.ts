import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { transportOrders } from "./transport_orders";
import { users } from "./users";
import { vendors } from "./vendors";

// 業者選定ログ。
// spec/data-model.md §3.11
export const vendorSelectionLogs = pgTable(
  "vendor_selection_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    transportOrderId: uuid("transport_order_id")
      .notNull()
      .references(() => transportOrders.id, { onDelete: "cascade" }),
    selectedVendorId: uuid("selected_vendor_id")
      .notNull()
      .references(() => vendors.id),
    selectedByUserId: uuid("selected_by_user_id").references(() => users.id),
    selectionMethod: text("selection_method").notNull(),
    selectionReason: text("selection_reason").notNull(),
    selectionReasonNote: text("selection_reason_note"),
    vendorSnapshotResponseRate30d: numeric("vendor_snapshot_response_rate_30d", {
      precision: 5,
      scale: 4,
    }),
    vendorSnapshotDeclineRate30d: numeric("vendor_snapshot_decline_rate_30d", {
      precision: 5,
      scale: 4,
    }),
    vendorSnapshotSupportedStores: integer("vendor_snapshot_supported_stores"),
    vendorSnapshotSupportedDays: integer("vendor_snapshot_supported_days"),
    vendorSnapshotRecommendationMark: text("vendor_snapshot_recommendation_mark"),
    vendorSnapshotIsNewVendor: boolean("vendor_snapshot_is_new_vendor").notNull().default(false),
    consideredVendorIds: uuid("considered_vendor_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    selectionMethodCheck: check(
      "vendor_selection_logs_selection_method_check",
      sql`${t.selectionMethod} IN ('manual', 'recommended', 'fallback', 'auto')`,
    ),
    selectionReasonCheck: check(
      "vendor_selection_logs_selection_reason_check",
      sql`${t.selectionReason} IN ('recommended_top', 'manual_preference', 'vendor_unavailable', 'customer_request', 'distance_priority', 'price_priority', 'other')`,
    ),
    recommendationMarkCheck: check(
      "vendor_selection_logs_recommendation_mark_check",
      sql`${t.vendorSnapshotRecommendationMark} IN ('◎', '○', '△', 'new_vendor') OR ${t.vendorSnapshotRecommendationMark} IS NULL`,
    ),
    noUpdateCheck: check("vendor_selection_logs_no_update", sql`true`),
    transportOrderIdx: index("idx_vendor_selection_logs_transport_order").on(
      t.transportOrderId,
      t.createdAt.desc(),
    ),
    vendorIdx: index("idx_vendor_selection_logs_vendor").on(
      t.selectedVendorId,
      t.createdAt.desc(),
    ),
  }),
);

export type VendorSelectionLog = typeof vendorSelectionLogs.$inferSelect;
export type NewVendorSelectionLog = typeof vendorSelectionLogs.$inferInsert;
