import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export interface VendorWithInvitationStatus {
  vendorId: string;
  vendorName: string;
  vendorCode: string | null;
  latestInvitationId: string | null;
  latestInvitationStatus: "pending" | "sent" | "accepted" | "expired" | "revoked" | null;
  latestInvitationEmail: string | null;
  latestInvitationSentAt: Date | null;
  latestInvitationCreatedAt: Date | null;
}

type InvitationStatus = NonNullable<VendorWithInvitationStatus["latestInvitationStatus"]>;

interface VendorInvitationRow {
  id: unknown;
  name: unknown;
  code: unknown;
  invitation_id: unknown;
  status: unknown;
  email: unknown;
  sent_at: unknown;
  created_at: unknown;
}

const invitationStatuses = new Set<InvitationStatus>([
  "pending",
  "sent",
  "accepted",
  "expired",
  "revoked",
]);

export async function getVendorsWithInvitationStatus(
  database: typeof db,
  companyId: string,
): Promise<VendorWithInvitationStatus[]> {
  const result = await database.execute(sql`
    SELECT v.id, v.name, NULL::text AS code,
      i.id AS invitation_id, i.status, i.email, i.sent_at, i.created_at
    FROM public.vendors v
    LEFT JOIN LATERAL (
      SELECT id, status, email, sent_at, created_at
      FROM public.admin_vendor_invitations
      WHERE vendor_id = v.id
      ORDER BY CASE status
        WHEN 'pending' THEN 1
        WHEN 'sent' THEN 2
        WHEN 'accepted' THEN 3
        WHEN 'expired' THEN 4
        WHEN 'revoked' THEN 5
        ELSE 99
      END, sent_at DESC NULLS LAST, created_at DESC
      LIMIT 1
    ) i ON TRUE
    WHERE v.company_id = ${companyId}
      AND v.deleted_at IS NULL
    ORDER BY v.name ASC;
  `);

  return getRows(result).map(mapVendorInvitationRow);
}

function getRows(result: unknown): VendorInvitationRow[] {
  const rows = (result as { rows?: unknown }).rows ?? result;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map((row: unknown): VendorInvitationRow => row as VendorInvitationRow);
}

function mapVendorInvitationRow(row: VendorInvitationRow): VendorWithInvitationStatus {
  return {
    vendorId: expectString(row.id, "vendors.id"),
    vendorName: expectString(row.name, "vendors.name"),
    vendorCode: expectNullableString(row.code, "vendors.code"),
    latestInvitationId: expectNullableString(row.invitation_id, "admin_vendor_invitations.id"),
    latestInvitationStatus: expectNullableInvitationStatus(row.status),
    latestInvitationEmail: expectNullableString(row.email, "admin_vendor_invitations.email"),
    latestInvitationSentAt: expectNullableDate(row.sent_at, "admin_vendor_invitations.sent_at"),
    latestInvitationCreatedAt: expectNullableDate(row.created_at, "admin_vendor_invitations.created_at"),
  };
}

function expectString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
  return value;
}

function expectNullableString(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }
  return expectString(value, fieldName);
}

function expectNullableInvitationStatus(
  value: unknown,
): VendorWithInvitationStatus["latestInvitationStatus"] {
  if (value === null) {
    return null;
  }
  if (typeof value === "string" && invitationStatuses.has(value as InvitationStatus)) {
    return value as InvitationStatus;
  }
  throw new Error("admin_vendor_invitations.status must be a known invitation status");
}

function expectNullableDate(value: unknown, fieldName: string): Date | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  // raw SQL (database.execute) は Drizzle schema mapping を経由しないため、
  // postgres-js は timestamptz を string (ISO 8601) で返す。string も accept する。
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`${fieldName} must be a valid Date string`);
    }
    return parsed;
  }
  throw new Error(`${fieldName} must be a Date`);
}
