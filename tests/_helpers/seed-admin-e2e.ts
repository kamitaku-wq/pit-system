import * as crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { and, eq, isNull } from "drizzle-orm";

import type { DB } from "@/lib/db/client";
import { auditLogs } from "@/lib/db/schema/audit_logs";
import { companies } from "@/lib/db/schema/companies";
import { roles } from "@/lib/db/schema/roles";
import { users } from "@/lib/db/schema/users";

export interface SeededAdminE2E {
  authUserId: string;
  companyId: string;
  userId: string;
  email: string;
  password: string;
}

export async function seedAdminE2E(
  db: DB,
  supabaseAdmin: SupabaseClient,
): Promise<SeededAdminE2E> {
  const uuid = crypto.randomUUID();
  const email = `admin-e2e-${uuid}@test.local`;
  const password = "e2e-admin-pass-001";

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    throw error;
  }

  if (!data.user?.id) {
    throw new Error(`Supabase createUser returned no user for ${email}`);
  }

  const authUserId = data.user.id;
  let seededCompanyId: string;

  try {
    await db.transaction(async (tx) => {
      const [company] = await tx
        .insert(companies)
        .values({
          name: `E2E Admin Company ${uuid}`,
          code: `e2e_admin_${uuid.replaceAll("-", "_")}`,
          deletedAt: null,
        })
        .returning({ id: companies.id });

      if (!company) {
        throw new Error("Failed to seed E2E admin company");
      }

      seededCompanyId = company.id;

      const [globalAdminRole] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.code, "admin"), isNull(roles.companyId)))
        .limit(1);

      if (!globalAdminRole) {
        throw new Error("Global admin role not found. Was seed master applied?");
      }

      await tx.insert(users).values({
        id: authUserId,
        companyId: seededCompanyId,
        roleId: globalAdminRole.id,
        email,
        name: "E2E Admin User",
        isActive: true,
        deletedAt: null,
      });
    });
  } catch (transactionError) {
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
    throw transactionError;
  }

  return {
    authUserId,
    companyId: seededCompanyId!,
    userId: authUserId,
    email,
    password,
  };
}

export async function cleanupAdminE2E(
  db: DB,
  supabaseAdmin: SupabaseClient,
  seeded: Pick<SeededAdminE2E, "authUserId" | "companyId">,
): Promise<void> {
  try {
    await db.delete(auditLogs).where(eq(auditLogs.companyId, seeded.companyId));
    await db.delete(users).where(eq(users.id, seeded.authUserId));
    // users delete trigger (trg_audit_users) が DELETE 監査 row を追加するため再度削除。
    // audit_logs.company_id は ON DELETE RESTRICT なので companies delete 前に空にする必要。
    await db.delete(auditLogs).where(eq(auditLogs.companyId, seeded.companyId));
    await db.delete(companies).where(eq(companies.id, seeded.companyId));
    await supabaseAdmin.auth.admin.deleteUser(seeded.authUserId);
  } catch (error) {
    console.error("Failed to cleanup E2E admin seed", error);
  }
}
