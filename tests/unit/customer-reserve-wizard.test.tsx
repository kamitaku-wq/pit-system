import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReservationWizard } from "@/app/r/reserve/[companyId]/reservation-wizard";

// Phase 64-A.31b-2: wizard が「選択した枠の laneId を verbatim に POST する」ことを click 経由で固定。
//
// 弁別の要 (advisor #5 由来): 同一 startAt/endAt・異なる laneId の枠を 2 件返し、**2番目** を選ぶ。
// 1 件だけ返すテストでは「先頭固定」「時刻 dedup」のバグを検出できない (slot と assertion が同値に辿る)。
// 集約値で gate して別 lane で create が最大の罠 (A.31b-1 §invariants)。

// endAt は 37 分窓 (非丸め) にして「endAt が menu.durationMinutes=60 から再導出されていない」
// ことを end-to-end でも独立に証明する (code-reviewer LOW 指摘の補強)。
const SLOT_A = {
  startAt: "2026-06-01T01:00:00.000Z",
  endAt: "2026-06-01T01:37:00.000Z",
  laneId: "lane-A",
};
const SLOT_B = {
  startAt: "2026-06-01T01:00:00.000Z",
  endAt: "2026-06-01T01:37:00.000Z",
  laneId: "lane-B",
};

// component と同一の整形でラベルを計算 (ICU 差異に依存しないため runtime と同じ formatter を使う)。
function expectedSlotLabel(slot: { startAt: string; endAt: string }): string {
  const tf = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });
  return `${tf.format(new Date(slot.startAt))} 〜 ${tf.format(new Date(slot.endAt))}`;
}

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as unknown as Response;
}

describe("ReservationWizard slot passthrough (Phase 64-A.31b-2)", () => {
  let capturedBody: Record<string, unknown> | null = null;
  // POST /reservations のレスポンスをテストごとに差し替え可能にする (成功 / 409 等)。
  let reservationsResponder: () => Response;

  beforeEach(() => {
    capturedBody = null;
    reservationsResponder = () => jsonResponse({ ok: true, reservationId: "resv-123" }, 201);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/menus")) {
        return jsonResponse({
          ok: true,
          menus: [{ id: "menu-1", name: "オイル交換", durationMinutes: 60, priceMinor: 0 }],
        });
      }
      if (url.includes("/slots")) {
        return jsonResponse({ ok: true, slots: [SLOT_A, SLOT_B] });
      }
      if (url.includes("/reservations")) {
        capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return reservationsResponder();
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("submits the second same-time slot's laneId/startAt/endAt verbatim", async () => {
    render(
      <ReservationWizard
        companyId="comp-1"
        stores={[{ id: "store-1", name: "本店", address: null, phone: null }]}
      />,
    );

    // step1: 店舗
    fireEvent.click(screen.getByRole("button", { name: /本店/ }));

    // step2: メニュー (GET /menus)
    fireEvent.click(await screen.findByRole("button", { name: /オイル交換/ }));

    // step3: 日付選択 → GET /slots。2 枠は表示が同一で laneId だけ異なる。
    fireEvent.change(screen.getByLabelText("日付"), { target: { value: "2026-06-01" } });
    const label = expectedSlotLabel(SLOT_A);
    const slotButtons = await screen.findAllByRole("button", { name: label });
    expect(slotButtons).toHaveLength(2);
    // 2番目 = lane-B。先頭固定/dedup バグならここで lane-A が混入する。
    const secondSlot = slotButtons[1];
    if (!secondSlot) throw new Error("expected a second slot button");
    fireEvent.click(secondSlot);

    // step4: 顧客情報 (氏名必須)
    fireEvent.change(screen.getByRole("textbox", { name: /お名前/ }), {
      target: { value: "山田太郎" },
    });
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));

    // step5: 確定
    fireEvent.click(screen.getByRole("button", { name: "予約を確定する" }));

    await screen.findByText(/ご予約を受け付けました/);

    expect(capturedBody).not.toBeNull();
    expect(capturedBody?.laneId).toBe("lane-B");
    expect(capturedBody?.startAt).toBe("2026-06-01T01:00:00.000Z");
    // 非丸めの 37 分窓: 60 分への再計算が起きていないことを保証。
    expect(capturedBody?.endAt).toBe("2026-06-01T01:37:00.000Z");
    expect(capturedBody?.storeId).toBe("store-1");
    expect(capturedBody?.workMenuId).toBe("menu-1");
    expect((capturedBody?.customer as { fullName: string }).fullName).toBe("山田太郎");
  });

  it("on 409 slot_unavailable, returns to slot step with a matching message (no dead button)", async () => {
    // 確定時に枠が埋まっていた場合、step5 に留めると「別の枠を」という文言と画面が食い違い、
    // 確定ボタンが無言で no-op する。回復可能 reason は step3 へ戻すこと (advisor 指摘の修正)。
    reservationsResponder = () => jsonResponse({ ok: false, reason: "slot_unavailable" }, 409);

    render(
      <ReservationWizard
        companyId="comp-1"
        stores={[{ id: "store-1", name: "本店", address: null, phone: null }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /本店/ }));
    fireEvent.click(await screen.findByRole("button", { name: /オイル交換/ }));
    fireEvent.change(screen.getByLabelText("日付"), { target: { value: "2026-06-01" } });
    const label = expectedSlotLabel(SLOT_A);
    const slotButtons = await screen.findAllByRole("button", { name: label });
    const firstSlot = slotButtons[0];
    if (!firstSlot) throw new Error("expected a slot button");
    fireEvent.click(firstSlot);

    fireEvent.change(screen.getByRole("textbox", { name: /お名前/ }), {
      target: { value: "山田太郎" },
    });
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: "予約を確定する" }));

    // step3 (空き枠選択) へ戻り、文言が画面と一致していること。
    await screen.findByText(/別の空き枠をお選びください/);
    expect(screen.getByLabelText("日付")).toBeTruthy();
    // 確定ボタン (step5 専用) は消えていること = 行き止まりの no-op ボタンが残らない。
    expect(screen.queryByRole("button", { name: "予約を確定する" })).toBeNull();
  });
});
