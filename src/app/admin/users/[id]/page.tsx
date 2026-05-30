import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { getInternalUserDetail, listAssignableRoles } from "@/lib/services/internal-users";
import { listAllStoresForSelect } from "@/lib/services/stores";
import { updateInternalUserAction } from "./actions";

type PageProps = { params: Promise<{ id: string }> };

export default async function InternalUserEditPage({ params }: PageProps) {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    redirect("/login?next=/admin/users");
  }

  const { id } = await params;
  const [user, roles, stores] = await Promise.all([
    getInternalUserDetail(db, adminUser.companyId, id),
    listAssignableRoles(db),
    listAllStoresForSelect({ db, companyId: adminUser.companyId }),
  ]);

  if (!user) {
    notFound();
  }

  const assignedStoreIds = new Set(user.storeIds);
  const isSelf = user.id === adminUser.userId;
  const updateAction = updateInternalUserAction.bind(null, user.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/users">
          ← 社内ユーザー一覧に戻る
        </Link>
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold tracking-normal">{user.name}</h2>
          <p className="text-sm text-gray-600">{user.email}</p>
        </div>
      </div>

      <form action={updateAction} className="flex flex-col gap-6 rounded-md border border-gray-200 bg-white p-6">
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          ロール
          <select
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            name="roleId"
            defaultValue={user.roleId ?? ""}
          >
            <option value="">（未設定）</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-gray-700">所属店舗</legend>
          {stores.length === 0 ? (
            <p className="text-sm text-gray-500">店舗が登録されていません。</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {stores.map((store) => (
                <label key={store.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    name="storeIds"
                    value={store.id}
                    defaultChecked={assignedStoreIds.has(store.id)}
                  />
                  {store.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={user.isActive}
            disabled={isSelf}
          />
          有効 (チェックを外すとログインできなくなります)
        </label>
        {isSelf ? (
          <p className="-mt-3 text-xs text-amber-700">
            自分自身のアカウントは無効化できません。
          </p>
        ) : null}

        <div className="flex justify-end gap-3">
          <Link
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            href="/admin/users"
          >
            キャンセル
          </Link>
          <button
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            type="submit"
          >
            保存
          </button>
        </div>
      </form>
    </div>
  );
}
