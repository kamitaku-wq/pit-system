import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { roles } from "@/lib/db/schema/roles";
import { users } from "@/lib/db/schema/users";
import { createClient } from "@/lib/supabase/server";

export interface AdminUser {
  userId: string;
  companyId: string;
  roleCode: "admin";
}

export async function getAdminUser(): Promise<AdminUser | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return null;
    }

    const rows = await db
      .select({
        userId: users.id,
        companyId: users.companyId,
        roleCode: roles.code,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      // Phase 66: role=admin に加え is_active / 非削除を必須化 (退職者・無効化ユーザーを締め出す)。
      .where(
        and(
          eq(users.id, user.id),
          eq(roles.code, "admin"),
          eq(users.isActive, true),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    const admin = rows[0];

    if (!admin || admin.roleCode !== "admin") {
      return null;
    }

    return {
      userId: admin.userId,
      companyId: admin.companyId,
      roleCode: "admin",
    };
  } catch {
    return null;
  }
}
