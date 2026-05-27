import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { statuses } from "@/lib/db/schema/statuses";
import { stores } from "@/lib/db/schema/stores";
import { vehicles } from "@/lib/db/schema/vehicles";
import { listServiceTickets, type ServiceTicketListItem } from "@/lib/services/service-tickets";

type PageProps = {
  searchParams: Promise<{
    page?: string | string[];
    statusId?: string | string[];
    vehicleId?: string | string[];
    storeId?: string | string[];
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

function formatMoneyMinor(value: number): string {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(value);
}

function ticketTitle(ticket: ServiceTicketListItem): string {
  return ticket.ticketNo ?? ticket.id.slice(0, 8);
}

export default async function AdminServiceTicketsPage({ searchParams }: PageProps) {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/service-tickets");

  const params = await searchParams;
  const page = parsePage(firstValue(params.page));
  const statusId = firstValue(params.statusId);
  const vehicleId = firstValue(params.vehicleId);
  const storeId = firstValue(params.storeId);

  const [{ rows, total }, statusOptions, vehicleOptions, storeOptions] = await Promise.all([
    listServiceTickets(
      {
        page,
        limit: 20,
        statusId: statusId || undefined,
        vehicleId: vehicleId || undefined,
        storeId: storeId || undefined,
      },
      { db, companyId: adminUser.companyId },
    ),
    db
      .select({ id: statuses.id, name: statuses.name })
      .from(statuses)
      .where(and(eq(statuses.companyId, adminUser.companyId), eq(statuses.statusType, "service"))),
    db
      .select({
        id: vehicles.id,
        registrationNumber: vehicles.registrationNumber,
        vin: vehicles.vin,
        model: vehicles.model,
      })
      .from(vehicles)
      .where(eq(vehicles.companyId, adminUser.companyId)),
    db
      .select({ id: stores.id, name: stores.name })
      .from(stores)
      .where(eq(stores.companyId, adminUser.companyId)),
  ]);

  const totalPages = Math.max(Math.ceil(total / 20), 1);
  const searchBase = new URLSearchParams();
  if (statusId) searchBase.set("statusId", statusId);
  if (vehicleId) searchBase.set("vehicleId", vehicleId);
  if (storeId) searchBase.set("storeId", storeId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">整備伝票</h1>
          <p className="text-sm text-gray-600">整備伝票を作成し、予約・業者通知の起点として管理します。</p>
        </div>
        <Link
          className="inline-flex w-fit items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          href="/admin/service-tickets/new"
        >
          新規作成
        </Link>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          ステータス
          <select className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" defaultValue={statusId} name="statusId">
            <option value="">すべて</option>
            {statusOptions.map((status) => (
              <option key={status.id} value={status.id}>
                {status.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          車両
          <select className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" defaultValue={vehicleId} name="vehicleId">
            <option value="">すべて</option>
            {vehicleOptions.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.registrationNumber ?? vehicle.vin ?? vehicle.model ?? vehicle.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          店舗
          <select className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" defaultValue={storeId} name="storeId">
            <option value="">すべて</option>
            {storeOptions.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700" type="submit">
          絞り込む
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
          該当する整備伝票がありません。
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["伝票番号", "車両", "顧客", "店舗", "ステータス", "作業", "見積金額", "請求", "作成日"].map((heading) => (
                    <th className="px-4 py-3 text-left font-medium text-gray-700" key={heading} scope="col">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {rows.map((ticket) => (
                  <tr key={ticket.id}>
                    <td className="whitespace-nowrap px-4 py-4 font-medium">
                      <Link className="text-blue-600 hover:text-blue-800 hover:underline" href={`/admin/service-tickets/${ticket.id}`}>
                        {ticketTitle(ticket)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{ticket.vehicleLabel ?? "-"}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{ticket.customerName ?? "-"}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{ticket.storeName ?? "-"}</td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                        {ticket.statusName ?? "-"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                      {ticket.workMenuName ?? ticket.workCategoryName ?? "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{formatMoneyMinor(ticket.quotedAmountMinor)}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{ticket.billingStatus}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{formatDate(ticket.createdAt)}</td>
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
            <Link className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50" href={`/admin/service-tickets?${new URLSearchParams({ ...Object.fromEntries(searchBase), page: String(page - 1) })}`}>
              前へ
            </Link>
          ) : null}
          {page < totalPages ? (
            <Link className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50" href={`/admin/service-tickets?${new URLSearchParams({ ...Object.fromEntries(searchBase), page: String(page + 1) })}`}>
              次へ
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
