import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { listInternalUsers } from "@/lib/services/internal-users";

// Phase 66: 社内ユーザー管理一覧。Google ログインで初回 viewer provisioning された社員を
// 管理者がロール変更 / 店舗割当 / 有効・無効化する。admin のみ (getAdminUser ガード)。
export default async function InternalUsersPage() {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    redirect("/login?next=/admin/users");
  }

  const users = await listInternalUsers(db, adminUser.companyId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-normal">社内ユーザー</h2>
        <p className="text-sm text-gray-600">
          社員のログインは会社の Google アカウントで行います。新しい社員は初回ログイン後にここへ表示され、
          ロールと所属店舗を割り当てるまでは閲覧のみ可能です。
        </p>
      </div>

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-700">名前</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">メール</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">ロール</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">所属店舗</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">状態</th>
              <th className="px-4 py-3 text-right font-medium text-gray-700">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-gray-500" colSpan={6}>
                  社内ユーザーがまだ登録されていません。社員が Google でログインすると表示されます。
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3 text-gray-600">{u.roleName ?? "-"}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {u.storeNames.length > 0 ? u.storeNames.join(", ") : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        u.isActive
                          ? "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
                          : "inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
                      }
                    >
                      {u.isActive ? "有効" : "無効"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link className="text-blue-600 hover:underline" href={`/admin/users/${u.id}`}>
                      編集
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
