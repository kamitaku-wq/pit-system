import { redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { getAdminDashboardMetrics } from "@/lib/services/transport-orders";

type DashboardCard = {
  title: "未確認業者依頼" | "対応不可" | "遅延案件";
  value: number;
  detail: string;
};

export default async function DashboardPage() {
  const adminUser = await getAdminUser();

  if (!adminUser) {
    redirect("/vendor/login?next=/admin/dashboard");
  }

  const metrics = await getAdminDashboardMetrics(db, adminUser.companyId);
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
    </div>
  );
}
