import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import {
  type CustomerReservationTokenListFilters,
  listTokens,
} from "@/lib/services/customer-reservation-tokens";

type PageProps = {
  searchParams: Promise<{
    page?: string | string[];
    status?: string | string[];
    reservationId?: string | string[];
    customerId?: string | string[];
    includeRevoked?: string | string[];
  }>;
};

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function parsePage(value: string): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function formatDateTime(value: Date): string {
  return dateFormatter.format(value);
}

function asStatus(
  value: string,
): CustomerReservationTokenListFilters["status"] | undefined {
  return value === "active" || value === "used" || value === "expired" || value === "revoked"
    ? value
    : undefined;
}

function tokenStatusLabel(row: {
  usedAt: Date | null;
  deletedAt: Date | null;
  expiresAt: Date;
}): { label: string; color: string } {
  if (row.deletedAt) return { label: "失効", color: "bg-gray-300 text-gray-800" };
  if (row.usedAt) return { label: "使用済", color: "bg-blue-100 text-blue-800" };
  if (row.expiresAt.getTime() <= Date.now())
    return { label: "期限切れ", color: "bg-yellow-100 text-yellow-800" };
  return { label: "有効", color: "bg-green-100 text-green-800" };
}

export default async function AdminCustomerReservationTokensPage({ searchParams }: PageProps) {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/customer-reservation-tokens");

  const params = await searchParams;
  const page = parsePage(firstValue(params.page));
  const statusRaw = firstValue(params.status);
  const reservationIdRaw = firstValue(params.reservationId).trim();
  const customerIdRaw = firstValue(params.customerId).trim();
  const includeRevokedRaw = firstValue(params.includeRevoked);
  const status = asStatus(statusRaw);
  const includeRevoked = includeRevokedRaw === "1" || status === "revoked";

  const { rows, total } = await listTokens(
    {
      page,
      limit: 20,
      status,
      reservationId: reservationIdRaw || undefined,
      customerId: customerIdRaw || undefined,
      includeRevoked,
    },
    { db, companyId: adminUser.companyId },
  );

  const totalPages = Math.max(Math.ceil(total / 20), 1);
  const searchBase = new URLSearchParams();
  if (status) searchBase.set("status", status);
  if (reservationIdRaw) searchBase.set("reservationId", reservationIdRaw);
  if (customerIdRaw) searchBase.set("customerId", customerIdRaw);
  if (includeRevokedRaw === "1") searchBase.set("includeRevoked", "1");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">顧客予約トークン (customer_reservation_tokens) 管理</h1>
        <p className="text-sm text-gray-600">
          顧客向け予約閲覧・変更・キャンセル用の本人確認トークン一覧です。発行はシステム側で行われます。失効
          (revoke) は手動で実行できます。トークン生値は保存されないため再表示できません。
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          状態
          <select
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            defaultValue={status ?? ""}
            name="status"
          >
            <option value="">すべて</option>
            <option value="active">有効のみ</option>
            <option value="used">使用済のみ</option>
            <option value="expired">期限切れのみ</option>
            <option value="revoked">失効のみ</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          予約 ID
          <input
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono"
            defaultValue={reservationIdRaw}
            name="reservationId"
            placeholder="UUID"
            type="text"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          顧客 ID
          <input
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono"
            defaultValue={customerIdRaw}
            name="customerId"
            placeholder="UUID"
            type="text"
          />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            defaultChecked={includeRevokedRaw === "1"}
            name="includeRevoked"
            type="checkbox"
            value="1"
          />
          失効済みも含める
        </label>
        <button
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          type="submit"
        >
          絞り込む
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
          該当するトークンがありません。
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["状態", "ID", "予約 ID", "顧客 ID", "期限", "使用日時", "発行日時"].map((heading) => (
                    <th
                      className="px-4 py-3 text-left font-medium text-gray-700"
                      key={heading}
                      scope="col"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {rows.map((r) => {
                  const badge = tokenStatusLabel(r);
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-4 py-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-gray-700">
                        <Link
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                          href={`/admin/customer-reservation-tokens/${r.id}`}
                        >
                          {r.id.slice(0, 8)}…
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-gray-700">
                        {r.reservationId.slice(0, 8)}…
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-gray-700">
                        {r.customerId ? `${r.customerId.slice(0, 8)}…` : "-"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                        {formatDateTime(r.expiresAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                        {r.usedAt ? formatDateTime(r.usedAt) : "-"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                        {formatDateTime(r.createdAt)}
                      </td>
                    </tr>
                  );
                })}
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
            <Link
              className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50"
              href={`/admin/customer-reservation-tokens?${new URLSearchParams({ ...Object.fromEntries(searchBase), page: String(page - 1) })}`}
            >
              前へ
            </Link>
          ) : null}
          {page < totalPages ? (
            <Link
              className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50"
              href={`/admin/customer-reservation-tokens?${new URLSearchParams({ ...Object.fromEntries(searchBase), page: String(page + 1) })}`}
            >
              次へ
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
