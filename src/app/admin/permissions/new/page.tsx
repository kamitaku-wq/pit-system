import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { listRoles } from "@/lib/services/roles";
import { createPermissionAction } from "./actions";

function InputField(props: {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
      {props.label}
      {props.required ? <span className="text-xs text-red-600">必須</span> : null}
      <input
        className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        defaultValue={props.defaultValue}
        name={props.name}
        placeholder={props.placeholder}
        required={props.required}
      />
    </label>
  );
}

export default async function NewPermissionPage() {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/permissions/new");

  // 自社 role のみ候補に出す (system role 配下の permission は作成不可)。
  const { rows: roleRows } = await listRoles(
    { includeSystem: false, limit: 100 },
    { db, companyId: adminUser.companyId },
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/permissions">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">権限 新規作成</h1>
          <p className="text-sm text-gray-600">
            自社ロールに紐付ける権限を登録します。同一ロール内で code は一意である必要があります。
          </p>
        </div>
      </div>

      {roleRows.length === 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          編集可能なテナントロールが存在しません。先に
          <Link className="mx-1 underline" href="/admin/roles/new">
            ロール
          </Link>
          を作成してください。
        </div>
      ) : (
        <form action={createPermissionAction} className="rounded-md border border-gray-200 bg-white p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              ロール
              <span className="text-xs text-red-600">必須</span>
              <select
                className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
                name="roleId"
                required
              >
                <option value="">選択してください</option>
                {roleRows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </select>
            </label>
            <InputField
              label="code"
              name="code"
              placeholder="例: ticket.create"
              required
            />
            <InputField
              label="resource"
              name="resource"
              placeholder="例: service_tickets (任意)"
            />
            <InputField
              label="action"
              name="action"
              placeholder="例: create (任意)"
            />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Link
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              href="/admin/permissions"
            >
              キャンセル
            </Link>
            <button
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
              type="submit"
            >
              登録する
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
