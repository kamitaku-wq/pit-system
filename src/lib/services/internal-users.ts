import { and, asc, eq, isNull } from "drizzle-orm";
import { roles, type Role } from "@/lib/db/schema/roles";
import { stores } from "@/lib/db/schema/stores";
import { users } from "@/lib/db/schema/users";
import { userStoreMemberships } from "@/lib/db/schema/user_store_memberships";

// Phase 66: 社内ユーザー (users) 管理。Google ログインで初回 viewer provisioning された社員を
// 管理者が一覧し、ロール変更 / 店舗割当 / 有効・無効化 (退職者対応) する。
// 全操作 company-scoped (WHERE company_id) で cross-tenant を防ぐ (既存 master CRUD と同方針)。

// Drizzle does not export a common interface covering both DB and PgTransaction.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type InternalUserListItem = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  roleId: string | null;
  roleCode: string | null;
  roleName: string | null;
  storeNames: string[];
};

// 社内ユーザー一覧 (論理削除を除外、名前順)。各ユーザーの所属店舗名も集約する。
export async function listInternalUsers(
  db: Db,
  companyId: string,
): Promise<InternalUserListItem[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isActive: users.isActive,
      roleId: users.roleId,
      roleCode: roles.code,
      roleName: roles.name,
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.companyId, companyId), isNull(users.deletedAt)))
    .orderBy(asc(users.name));

  // 店舗割当を 1 クエリで取得し user_id で束ねる (N+1 回避)。company-scoped。
  const membershipRows = await db
    .select({
      userId: userStoreMemberships.userId,
      storeName: stores.name,
    })
    .from(userStoreMemberships)
    .innerJoin(stores, eq(stores.id, userStoreMemberships.storeId))
    .where(
      and(
        eq(userStoreMemberships.companyId, companyId),
        isNull(userStoreMemberships.deletedAt),
      ),
    );

  const storesByUser = new Map<string, string[]>();
  for (const m of membershipRows as Array<{ userId: string; storeName: string }>) {
    const list = storesByUser.get(m.userId) ?? [];
    list.push(m.storeName);
    storesByUser.set(m.userId, list);
  }

  return (rows as Array<Omit<InternalUserListItem, "storeNames">>).map((r) => ({
    ...r,
    storeNames: storesByUser.get(r.id) ?? [],
  }));
}

// 割当可能なロール一覧 (global roles = company_id IS NULL)。
export async function listAssignableRoles(db: Db): Promise<Role[]> {
  return db
    .select()
    .from(roles)
    .where(isNull(roles.companyId))
    .orderBy(asc(roles.name));
}

// ユーザー詳細 (company-scoped)。所属店舗 id も返す (割当チェックボックス用)。
export async function getInternalUserDetail(
  db: Db,
  companyId: string,
  userId: string,
): Promise<{
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  roleId: string | null;
  storeIds: string[];
} | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isActive: users.isActive,
      roleId: users.roleId,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId), isNull(users.deletedAt)))
    .limit(1);
  const user = rows[0];
  if (!user) return null;

  const membershipRows = await db
    .select({ storeId: userStoreMemberships.storeId })
    .from(userStoreMemberships)
    .where(
      and(
        eq(userStoreMemberships.userId, userId),
        eq(userStoreMemberships.companyId, companyId),
        isNull(userStoreMemberships.deletedAt),
      ),
    );

  return {
    ...user,
    storeIds: (membershipRows as Array<{ storeId: string }>).map((m) => m.storeId),
  };
}

// ロール変更 (company-scoped)。roleId が global role であることは呼び出し側で担保。
export async function updateInternalUserRole(
  db: Db,
  companyId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  await db
    .update(users)
    .set({ roleId, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.companyId, companyId), isNull(users.deletedAt)));
}

// 有効・無効化 (退職者対応)。無効化されると getAdminUser / callback ゲートで弾かれる。
export async function setInternalUserActive(
  db: Db,
  companyId: string,
  userId: string,
  isActive: boolean,
): Promise<void> {
  await db
    .update(users)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.companyId, companyId), isNull(users.deletedAt)));
}

// 店舗割当の置き換え (指定 storeIds に揃える)。company 所有の店舗のみ対象に絞り cross-tenant を防ぐ。
// 既存割当との差分で INSERT (or 論理削除済みの復活) / 論理削除する。UNIQUE(user_id, store_id) があるため
// 物理 DELETE ではなく deletedAt フラグで管理する。
export async function setInternalUserStores(
  db: Db,
  companyId: string,
  userId: string,
  storeIds: string[],
): Promise<void> {
  await db.transaction(async (tx: Db) => {
    // 対象ユーザーが自社かを確認 (cross-tenant 防御)。
    const userRows = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.companyId, companyId), isNull(users.deletedAt)))
      .limit(1);
    if (!userRows[0]) {
      throw new Error("user not found in this company");
    }

    // 指定された store が自社所有かを検証し、有効な集合に絞る。
    const validStoreIds = new Set<string>();
    if (storeIds.length > 0) {
      const ownedStores = await tx
        .select({ id: stores.id })
        .from(stores)
        .where(and(eq(stores.companyId, companyId), isNull(stores.deletedAt)));
      const owned = new Set((ownedStores as Array<{ id: string }>).map((s) => s.id));
      for (const sid of storeIds) {
        if (owned.has(sid)) validStoreIds.add(sid);
      }
    }

    // 現在の全 membership (削除済み含む) を取得し差分計算。
    const current = await tx
      .select({
        id: userStoreMemberships.id,
        storeId: userStoreMemberships.storeId,
        deletedAt: userStoreMemberships.deletedAt,
      })
      .from(userStoreMemberships)
      .where(
        and(
          eq(userStoreMemberships.userId, userId),
          eq(userStoreMemberships.companyId, companyId),
        ),
      );

    const currentByStore = new Map<
      string,
      { id: string; deletedAt: Date | null }
    >();
    for (const row of current as Array<{ id: string; storeId: string; deletedAt: Date | null }>) {
      currentByStore.set(row.storeId, { id: row.id, deletedAt: row.deletedAt });
    }

    const now = new Date();

    // 追加・復活: 指定集合にあるが未登録 or 論理削除済みのもの。
    for (const sid of validStoreIds) {
      const existing = currentByStore.get(sid);
      if (!existing) {
        await tx.insert(userStoreMemberships).values({
          companyId,
          userId,
          storeId: sid,
        });
      } else if (existing.deletedAt !== null) {
        await tx
          .update(userStoreMemberships)
          .set({ deletedAt: null, updatedAt: now })
          .where(eq(userStoreMemberships.id, existing.id));
      }
    }

    // 削除: 現在 active だが指定集合に無いもの → 論理削除。
    for (const [sid, existing] of currentByStore) {
      if (!validStoreIds.has(sid) && existing.deletedAt === null) {
        await tx
          .update(userStoreMemberships)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(userStoreMemberships.id, existing.id));
      }
    }
  });
}
