import { describe, it, expect } from "vitest";
import {
  timeToMinutes,
  sumWorkingMinutesForDay,
  sumReservationMinutes,
  computeUtilizationRate,
  jstDayOfWeek,
  jstDayRange,
  aggregateStoreUtilization,
  type WorkingHourEntry,
} from "@/lib/services/pit-utilization";

describe("timeToMinutes", () => {
  it("parses HH:MM and HH:MM:SS, rejects garbage", () => {
    expect(timeToMinutes("09:00")).toBe(540);
    expect(timeToMinutes("18:30:00")).toBe(1110);
    expect(timeToMinutes("bad")).toBe(0);
  });
});

describe("sumWorkingMinutesForDay", () => {
  const wh: WorkingHourEntry[] = [
    { dayOfWeek: 1, startsAt: "09:00", endsAt: "12:00" }, // 180
    { dayOfWeek: 1, startsAt: "13:00", endsAt: "18:00" }, // 300
    { dayOfWeek: 2, startsAt: "09:00", endsAt: "17:00" }, // other day
    { dayOfWeek: 1, startsAt: "18:00", endsAt: "17:00" }, // invalid (end<=start) → 0
  ];
  it("sums matching-day entries and ignores other days / invalid spans", () => {
    expect(sumWorkingMinutesForDay(wh, 1)).toBe(480);
    expect(sumWorkingMinutesForDay(wh, 2)).toBe(480);
    expect(sumWorkingMinutesForDay(wh, 0)).toBe(0);
  });
});

describe("sumReservationMinutes", () => {
  it("sums positive durations, ignores non-positive", () => {
    const spans = [
      { startAt: new Date("2026-06-01T00:00:00Z"), endAt: new Date("2026-06-01T01:00:00Z") }, // 60
      { startAt: new Date("2026-06-01T02:00:00Z"), endAt: new Date("2026-06-01T02:30:00Z") }, // 30
      { startAt: new Date("2026-06-01T05:00:00Z"), endAt: new Date("2026-06-01T05:00:00Z") }, // 0
    ];
    expect(sumReservationMinutes(spans)).toBe(90);
  });
});

describe("computeUtilizationRate", () => {
  it("returns rounded percent and 0 when no availability", () => {
    expect(computeUtilizationRate(90, 480)).toBe(19);
    expect(computeUtilizationRate(240, 480)).toBe(50);
    expect(computeUtilizationRate(100, 0)).toBe(0);
  });
});

describe("jst helpers", () => {
  it("computes JST weekday and UTC day range", () => {
    expect(jstDayOfWeek("2026-06-01")).toBe(1); // Monday
    const { start, end } = jstDayRange("2026-06-01");
    expect(start.toISOString()).toBe("2026-05-31T15:00:00.000Z"); // 00:00 JST
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe("aggregateStoreUtilization", () => {
  const lane = (
    id: string,
    resMin: number,
  ): {
    laneId: string;
    capacity: number | null;
    workingHours: WorkingHourEntry[];
    reservations: { startAt: Date; endAt: Date }[];
  } => ({
    laneId: id,
    capacity: 1,
    workingHours: [{ dayOfWeek: 1, startsAt: "09:00", endsAt: "17:00" }], // 480
    reservations:
      resMin > 0
        ? [
            {
              startAt: new Date("2026-06-01T00:00:00Z"),
              endAt: new Date(Date.UTC(2026, 5, 1, 0, resMin)),
            },
          ]
        : [],
  });

  it("aggregates lanes into store utilization", () => {
    const out = aggregateStoreUtilization({
      storeId: "s1",
      storeName: "渋谷店",
      dayOfWeek: 1,
      isHoliday: false,
      lanes: [lane("l1", 240), lane("l2", 0)],
      transferCount: 2,
      needsAttentionCount: 1,
    });
    expect(out.laneCount).toBe(2);
    expect(out.totalCapacity).toBe(2);
    expect(out.availableMinutes).toBe(960); // 480 * 2
    expect(out.reservedMinutes).toBe(240);
    expect(out.utilizationRate).toBe(25); // 240/960
    expect(out.reservationCount).toBe(1);
    expect(out.transferCount).toBe(2);
    expect(out.needsAttentionCount).toBe(1);
  });

  it("treats holiday as zero availability (rate 0)", () => {
    const out = aggregateStoreUtilization({
      storeId: "s1",
      storeName: "渋谷店",
      dayOfWeek: 1,
      isHoliday: true,
      lanes: [lane("l1", 240)],
    });
    expect(out.availableMinutes).toBe(0);
    expect(out.utilizationRate).toBe(0);
    expect(out.isHoliday).toBe(true);
  });
});
