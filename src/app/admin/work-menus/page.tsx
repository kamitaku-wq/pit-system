import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { listAllWorkCategoriesForSelect } from "@/lib/services/work-categories";
import { listWorkMenus, type WorkMenuListItem } from "@/lib/services/work-menus";

type PageProps = {
  searchParams: Promise<{
    page?: string | string[];
    q?: string | string[];
    isActive?: string | string[];
    workCategoryId?: string | string[];
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

function parseIsActive(value: string): boolean | undefined {
  if (value === "active") return true;
  if (value === "inactive") return false;
  return undefined;
}

function parseCategoryFilter(value: string): string | null | undefined {
  if (value === "none") return null;
  if (value === "") return undefined;
  return value;
}

function formatDate(value: Date): string {
  const parts = dateFormatter.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    return parts.find((datePart) => datePart.type === type)?.value ?? "";
  };
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function menuLabel(menu: WorkMenuListItem): string {
  return menu.name || menu.code || menu.id.slice(0, 8);
}

function formatPrice(priceMinor: number): string {
  return `¥${priceMinor.toLocaleString("ja-JP")}`;
}

export default async function AdminWorkMenusPage({ searchParams }: PageProps) {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/work-menus");

  const params = await searchParams;
  const page = parsePage(firstValue(params.page));
  const q = firstValue(params.q);
  const isActiveRaw = firstValue(params.isActive);
  const isActiveFilter = parseIsActive(isActiveRaw);
  const categoryRaw = firstValue(params.workCategoryId);
  const categoryFilter = parseCategoryFilter(categoryRaw);

  const ctx = { db, companyId: adminUser.companyId };
  const [{ rows, total }, categories] = await Promise.all([
    listWorkMenus(
      { page, limit: 20, q: q || undefined, isActive: isActiveFilter, workCategoryId: categoryFilter },
      ctx,
    ),
    listAllWorkCategoriesForSelect(ctx),
  ]);

  const totalPages = Math.max(Math.ceil(total / 20), 1);
  const searchBase = new URLSearchParams();
  if (q) searchBase.set("q", q);
  if (isActiveRaw) searchBase.set("isActive", isActiveRaw);
  if (categoryRaw) searchBase.set("workCategoryId", categoryRaw);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">作業メニュー管理</h1>
          <p className="text-sm text-gray-600">整備作業メニューを管理します。</p>
        </div>
        <Link
          className="inline-flex w-fit items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          href="/admin/work-menus/new"
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
            placeholder="名称 / コード"
            type="text"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          カテゴリ
          <select
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            defaultValue={categoryRaw}
            name="workCategoryId"
          >
            <option value="">すべて</option>
            <option value="none">未分類</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          状態
          <select
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            defaultValue={isActiveRaw}
            name="isActive"
          >
            <option value="">すべて</option>
            <option value="active">有効</option>
            <option value="inactive">無効</option>
          </select>
        </label>
        <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700" type="submit">
          絞り込む
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
          該当する作業メニューがありません。
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["メニュー名", "コード", "カテゴリ", "所要時間", "価格", "状態", "作成日"].map((heading) => (
                    <th className="px-4 py-3 text-left font-medium text-gray-700" key={heading} scope="col">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {rows.map((menu) => (
                  <tr key={menu.id}>
                    <td className="whitespace-nowrap px-4 py-4 font-medium">
                      <Link className="text-blue-600 hover:text-blue-800 hover:underline" href={`/admin/work-menus/${menu.id}`}>
                        {menuLabel(menu)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{menu.code}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{menu.workCategoryName ?? "未分類"}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{menu.durationMinutes} 分</td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{formatPrice(menu.priceMinor)}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                      {menu.isActive ? (
                        <span className="rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-800">有効</span>
                      ) : (
                        <span className="rounded-md bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700">無効</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{formatDate(menu.createdAt)}</td>
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
            <Link className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50" href={`/admin/work-menus?${new URLSearchParams({ ...Object.fromEntries(searchBase), page: String(page - 1) })}`}>
              前へ
            </Link>
          ) : null}
          {page < totalPages ? (
            <Link className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50" href={`/admin/work-menus?${new URLSearchParams({ ...Object.fromEntries(searchBase), page: String(page + 1) })}`}>
              次へ
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
