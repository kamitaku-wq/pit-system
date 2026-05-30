import { and, asc, eq, gte, isNull, lte, type SQL } from "drizzle-orm";
import { z } from "zod";
import { customers } from "@/lib/db/schema/customers";
import { reservations } from "@/lib/db/schema/reservations";
import { vehicles } from "@/lib/db/schema/vehicles";

// Phase 65 (Sprint β-1): admin 予約カレンダーの実データ取得 service。
// src/app/admin/calendar/page.tsx の DUMMY_EVENTS を置換する。
// reservations を customer / vehicle と join し、FullCalendar の EventInput 互換 DTO で返す。
//
// 設計 (ADR-0011 A.24 canonical = service_role 経由 read-only join + cross-tenant filter in joins):
//   - 各 leftJoin 条件に `AND <rel>.company_id = reservations.company_id` を明示する
//     (service_role は RLS bypass、FK は同 company を保証しないため join 自体で company を縛る)。
//   - deleted_at IS NULL + companyId scope。日時範囲 (from/to) は optional。
//   - read-only。閲覧監査は残さない (A.24 と同方針)。

export interface CalendarEventDto {
  id: string;
  title: string;
  start: string; // ISO 8601 (FullCalendar EventInput.start 互換)
  end: string; // ISO 8601
}

const CalendarEventsQuery = z
  .object({
    companyId: z.string().uuid(),
    from: z.date().optional(),
    to: z.date().optional(),
  })
  .strict();

export type CalendarEventsQueryInput = z.input<typeof CalendarEventsQuery>;

// 予約の表示タイトル: 顧客名 / 車番 (なければ メーカー+車種、いずれも無ければ "予約")。
function buildTitle(
  customerName: string | null,
  registrationNumber: string | null,
  maker: string | null,
  model: string | null,
): string {
  const parts: string[] = [];
  if (customerName && customerName.trim().length > 0) {
    parts.push(customerName.trim());
  }
  const vehicleLabel =
    (registrationNumber && registrationNumber.trim().length > 0 && registrationNumber.trim()) ||
    [maker, model].filter((v): v is string => Boolean(v && v.trim().length > 0)).join(" ") ||
    null;
  if (vehicleLabel) {
    parts.push(vehicleLabel);
  }
  return parts.length > 0 ? parts.join(" / ") : "予約";
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function listReservationCalendarEvents(
  // Drizzle does not export a common interface covering both DB and PgTransaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: any,
  rawQuery: unknown,
): Promise<CalendarEventDto[]> {
  const query = CalendarEventsQuery.parse(rawQuery);

  const conditions: SQL[] = [
    eq(reservations.companyId, query.companyId),
    isNull(reservations.deletedAt),
  ];
  if (query.from) {
    conditions.push(gte(reservations.startAt, query.from));
  }
  if (query.to) {
    conditions.push(lte(reservations.startAt, query.to));
  }

  const rows = await database
    .select({
      id: reservations.id,
      startAt: reservations.startAt,
      endAt: reservations.endAt,
      customerName: customers.fullName,
      registrationNumber: vehicles.registrationNumber,
      maker: vehicles.maker,
      model: vehicles.model,
    })
    .from(reservations)
    // cross-tenant filter in joins (A.24): FK は同 company を保証しないため join で company を縛る。
    .leftJoin(
      customers,
      and(
        eq(customers.id, reservations.customerId),
        eq(customers.companyId, reservations.companyId),
      ),
    )
    .leftJoin(
      vehicles,
      and(eq(vehicles.id, reservations.vehicleId), eq(vehicles.companyId, reservations.companyId)),
    )
    .where(and(...conditions))
    .orderBy(asc(reservations.startAt));

  return rows.map(
    (row: {
      id: string;
      startAt: Date | string;
      endAt: Date | string;
      customerName: string | null;
      registrationNumber: string | null;
      maker: string | null;
      model: string | null;
    }): CalendarEventDto => ({
      id: row.id,
      title: buildTitle(row.customerName, row.registrationNumber, row.maker, row.model),
      start: toIso(row.startAt),
      end: toIso(row.endAt),
    }),
  );
}
