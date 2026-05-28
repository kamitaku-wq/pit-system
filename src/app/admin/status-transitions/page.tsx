import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import {
  listStatusTransitions,
  type StatusTransitionListItem,
} from "@/lib/services/status-transitions";
import { STATUS_TYPES, type StatusType } from "@/lib/services/statuses";

type PageProps = {
  searchParams: Promise<{
    page?: string | string[];
    statusType?: string | string[];
  }>;
};

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const STATUS_TYPE_LABELS: Record<StatusType, string> = {
  reservation: "予約",
  service: "サービス",
  transport: "陸送",
  vendor: "ベンダー",
};

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function parsePage(value: string): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseStatusType(value: string): StatusType | undefined {
  return (STATUS_TYPES as readonly string[]).includes(value) ? (value as StatusType) : undefined;
}

function formatDate(value: Date): string {
  const parts = dateFormatter.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    return parts.find((datePart) => datePart.type === type)?.value ?? "";
  };
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function statusLabel(name: string | null, key: string | null, fallback: string): string {
  return name ?? key ?? fallback;
}

export default async function AdminStatusTransitionsPage({ searchParams }: PageProps) {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/status-transitions");

  const params = await searchParams;
  const page = parsePage(firstValue(params.page));
  const statusType = parseStatusType(firstValue(params.statusType));

  const { rows, total } = await listStatusTransitions(
    { page, limit: 20, statusType },
    { db, companyId: adminUser.companyId },
  );

  const totalPages = Math.max(Math.ceil(total / 20), 1);
  const searchBase = new URLSearchParams();
  if (statusType) searchBase.set("statusType", statusType);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">ステータス遷移ルール</h1>
          <p className="text-sm text-gray-600">
            各種別ごとに「どの状態からどの状態へ遷移できるか」「通知を発火するか」を管理します。
          </p>
        </div>
        <Link
          className="inline-flex w-fit items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          href="/admin/status-transitions/new"
        >
          新規作成
        </Link>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          種別
          <select
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            defaultValue={statusType ?? ""}
            name="statusType"
          >
            <option value="">すべて</option>
            {STATUS_TYPES.map((value) => (
              <option key={value} value={value}>
                {STATUS_TYPE_LABELS[value]}
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
          該当する遷移ルールがありません。
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["種別", "From", "To", "必須権限", "必須ロール", "通知", "作成日"].map((heading) => (
                    <th className="px-4 py-3 text-left font-medium text-gray-700" key={heading} scope="col">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {rows.map((transition: StatusTransitionListItem) => (
                  <tr key={transition.id}>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                      {STATUS_TYPE_LABELS[transition.statusType as StatusType] ?? transition.statusType}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                      {transition.fromStatusId === null
                        ? <span className="text-gray-500">(初期遷移)</span>
                        : statusLabel(transition.fromStatusName, transition.fromStatusKey, transition.fromStatusId.slice(0, 8))}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 font-medium">
                      <Link
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                        href={`/admin/status-transitions/${transition.id}`}
                      >
                        {statusLabel(transition.toStatusName, transition.toStatusKey, transition.toStatusId.slice(0, 8))}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{transition.requiredPermissionKey ?? "-"}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{transition.requiredRoleKey ?? "-"}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{transition.triggersNotification ? "◯" : ""}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{formatDate(transition.createdAt)}</td>
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
            <Link className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50" href={`/admin/status-transitions?${new URLSearchParams({ ...Object.fromEntries(searchBase), page: String(page - 1) })}`}>
              前へ
            </Link>
          ) : null}
          {page < totalPages ? (
            <Link className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50" href={`/admin/status-transitions?${new URLSearchParams({ ...Object.fromEntries(searchBase), page: String(page + 1) })}`}>
              次へ
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
