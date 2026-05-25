"use client";

import type { EventInput } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const DUMMY_EVENTS: EventInput[] = [
  {
    title: "車検 - トヨタ アクア",
    start: "2026-05-20T10:00:00",
    end: "2026-05-20T12:00:00",
  },
  {
    title: "オイル交換 - ホンダ N-BOX",
    start: "2026-05-21T14:00:00",
    end: "2026-05-21T15:00:00",
  },
  {
    title: "タイヤ交換 - 日産 セレナ",
    start: "2026-05-22T09:30:00",
    end: "2026-05-22T10:30:00",
  },
  {
    title: "点検 - スバル フォレスター",
    start: "2026-05-23T13:00:00",
    end: "2026-05-23T14:30:00",
  },
];

export default function CalendarPage() {
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
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,timeGridDay",
            }}
            locale="ja"
            height="auto"
            events={DUMMY_EVENTS}
          />
        </CardContent>
      </Card>
    </div>
  );
}
