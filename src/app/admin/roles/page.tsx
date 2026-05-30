import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { listRoles, type RoleListItem } from "@/lib/services/roles";

type PageProps = {
  searchParams: Promise<{
    page?: string | string[];
    q?: string | string[];
    includeSystem?: string | string[];
  }>;
};

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function parsePage(value: string): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function formatDate(value: Date): string {
  const parts = dateFormatter.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    return parts.find((datePart) => datePart.type === type)?.value ?? "";
  };
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function roleLabel(role: RoleListItem): string {
  return role.name || role.code || role.id.slice(0, 8);
}

export default async function AdminRolesPage({ searchParams }: PageProps) {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/roles");

  const params = await searchParams;
  const page = parsePage(firstValue(params.page));
  const q = firstValue(params.q);
  const includeSystemParam = firstValue(params.includeSystem);
  const includeSystem = includeSystemParam !== "0";

  const { rows, total } = await listRoles(
    { page, limit: 20, q: q || undefined, includeSystem },
    { db, companyId: adminUser.companyId },
  );

  const totalPages = Math.max(Math.ceil(total / 20), 1);
  const searchBase = new URLSearchParams();
  if (q) searchBase.set("q", q);
  if (!includeSystem) searchBase.set("includeSystem", "0");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">ロール管理</h1>
          <p className="text-sm text-gray-600">アクセス権限の付与単位となるロールを管理します。システム標準ロールは編集不可です。</p>
        </div>
        <Link
          className="inline-flex w-fit items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          href="/admin/roles/new"
        >
          新規作成
        </Link>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          キーワード
          <input
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            defaultValue={q}
            name="q"
            placeholder="名称 / code"
            type="text"
          />
        </label>
        <label className="flex items-end gap-2 text-sm font-medium text-gray-700">
          <input
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            defaultChecked={includeSystem}
            name="includeSystem"
            type="checkbox"
            value="1"
          />
          システム標準も含める
        </label>
        <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700" type="submit">
          絞り込む
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
          該当するロールがありません。
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["種別", "code", "名称", "説明", "作成日"].map((heading) => (
                    <th className="px-4 py-3 text-left font-medium text-gray-700" key={heading} scope="col">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {rows.map((role) => (
                  <tr key={role.id}>
                    <td className="whitespace-nowrap px-4 py-4">
                      {role.isSystem || role.companyId === null ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          システム
                        </span>
                      ) : (
                        <span className="text-gray-500">テナント</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 font-mono text-gray-700">{role.code}</td>
                    <td className="whitespace-nowrap px-4 py-4 font-medium">
                      <Link className="text-blue-600 hover:text-blue-800 hover:underline" href={`/admin/roles/${role.id}`}>
                        {roleLabel(role)}
                      </Link>
                    </td>
                    <td className="px-4 py-4 text-gray-700">{role.description ?? "-"}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{formatDate(role.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>
          {total} 件中 {rows.length} 件表示
        </span>
        <div className="flex gap-2">
          {page > 1 ? (
            <Link className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50" href={`/admin/roles?${new URLSearchParams({ ...Object.fromEntries(searchBase), page: String(page - 1) })}`}>
              前へ
            </Link>
          ) : null}
          {page < totalPages ? (
            <Link className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50" href={`/admin/roles?${new URLSearchParams({ ...Object.fromEntries(searchBase), page: String(page + 1) })}`}>
              次へ
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
