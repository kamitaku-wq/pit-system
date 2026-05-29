import { describe, expect, it } from "vitest";
import {
  buildReservationPayload,
  cleanCustomer,
  cleanVehicle,
  emptyCustomerForm,
  emptyVehicleForm,
  reasonIsSlotRecoverable,
  reasonRequiresRestart,
  reasonToMessage,
  type PublicSlot,
} from "@/app/r/reserve/[companyId]/reservation-payload";

// Phase 64-A.31b-2: POST body 組み立ての純ロジックを単体で固定する。
// 最重要 = gate→create 同一 laneId/時刻 invariant: slot の値を verbatim に乗せ再計算しないこと。
describe("buildReservationPayload (Phase 64-A.31b-2)", () => {
  // 時刻は menu.duration から導出すると 60 分窓になるような値をあえて避け、
  // endAt が再計算されていないことを sentinel で検出する (01:00→01:37 の 37 分窓)。
  const slot: PublicSlot = {
    startAt: "2026-06-01T01:00:00.000Z",
    endAt: "2026-06-01T01:37:00.000Z",
    laneId: "lane-SENTINEL",
  };

  it("carries slot {startAt,endAt,laneId} verbatim (no recompute)", () => {
    const payload = buildReservationPayload({
      store: { id: "store-1" },
      menu: { id: "menu-1" },
      slot,
      customer: { ...emptyCustomerForm, fullName: "山田太郎" },
      vehicle: emptyVehicleForm,
      notes: "",
      code: "123456",
    });

    expect(payload.laneId).toBe("lane-SENTINEL");
    expect(payload.startAt).toBe("2026-06-01T01:00:00.000Z");
    expect(payload.endAt).toBe("2026-06-01T01:37:00.000Z");
    expect(payload.storeId).toBe("store-1");
    expect(payload.workMenuId).toBe("menu-1");
    // 参照ではなく値として slot を踏襲していること (同一文字列)。
    expect(payload.startAt).toBe(slot.startAt);
    expect(payload.endAt).toBe(slot.endAt);
    expect(payload.laneId).toBe(slot.laneId);
  });

  it("carries the 6-digit verification code (trimmed) on the wire (Phase 64-A.32b)", () => {
    const payload = buildReservationPayload({
      store: { id: "store-1" },
      menu: { id: "menu-1" },
      slot,
      customer: { ...emptyCustomerForm, fullName: "山田太郎", email: "taro@example.test" },
      vehicle: emptyVehicleForm,
      notes: "",
      code: "  654321  ",
    });
    expect(payload.code).toBe("654321");
    const wire = JSON.parse(JSON.stringify(payload)) as { code?: unknown };
    expect(wire.code).toBe("654321");
  });

  it("trims required fullName and omits empty optional customer fields on the wire", () => {
    const payload = buildReservationPayload({
      store: { id: "store-1" },
      menu: { id: "menu-1" },
      slot,
      customer: { ...emptyCustomerForm, fullName: "  山田太郎  ", email: "" },
      vehicle: emptyVehicleForm,
      notes: "",
      code: "123456",
    });
    expect(payload.customer.fullName).toBe("山田太郎");
    expect(payload.customer.email).toBeUndefined();
    // 空 optional は JSON.stringify で wire から消えること (email:"" を送ると .email() が落ちる)。
    const wire = JSON.parse(JSON.stringify(payload)) as { customer: Record<string, unknown> };
    expect("email" in wire.customer).toBe(false);
    expect("phone" in wire.customer).toBe(false);
  });

  it("omits empty notes on the wire", () => {
    const payload = buildReservationPayload({
      store: { id: "store-1" },
      menu: { id: "menu-1" },
      slot,
      customer: { ...emptyCustomerForm, fullName: "山田太郎" },
      vehicle: emptyVehicleForm,
      notes: "   ",
      code: "123456",
    });
    expect(payload.notes).toBeUndefined();
    const wire = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    expect("notes" in wire).toBe(false);
  });
});

describe("cleanCustomer / cleanVehicle (Phase 64-A.31b-2)", () => {
  it("drops empty strings to undefined", () => {
    const c = cleanCustomer({
      fullName: "山田",
      fullNameKana: "ヤマダ",
      email: "  ",
      phone: "090-0000-0000",
      postalCode: "",
      address: "",
    });
    expect(c.fullNameKana).toBe("ヤマダ");
    expect(c.phone).toBe("090-0000-0000");
    expect(c.email).toBeUndefined();
    expect(c.postalCode).toBeUndefined();
  });

  it("parses modelYear to integer or omits invalid/empty", () => {
    expect(cleanVehicle({ ...emptyVehicleForm, modelYear: "2020" }).modelYear).toBe(2020);
    expect(cleanVehicle({ ...emptyVehicleForm, modelYear: "" }).modelYear).toBeUndefined();
    expect(cleanVehicle({ ...emptyVehicleForm, modelYear: "abc" }).modelYear).toBeUndefined();
    expect(cleanVehicle({ ...emptyVehicleForm, modelYear: "20.5" }).modelYear).toBeUndefined();
  });
});

describe("reason mapping (Phase 64-A.31b-2)", () => {
  it("maps known reasons to JP and falls back for unknown", () => {
    expect(reasonToMessage("slot_unavailable")).toContain("別の空き枠");
    expect(reasonToMessage("status_not_seeded")).toContain("店舗にお問い合わせ");
    expect(reasonToMessage("totally_unknown_reason")).toContain("エラー");
  });

  it("maps verification_failed to a unified code message (Phase 64-A.32b oracle)", () => {
    const msg = reasonToMessage("verification_failed");
    expect(msg).toContain("認証コード");
    // verify は step7 留まり (再入力/再送で回復) のため restart/slot のどちらにも該当しないこと。
    expect(reasonRequiresRestart("verification_failed")).toBe(false);
    expect(reasonIsSlotRecoverable("verification_failed")).toBe(false);
  });

  it("flags only availability reasons as slot-recoverable", () => {
    expect(reasonIsSlotRecoverable("slot_unavailable")).toBe(true);
    expect(reasonIsSlotRecoverable("outside_business_hours")).toBe(true);
    expect(reasonIsSlotRecoverable("store_not_found")).toBe(false);
    expect(reasonIsSlotRecoverable("status_not_seeded")).toBe(false);
  });

  it("flags only boundary not_found reasons as restart-required (disjoint from recoverable)", () => {
    expect(reasonRequiresRestart("store_not_found")).toBe(true);
    expect(reasonRequiresRestart("work_menu_not_found")).toBe(true);
    expect(reasonRequiresRestart("lane_not_found")).toBe(true);
    expect(reasonRequiresRestart("company_not_found")).toBe(true);
    expect(reasonRequiresRestart("slot_unavailable")).toBe(false);
    expect(reasonRequiresRestart("status_not_seeded")).toBe(false);
    // restart と slot-recoverable は互いに排他であること。
    for (const r of ["store_not_found", "slot_unavailable", "status_not_seeded"]) {
      expect(reasonRequiresRestart(r) && reasonIsSlotRecoverable(r)).toBe(false);
    }
  });
});
