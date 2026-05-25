import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const statistics = [
  { title: "本日の予約", value: "12件", detail: "午前 5件 / 午後 7件" },
  { title: "稼働ピット", value: "4/6", detail: "通常運用" },
  { title: "未確認通知", value: "3件", detail: "確認待ち" },
] as const;

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-normal">Dashboard</h2>
        <p className="text-sm text-gray-600">予約状況と運用指標の概要</p>
      </div>
      <section className="grid gap-4 md:grid-cols-3" aria-label="統計">
        {statistics.map((statistic) => (
          <Card key={statistic.title}>
            <CardHeader>
              <CardTitle>{statistic.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{statistic.value}</p>
              <p className="mt-2 text-sm text-gray-600">{statistic.detail}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
