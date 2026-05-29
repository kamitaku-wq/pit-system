import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReservationWizard } from "@/app/r/reserve/[companyId]/reservation-wizard";

// 実 Cloudflare Turnstile script は jsdom で動かないため widget を mock し、mount 時に即トークンを供給する。
// これにより「確認コードを送信」ボタンの token ゲートが満たされ、送信ボディに turnstileToken が乗る。
// remount (再送時の key bump) ごとに新しいトークンが供給される。
vi.mock("@/components/forms/turnstile-widget", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return {
    TurnstileWidget: ({ onVerify }: { onVerify: (token: string) => void }) => {
      react.useEffect(() => {
        onVerify("test-turnstile-token");
      }, [onVerify]);
      return null;
    },
  };
});

// Phase 64-A.31b-2 / A.32b: wizard が
//   (1) 「選択した枠の laneId を verbatim に POST する」(A.31b-2 不変条件) を click 経由で固定し、
//   (2) step6 メール認証 → step7 コード入力 → POST /reservations (code 同送) の本人確認フロー (A.32b) と、
//       slot_unavailable / verification_failed の回復遷移を固定する。
//
// 弁別の要 (advisor #5 由来): 同一 startAt/endAt・異なる laneId の枠を 2 件返し、**2番目** を選ぶ。
// 1 件だけ返すテストでは「先頭固定」「時刻 dedup」のバグを検出できない (slot と assertion が同値に辿る)。
// endAt は 37 分窓 (非丸め) にして「endAt が menu.durationMinutes=60 から再導出されていない」ことも保証。

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

describe("ReservationWizard flow (Phase 64-A.31b-2 / A.32b)", () => {
  let capturedBody: Record<string, unknown> | null = null;
  let codeRequestBody: Record<string, unknown> | null = null;
  let codeRequestCount = 0;
  // POST /reservations / /verification-code のレスポンスをテストごとに差し替え可能にする。
  let reservationsResponder: () => Response;
  let verificationCodeResponder: () => Response;

  beforeEach(() => {
    capturedBody = null;
    codeRequestBody = null;
    codeRequestCount = 0;
    reservationsResponder = () => jsonResponse({ ok: true, reservationId: "resv-123" }, 201);
    verificationCodeResponder = () => jsonResponse({ ok: true }, 200);
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
      if (url.includes("/verification-code")) {
        codeRequestCount += 1;
        codeRequestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return verificationCodeResponder();
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

  function renderWizard() {
    render(
      <ReservationWizard
        companyId="comp-1"
        stores={[{ id: "store-1", name: "本店", address: null, phone: null }]}
      />,
    );
  }

  // step1→step5 まで進める共通操作 (2番目の枠 = lane-B を選ぶ)。email は必須なので必ず入力する。
  async function advanceToStep5(email = "taro@example.test") {
    fireEvent.click(screen.getByRole("button", { name: /本店/ }));
    fireEvent.click(await screen.findByRole("button", { name: /オイル交換/ }));
    fireEvent.change(screen.getByLabelText("日付"), { target: { value: "2026-06-01" } });
    const slotButtons = await screen.findAllByRole("button", {
      name: expectedSlotLabel(SLOT_A),
    });
    expect(slotButtons).toHaveLength(2);
    const secondSlot = slotButtons[1];
    if (!secondSlot) throw new Error("expected a second slot button");
    fireEvent.click(secondSlot); // lane-B

    // step4: 顧客情報 (氏名 + email 必須)
    fireEvent.change(screen.getByRole("textbox", { name: /お名前/ }), {
      target: { value: "山田太郎" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /メールアドレス/ }), {
      target: { value: email },
    });
    fireEvent.click(screen.getByRole("button", { name: "次へ" })); // step4 → step5
  }

  it("requires email before leaving step4 (HTML5 native validation blocks submit)", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /本店/ }));
    fireEvent.click(await screen.findByRole("button", { name: /オイル交換/ }));
    fireEvent.change(screen.getByLabelText("日付"), { target: { value: "2026-06-01" } });
    const slotButtons = await screen.findAllByRole("button", {
      name: expectedSlotLabel(SLOT_A),
    });
    fireEvent.click(slotButtons[0]!);

    // 名前のみ・email 空で「次へ」を押すと required + type="email" のネイティブ検証が submit を
    // ブロックし、step5 へ進まないこと (車両・備考の見出しが出ない / step4 のままメール欄が残る)。
    fireEvent.change(screen.getByRole("textbox", { name: /お名前/ }), {
      target: { value: "山田太郎" },
    });
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.queryByText("車両情報・備考")).toBeNull();
    expect(screen.getByRole("textbox", { name: /メールアドレス/ })).toBeTruthy();
  });

  it("sends a verification code then submits laneId/startAt/endAt/code verbatim", async () => {
    renderWizard();
    await advanceToStep5();

    // step5: 車両・備考 → 次へ → step6
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));

    // step6: メール認証 → 確認コードを送信 → step7
    fireEvent.click(await screen.findByRole("button", { name: "確認コードを送信" }));
    const codeInput = await screen.findByRole("textbox", { name: /確認コード/ });
    expect(codeRequestCount).toBe(1);
    expect(codeRequestBody?.email).toBe("taro@example.test");
    // Turnstile トークンが verification-code 送信ボディに同送されること (A.33)。
    expect(codeRequestBody?.turnstileToken).toBe("test-turnstile-token");

    // step7: コード入力 → 予約を確定する
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "予約を確定する" }));

    await screen.findByText(/ご予約を受け付けました/);

    expect(capturedBody).not.toBeNull();
    expect(capturedBody?.laneId).toBe("lane-B"); // 2番目の枠 (先頭固定/dedup バグ検出)
    expect(capturedBody?.startAt).toBe("2026-06-01T01:00:00.000Z");
    expect(capturedBody?.endAt).toBe("2026-06-01T01:37:00.000Z"); // 60 分へ再計算していない
    expect(capturedBody?.storeId).toBe("store-1");
    expect(capturedBody?.workMenuId).toBe("menu-1");
    expect(capturedBody?.code).toBe("123456");
    expect((capturedBody?.customer as { fullName: string }).fullName).toBe("山田太郎");
    expect((capturedBody?.customer as { email: string }).email).toBe("taro@example.test");
  });

  it("only accepts digits in the code field", async () => {
    renderWizard();
    await advanceToStep5();
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(await screen.findByRole("button", { name: "確認コードを送信" }));
    const codeInput = (await screen.findByRole("textbox", {
      name: /確認コード/,
    })) as HTMLInputElement;
    // 非数字混じりを入れても数字のみ残る (フォーマット揺れを POST 前に正規化)。
    fireEvent.change(codeInput, { target: { value: "1a2b3c4d5e6f" } });
    expect(codeInput.value).toBe("123456");
  });

  it("on verification_failed (422) stays on the code step with a unified message", async () => {
    reservationsResponder = () => jsonResponse({ ok: false, reason: "verification_failed" }, 422);
    renderWizard();
    await advanceToStep5();
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(await screen.findByRole("button", { name: "確認コードを送信" }));
    const codeInput = await screen.findByRole("textbox", { name: /確認コード/ });
    fireEvent.change(codeInput, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "予約を確定する" }));

    await screen.findByText(/認証コードが正しくない/);
    // step7 に留まり (コード入力欄が残る)、再入力/再送が可能なこと。
    expect(screen.getByRole("textbox", { name: /確認コード/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "コードを再送" })).toBeTruthy();
  });

  it("on 409 slot_unavailable, returns to the slot step with a matching message", async () => {
    // 確定時に枠が埋まっていた場合は空き枠選択へ戻す (回復可能 reason)。
    reservationsResponder = () => jsonResponse({ ok: false, reason: "slot_unavailable" }, 409);
    renderWizard();
    await advanceToStep5();
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(await screen.findByRole("button", { name: "確認コードを送信" }));
    const codeInput = await screen.findByRole("textbox", { name: /確認コード/ });
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "予約を確定する" }));

    // step3 (空き枠選択) へ戻り、文言が画面と一致していること。
    await screen.findByText(/別の空き枠をお選びください/);
    expect(screen.getByLabelText("日付")).toBeTruthy();
    // コード入力欄 (step7 専用) は消えていること = 行き止まりの no-op が残らない。
    expect(screen.queryByRole("textbox", { name: /確認コード/ })).toBeNull();
  });
});
