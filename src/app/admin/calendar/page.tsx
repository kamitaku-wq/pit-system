import type { EventInput } from "@fullcalendar/core";
import { redirect } from "next/navigation";

import { getAdminUser } from "@/lib/auth/admin-role";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db/client";
import { listReservationCalendarEvents } from "@/lib/services/calendar-events";
import { CalendarClient } from "./calendar-client";

// Phase 65 (Sprint β-1): DUMMY_EVENTS を実 reservations 接続に置換。
// server component で予約イベントを取得し、client の FullCalendar (CalendarClient) に渡す。
export default async function CalendarPage() {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    redirect("/vendor/login?next=/admin/calendar");
  }

  // db = service_role (RLS bypass)。calendar service が join 内で company を縛る (A.24)。
  const events = await listReservationCalendarEvents(db, {
    companyId: adminUser.companyId,
  });
  const fcEvents: EventInput[] = events.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-normal">カレンダー</h2>
        <p className="text-sm text-gray-600">整備予約とピット作業予定を確認できます。</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>スケジュール</CardTitle>
        </CardHeader>
        <CardContent>
          <CalendarClient events={fcEvents} />
        </CardContent>
      </Card>
    </div>
  );
}
