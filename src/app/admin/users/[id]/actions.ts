"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import {
  listAssignableRoles,
  setInternalUserActive,
  setInternalUserStores,
  updateInternalUserRole,
} from "@/lib/services/internal-users";

// Phase 66: 社内ユーザー編集アクション。すべて admin ガード + company-scoped service 経由。

export async function updateInternalUserAction(userId: string, formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    redirect("/login?next=/admin/users");
  }

  // 自分自身の無効化・降格は誤操作防止のため弾く (ロックアウト防止)。
  if (userId === adminUser.userId) {
    const selfActive = formData.get("isActive");
    if (selfActive !== "on" && selfActive !== "true") {
      throw new Error("自分自身を無効化することはできません");
    }
  }

  const roleId = (formData.get("roleId") as string | null)?.trim() || null;
  if (roleId) {
    // 指定 roleId が global role (割当可能) であることを検証してから更新する。
    const assignable = await listAssignableRoles(db);
    if (!assignable.some((r) => r.id === roleId)) {
      throw new Error("不正なロールです");
    }
    await updateInternalUserRole(db, adminUser.companyId, userId, roleId);
  }

  const isActiveRaw = formData.get("isActive");
  const isActive = isActiveRaw === "on" || isActiveRaw === "true";
  await setInternalUserActive(db, adminUser.companyId, userId, isActive);

  // 店舗割当 (チェックされた storeId の集合)。getAll で複数取得。
  const storeIds = formData
    .getAll("storeIds")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  await setInternalUserStores(db, adminUser.companyId, userId, storeIds);

  revalidatePath("/admin/users");
  redirect("/admin/users");
}
