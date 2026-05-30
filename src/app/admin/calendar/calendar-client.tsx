"use client";

import type { EventInput } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";

// Phase 65: FullCalendar 描画部を client component として分離。
// 予約イベントは server component (page.tsx) が実 DB から取得し props で渡す。
export function CalendarClient({ events }: { events: EventInput[] }) {
  return (
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
      events={events}
    />
  );
}
