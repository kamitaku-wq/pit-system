import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import {
  getAdminDashboardMetrics,
  listTransportOrdersWithLatestInvitation,
  type TransportOrderListItem,
} from "@/lib/services/transport-orders";

type DashboardCard = {
  title: "未確認業者依頼" | "対応不可" | "遅延案件";
  value: number;
  detail: string;
};

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

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

function PriorityTable({
  title,
  orders,
  emptyMessage,
}: {
  title: string;
  orders: TransportOrderListItem[];
  emptyMessage: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
      </div>
      {orders.length === 0 ? (
        <div className="px-4 py-6 text-sm text-gray-600">{emptyMessage}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-left font-medium text-gray-700">
                  案件番号
                </th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-left font-medium text-gray-700">
                  業者名
                </th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-left font-medium text-gray-700">
                  通知送信
                </th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-left font-medium text-gray-700">
                  業者対応日時
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {orders.map((order) => (
                <tr key={order.transportOrderId}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium">
                    <Link
                      href={`/admin/transport-orders/${order.transportOrderId}`}
                      className="text-blue-600 hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{order.vendorName ?? "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                    {formatDateTime(order.notificationSentAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                    {formatDateTime(order.vendorResponseAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  const adminUser = await getAdminUser();

  if (!adminUser) {
    redirect("/vendor/login?next=/admin/dashboard");
  }

  const metrics = await getAdminDashboardMetrics(db, adminUser.companyId);
  const [pendingOrders, rejectedOrders, delayedOrders] = await Promise.all([
    listTransportOrdersWithLatestInvitation(db, adminUser.companyId, {
      vendorResponse: "pending",
      limit: 5,
    }),
    listTransportOrdersWithLatestInvitation(db, adminUser.companyId, {
      vendorResponse: "rejected",
      limit: 5,
    }),
    listTransportOrdersWithLatestInvitation(db, adminUser.companyId, {
      delayedOnly: true,
      limit: 5,
    }),
  ]);
  const dashboardCards: DashboardCard[] = [
    {
      title: "未確認業者依頼",
      value: metrics.pendingVendorResponseCount,
      detail: "業者の回答待ち",
    },
    {
      title: "対応不可",
      value: metrics.rejectedVendorResponseCount,
      detail: "業者が対応不可と回答",
    },
    {
      title: "遅延案件",
      value: metrics.delayedNotificationCount,
      detail: "通知後24時間以上未回答",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-normal">Dashboard</h2>
        <p className="text-sm text-gray-600">業者対応状況と遅延案件の概要</p>
      </div>
      <section className="grid gap-4 md:grid-cols-3" aria-label="統計">
        {dashboardCards.map((card) => (
          <Card key={card.title}>
            <CardHeader>
              <CardTitle>{card.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{card.value}件</p>
              <p className="mt-2 text-sm text-gray-600">{card.detail}</p>
            </CardContent>
          </Card>
        ))}
      </section>
      <section className="flex flex-col gap-4" aria-label="業務優先タスク">
        <h3 className="text-lg font-semibold tracking-normal">業務優先タスク</h3>
        <div className="grid gap-4">
          <PriorityTable
            title="未確認業者依頼 (上位5件)"
            orders={pendingOrders}
            emptyMessage="未確認業者依頼はありません"
          />
          <PriorityTable
            title="対応不可 (上位5件)"
            orders={rejectedOrders}
            emptyMessage="対応不可の案件はありません"
          />
          <PriorityTable
            title="遅延案件 (上位5件)"
            orders={delayedOrders}
            emptyMessage="遅延案件はありません"
          />
        </div>
      </section>
    </div>
  );
}
