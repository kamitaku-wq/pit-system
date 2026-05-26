import { redirect } from "next/navigation";
import Link from 'next/link';

import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { listTransportOrdersWithLatestInvitation } from "@/lib/services/transport-orders";

type AdminTransportOrdersPageProps = {
  searchParams: Promise<{
    status?: string | string[];
  }>;
};

type BadgeConfig = {
  className: string;
  label: string;
};

const movementTypeLabels: Record<string, string> = {
  one_way: "片道",
  round_trip: "往復",
  pickup_only: "引取のみ",
  three_point: "三点移動",
};

const vendorResponseBadges: Record<string, BadgeConfig> = {
  pending: {
    className: "bg-yellow-100 text-yellow-800",
    label: "対応待ち",
  },
  accepted: {
    className: "bg-green-100 text-green-800",
    label: "対応可",
  },
  rejected: {
    className: "bg-red-100 text-red-800",
    label: "対応不可",
  },
};

const invitationResponseBadges: Record<string, BadgeConfig> = {
  pending: {
    className: "bg-yellow-100 text-yellow-800",
    label: "招待中",
  },
  accepted: {
    className: "bg-green-100 text-green-800",
    label: "受諾",
  },
  rejected: {
    className: "bg-red-100 text-red-800",
    label: "辞退",
  },
  revoked: {
    className: "bg-gray-100 text-gray-700",
    label: "取消",
  },
  expired: {
    className: "bg-gray-100 text-gray-700",
    label: "期限切れ",
  },
};

const noInvitationBadge: BadgeConfig = {
  className: "bg-gray-100 text-gray-700",
  label: "招待なし",
};

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function getFirstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function getMovementTypeLabel(movementType: string): string {
  return movementTypeLabels[movementType] ?? movementType;
}

function getVendorResponseBadge(response: string | null): BadgeConfig | null {
  if (!response) {
    return null;
  }

  return vendorResponseBadges[response] ?? {
    className: "bg-gray-100 text-gray-700",
    label: response,
  };
}

function getInvitationResponseBadge(response: string | null): BadgeConfig {
  if (!response) {
    return noInvitationBadge;
  }

  return invitationResponseBadges[response] ?? {
    className: "bg-gray-100 text-gray-700",
    label: response,
  };
}

function formatDateTime(value: Date | string | null): string {
  if (!value) {
    return "-";
  }

  const date = value instanceof Date ? value : new Date(value);
  const parts = dateTimeFormatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    return parts.find((datePart) => datePart.type === type)?.value ?? "";
  };

  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

function Badge({ badge }: { badge: BadgeConfig }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>
      {badge.label}
    </span>
  );
}

export default async function AdminTransportOrdersPage({ searchParams }: AdminTransportOrdersPageProps) {
  const params = await searchParams;
  const statusKey = getFirstValue(params.status);
  const adminUser = await getAdminUser();

  if (!adminUser) {
    redirect("/vendor/login?next=/admin/transport-orders");
  }

  const orders = await listTransportOrdersWithLatestInvitation(db, adminUser.companyId, {
    statusKey: statusKey || undefined,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">業者通知・回送管理</h1>
        <p className="text-sm text-gray-600">陸送依頼の通知状況と業者対応を一覧で確認します。</p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          ステータス
          <select
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            defaultValue={statusKey}
            name="status"
          >
            <option value="">すべて</option>
            <option value="pending">通知前</option>
            <option value="sent">通知済</option>
            <option value="arrived">到着済</option>
            <option value="in_progress">作業中</option>
            <option value="completed">完了</option>
          </select>
        </label>
        <button
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          type="submit"
        >
          絞り込む
        </button>
      </form>

      {orders.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
          該当する陸送依頼がありません。
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-700" scope="col">
                    案件番号
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700" scope="col">
                    業者名
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700" scope="col">
                    移動パターン
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700" scope="col">
                    走行可否
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700" scope="col">
                    ステータス
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700" scope="col">
                    通知送信
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700" scope="col">
                    業者対応
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700" scope="col">
                    業者対応日時
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700" scope="col">
                    招待
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {orders.map((order) => {
                  const vendorResponseBadge = getVendorResponseBadge(order.vendorResponse);
                  const invitationResponseBadge = getInvitationResponseBadge(order.latestInvitationResponse);

                  return (
                    <tr key={order.transportOrderId}>
                      <td className="whitespace-nowrap px-4 py-4 font-medium">
                        <Link
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                          href={`/admin/transport-orders/${order.transportOrderId}`}
                        >
                          {order.orderNumber}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                        {order.vendorName ?? "-"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                        {getMovementTypeLabel(order.movementType)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-700">{order.canDrive ? "可" : "不可"}</span>
                          {order.towRequired ? (
                            <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                              レッカー要
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                          {order.statusName}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                        {formatDateTime(order.notificationSentAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        {vendorResponseBadge ? <Badge badge={vendorResponseBadge} /> : <span className="text-gray-700">-</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                        {formatDateTime(order.vendorResponseAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <div className="flex items-center gap-2">
                          <Badge badge={invitationResponseBadge} />
                          {order.latestInvitationIsWinningBid ? (
                            <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                              先着受注
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
