"use client";

// Phase 64-A.31b-2 / A.32b: 顧客公開予約 multi-step wizard (step1-7)。
// ---------------------------------------------------------------------------
//
// step1 店舗 (server props) → step2 メニュー (GET /menus) → step3 空き日時 (GET /slots)
//   → step4 顧客情報 (email 必須) → step5 車両情報・備考 → step6 メール認証 (POST /verification-code で
//   コード送信) → step7 コード入力 (POST /reservations で verify+予約確定) → step8 完了画面。
//
// 本 wizard は A.31b/A.32b で構築・テスト済みの公開 API route を fetch で消費する薄い client:
//   cross-tenant / visible_to_customers / lane↔store / gate→create 同一 laneId / email 本人確認の
//   保証はすべて service 層 (createVerifiedPublicReservation / requestReservationVerificationCode) と
//   route に集約され、wizard は入力収集と選択値の受け渡しのみを担う。境界・検証ロジックを wizard に
//   再実装しないこと (特に code の検証や email binding はサーバが真実源)。
//
// 最重要 invariant: GET /slots が返した {startAt, endAt, laneId} を **verbatim** に POST body に
//   乗せる (buildReservationPayload に集約)。時刻を再フォーマットしたり menu.duration から
//   endAt を再導出してはならない。表示のみ Asia/Tokyo に整形する (送信値とは別)。
//
// 露出制約: 本 surface は A.33 (Turnstile + rate 制限) まで production 露出禁止 (A.31a 踏襲)。

import { useRef, useState } from "react";
import { TurnstileWidget } from "@/components/forms/turnstile-widget";
import type { PublicStore } from "@/lib/services/customer-reservation-public";
import {
  buildReservationPayload,
  emptyCustomerForm,
  emptyVehicleForm,
  reasonIsSlotRecoverable,
  reasonRequiresRestart,
  reasonToMessage,
  type CustomerForm,
  type PublicMenu,
  type PublicSlot,
  type VehicleForm,
} from "./reservation-payload";

interface ReservationWizardProps {
  companyId: string;
  stores: PublicStore[];
}

type FetchState = "idle" | "loading" | "error";

const STEP_LABELS = [
  "店舗",
  "メニュー",
  "日時",
  "お客様情報",
  "車両・備考",
  "メール認証",
  "コード入力",
];

// step4 の email 必須化に使う軽量チェック (厳密な検証は route の .email() に委譲。ここは UX 用の前段)。
function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && v.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// 表示専用の時刻整形 (Asia/Tokyo)。送信値 (slot の ISO) には一切影響しない。
const timeRangeFormatter = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tokyo",
});

function formatSlotTime(slot: PublicSlot): string {
  return `${timeRangeFormatter.format(new Date(slot.startAt))} 〜 ${timeRangeFormatter.format(
    new Date(slot.endAt),
  )}`;
}

// min 属性用に Asia/Tokyo の今日を YYYY-MM-DD で得る (en-CA は ISO 形式)。
function todayInTokyo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

const fieldClass =
  "rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const primaryButtonClass =
  "rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50";
const backButtonClass =
  "rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50";

function TextField({
  label,
  value,
  onChange,
  required = false,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
      <span className="flex items-center gap-2">
        {label}
        {required ? <span className="text-xs text-red-600">必須</span> : null}
      </span>
      <input
        className={fieldClass}
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {message}
    </div>
  );
}

function StepHeader({ step }: { step: number }) {
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {STEP_LABELS.map((label, index) => {
        const n = index + 1;
        const active = n === step;
        const done = n < step;
        return (
          <li
            key={label}
            className={[
              "rounded-full px-3 py-1 font-medium",
              active
                ? "bg-blue-600 text-white"
                : done
                  ? "bg-blue-100 text-blue-700"
                  : "bg-gray-100 text-gray-500",
            ].join(" ")}
          >
            {n}. {label}
          </li>
        );
      })}
    </ol>
  );
}

export function ReservationWizard({ companyId, stores }: ReservationWizardProps) {
  const [step, setStep] = useState(1);

  const [store, setStore] = useState<PublicStore | null>(null);

  const [menus, setMenus] = useState<PublicMenu[]>([]);
  const [menusState, setMenusState] = useState<FetchState>("idle");
  const [menu, setMenu] = useState<PublicMenu | null>(null);

  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [slotsState, setSlotsState] = useState<FetchState>("idle");
  const [slot, setSlot] = useState<PublicSlot | null>(null);

  const [customer, setCustomer] = useState<CustomerForm>(emptyCustomerForm);
  const [vehicle, setVehicle] = useState<VehicleForm>(emptyVehicleForm);
  const [notes, setNotes] = useState("");

  // step6/7: email 本人確認コード。code は step7 入力値、codeRequestState は送信状態、
  // codeSent は「一度でも送信に成功したか」(step7 の再送通知に使う)。
  const [code, setCode] = useState("");
  const [codeRequestState, setCodeRequestState] = useState<FetchState>("idle");
  const [codeSent, setCodeSent] = useState(false);

  // step6/7: Cloudflare Turnstile トークン (人間検証)。token は single-use のため送信ごとに
  // turnstileNonce を bump して widget を remount し再 challenge させる (key={turnstileNonce})。
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileNonce, setTurnstileNonce] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reservationId, setReservationId] = useState<string | null>(null);

  const basePath = `/r/reserve/${companyId}`;

  // fetch レース防護: 各非同期取得に世代番号を振り、最新世代のレスポンスだけを state に反映する。
  // 日付/店舗/メニューの連打で古いレスポンスが新しい slots/menus を上書きするのを防ぐ
  // (表示中の選択と submit される slot の食い違いを排除。code-reviewer/Codex 一致指摘の HIGH)。
  const menuReqGen = useRef(0);
  const slotReqGen = useRef(0);

  async function selectStore(next: PublicStore) {
    setStore(next);
    setSubmitError(null); // 直前 submit のエラー文をクリア (再選択で前進)。
    // 下流の選択をすべてリセット (店舗が変われば menu/slot は無効)。
    setMenu(null);
    setSlot(null);
    setSlots([]);
    setDate("");
    setStep(2);
    // in-flight の slots fetch を無効化 (店舗変更で旧結果を破棄)。
    slotReqGen.current += 1;
    const gen = (menuReqGen.current += 1);
    setMenusState("loading");
    try {
      const res = await fetch(`${basePath}/menus?storeId=${encodeURIComponent(next.id)}`);
      if (gen !== menuReqGen.current) return; // より新しい選択が進行中: 古いレスポンスは破棄。
      const json = (await res.json()) as
        | { ok: true; menus: PublicMenu[] }
        | { ok: false; reason: string };
      if (!res.ok || !json.ok) {
        setMenus([]);
        setMenusState("error");
        return;
      }
      setMenus(json.menus);
      setMenusState("idle");
    } catch {
      if (gen !== menuReqGen.current) return;
      setMenus([]);
      setMenusState("error");
    }
  }

  function selectMenu(next: PublicMenu) {
    setMenu(next);
    setSlot(null);
    setSlots([]);
    setDate("");
    // in-flight の slots fetch を無効化 (メニュー変更で旧結果を破棄)。
    slotReqGen.current += 1;
    setStep(3);
  }

  async function loadSlots(nextDate: string) {
    setDate(nextDate);
    setSlot(null);
    if (!store || !menu || nextDate === "") {
      slotReqGen.current += 1; // 進行中の取得を無効化。
      setSlots([]);
      setSlotsState("idle");
      return;
    }
    const gen = (slotReqGen.current += 1);
    setSlotsState("loading");
    try {
      const query = new URLSearchParams({
        storeId: store.id,
        workMenuId: menu.id,
        date: nextDate,
      });
      const res = await fetch(`${basePath}/slots?${query.toString()}`);
      if (gen !== slotReqGen.current) return; // より新しい date/選択が進行中: 古いレスポンスは破棄。
      const json = (await res.json()) as
        | { ok: true; slots: PublicSlot[] }
        | { ok: false; reason: string };
      if (!res.ok || !json.ok) {
        setSlots([]);
        setSlotsState("error");
        return;
      }
      setSlots(json.slots);
      setSlotsState("idle");
    } catch {
      if (gen !== slotReqGen.current) return;
      setSlots([]);
      setSlotsState("error");
    }
  }

  function selectSlot(next: PublicSlot) {
    // slot オブジェクトを丸ごと保持し、後段で startAt/endAt/laneId を verbatim に送る。
    setSlot(next);
    setSubmitError(null); // 直前 submit のエラー文をクリア (枠を選び直して前進)。
    setStep(4);
  }

  // step6/7: 確認コードを送信 (POST /verification-code)。step6 からは成功で step7 へ前進、
  // step7 からの再送は step7 に留まる (setStep(7) は no-op)。issue-state はサーバが汎用 200 を返すため、
  // 成否は「送信処理が完了したか」のみで判断する (rate_limited 等は区別されない)。
  async function sendCode(): Promise<void> {
    const email = customer.email.trim();
    if (!looksLikeEmail(email)) {
      // step4 で必須化済みだが、防御的に弾く。
      setCodeRequestState("error");
      return;
    }
    if (turnstileToken === "") {
      // Turnstile 未完了 (ボタンは disabled だが防御的に弾く)。
      setCodeRequestState("error");
      return;
    }
    setCodeRequestState("loading");
    setSubmitError(null);
    try {
      const res = await fetch(`${basePath}/verification-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      });
      const json = (await res.json()) as { ok: boolean };
      if (!res.ok || !json.ok) {
        setCodeRequestState("error");
        return;
      }
      setCodeRequestState("idle");
      setCodeSent(true);
      setStep(7);
    } catch {
      setCodeRequestState("error");
    } finally {
      // token は single-use (サーバ側 verify で消費済 or 失敗で無効)。送信ごとに必ず破棄し、
      // widget を remount して次回送信用の新トークンを取得させる。
      setTurnstileToken("");
      setTurnstileNonce((n) => n + 1);
    }
  }

  async function submit() {
    if (!store || !menu || !slot) return;
    setSubmitting(true);
    setSubmitError(null);
    const payload = buildReservationPayload({ store, menu, slot, customer, vehicle, notes, code });
    try {
      const res = await fetch(`${basePath}/reservations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as
        | { ok: true; reservationId: string }
        | { ok: false; reason: string };
      if (res.ok && json.ok) {
        setReservationId(json.reservationId);
        setStep(8);
        return;
      }
      const reason = json.ok ? "unknown" : json.reason;
      setSubmitError(reasonToMessage(reason));
      // エラー文と画面を一致させるため、回復可能性に応じて該当ステップへ戻す
      // (step7 に留めると確定ボタンが no-op し、文言と画面が食い違う場合がある)。
      if (reasonRequiresRestart(reason)) {
        // 店舗/メニュー/lane が無効化された → 最初からやり直す (本人確認もリセット)。
        setStore(null);
        setMenu(null);
        setMenus([]);
        setSlot(null);
        setSlots([]);
        setDate("");
        setCode("");
        setCodeSent(false);
        setStep(1);
      } else if (reasonIsSlotRecoverable(reason)) {
        // 空き枠の競合等 → 空き枠選択へ戻す。code は破棄し step6 で再送させる
        // (Design A によりコードはサーバ側で温存されるが、UI は再送経路に一本化して齟齬を防ぐ)。
        setSlot(null);
        setCode("");
        setCodeSent(false);
        setStep(3);
      }
      // verification_failed / status_not_seeded / invalid_body / network は step7 に留まり、
      // コード再入力 or 再送で回復可能 (verification_failed は restart/slot のどちらにも該当しない)。
    } catch {
      setSubmitError(reasonToMessage("network_error"));
    } finally {
      setSubmitting(false);
    }
  }

  // step8: 完了画面。
  if (step === 8 && reservationId) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-green-700">ご予約を受け付けました</h2>
        <p className="text-sm text-gray-700">
          予約番号: <span className="font-mono">{reservationId}</span>
        </p>
        <p className="text-sm text-gray-600">
          ご入力いただいた内容で予約を承りました。確認のご連絡をお待ちください。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <StepHeader step={step} />

      {/* submit エラーは top-level に表示 (回復可能性に応じ step1/3/5 へ戻すため、
          どのステップに着地しても文言が画面と一致するよう常時このスロットで描画)。 */}
      {submitError ? <ErrorBanner message={submitError} /> : null}

      {/* step1: 店舗選択 */}
      {step === 1 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">店舗をお選びください</h2>
          {stores.length === 0 ? (
            <p className="text-sm text-gray-600">現在ご予約いただける店舗がありません。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {stores.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => selectStore(s)}
                    className="w-full rounded-md border border-gray-200 bg-white p-4 text-left hover:border-blue-400 hover:bg-blue-50"
                  >
                    <span className="block text-sm font-medium text-gray-900">{s.name}</span>
                    {s.address ? (
                      <span className="block text-xs text-gray-500">{s.address}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* step2: メニュー選択 */}
      {step === 2 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">メニューをお選びください</h2>
          {menusState === "loading" ? (
            <p className="text-sm text-gray-600">読み込み中…</p>
          ) : menusState === "error" ? (
            <ErrorBanner message="メニューの取得に失敗しました。時間をおいて再度お試しください。" />
          ) : menus.length === 0 ? (
            <p className="text-sm text-gray-600">この店舗で予約可能なメニューがありません。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {menus.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => selectMenu(m)}
                    className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-white p-4 text-left hover:border-blue-400 hover:bg-blue-50"
                  >
                    <span className="text-sm font-medium text-gray-900">{m.name}</span>
                    <span className="text-xs text-gray-500">{m.durationMinutes}分</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-start">
            <button type="button" onClick={() => setStep(1)} className={backButtonClass}>
              戻る
            </button>
          </div>
        </div>
      ) : null}

      {/* step3: 空き日時 picker */}
      {step === 3 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">ご希望の日時をお選びください</h2>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            日付
            <input
              type="date"
              className={fieldClass}
              value={date}
              min={todayInTokyo()}
              onChange={(e) => loadSlots(e.target.value)}
            />
          </label>
          {slotsState === "loading" ? (
            <p className="text-sm text-gray-600">空き枠を確認中…</p>
          ) : slotsState === "error" ? (
            <ErrorBanner message="空き枠の取得に失敗しました。時間をおいて再度お試しください。" />
          ) : date === "" ? (
            <p className="text-sm text-gray-600">日付を選択すると空き枠が表示されます。</p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-gray-600">
              選択した日に空き枠がありません。別の日をお選びください。
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {slots.map((s) => (
                // key は laneId+startAt で複合 (同時刻・別 lane の枠が衝突しないように)。
                <li key={`${s.laneId}-${s.startAt}`}>
                  <button
                    type="button"
                    onClick={() => selectSlot(s)}
                    className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm hover:border-blue-400 hover:bg-blue-50"
                  >
                    {formatSlotTime(s)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-start">
            <button type="button" onClick={() => setStep(2)} className={backButtonClass}>
              戻る
            </button>
          </div>
        </div>
      ) : null}

      {/* step4: 顧客情報 (email 必須 = 後段の本人確認コード送信先)。氏名・email は HTML5 required +
          type="email" のネイティブ検証で空/不正形式を弾く (送信先確定のため必須)。サーバ側は
          publicCustomerSchema + verify が真の強制境界。 */}
      {step === 4 ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(5);
          }}
        >
          <h2 className="text-lg font-semibold">お客様情報をご入力ください</h2>
          <p className="text-sm text-gray-600">
            ご予約の確認のため、メールアドレス宛に認証コードをお送りします。
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="お名前"
              required
              value={customer.fullName}
              onChange={(v) => setCustomer((c) => ({ ...c, fullName: v }))}
            />
            <TextField
              label="フリガナ"
              value={customer.fullNameKana}
              onChange={(v) => setCustomer((c) => ({ ...c, fullNameKana: v }))}
            />
            <TextField
              label="メールアドレス"
              type="email"
              required
              value={customer.email}
              onChange={(v) => setCustomer((c) => ({ ...c, email: v }))}
            />
            <TextField
              label="電話番号"
              type="tel"
              value={customer.phone}
              onChange={(v) => setCustomer((c) => ({ ...c, phone: v }))}
            />
            <TextField
              label="郵便番号"
              value={customer.postalCode}
              onChange={(v) => setCustomer((c) => ({ ...c, postalCode: v }))}
            />
            <TextField
              label="住所"
              value={customer.address}
              onChange={(v) => setCustomer((c) => ({ ...c, address: v }))}
            />
          </div>
          <div className="flex justify-between gap-3">
            <button type="button" onClick={() => setStep(3)} className={backButtonClass}>
              戻る
            </button>
            <button type="submit" className={primaryButtonClass}>
              次へ
            </button>
          </div>
        </form>
      ) : null}

      {/* step5: 車両情報・備考 (→ step6 メール認証へ) */}
      {step === 5 ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(6);
          }}
        >
          <h2 className="text-lg font-semibold">車両情報・備考</h2>
          <p className="text-sm text-gray-600">車両情報は任意です。分かる範囲でご入力ください。</p>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="登録番号 (ナンバー)"
              value={vehicle.registrationNumber}
              onChange={(v) => setVehicle((x) => ({ ...x, registrationNumber: v }))}
            />
            <TextField
              label="車台番号 (VIN)"
              value={vehicle.vin}
              onChange={(v) => setVehicle((x) => ({ ...x, vin: v }))}
            />
            <TextField
              label="メーカー"
              value={vehicle.maker}
              onChange={(v) => setVehicle((x) => ({ ...x, maker: v }))}
            />
            <TextField
              label="車種"
              value={vehicle.model}
              onChange={(v) => setVehicle((x) => ({ ...x, model: v }))}
            />
            <TextField
              label="年式"
              type="number"
              value={vehicle.modelYear}
              onChange={(v) => setVehicle((x) => ({ ...x, modelYear: v }))}
            />
            <TextField
              label="色"
              value={vehicle.color}
              onChange={(v) => setVehicle((x) => ({ ...x, color: v }))}
            />
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            備考
            <textarea
              className={fieldClass}
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <div className="flex justify-between gap-3">
            <button type="button" onClick={() => setStep(4)} className={backButtonClass}>
              戻る
            </button>
            <button type="submit" className={primaryButtonClass}>
              次へ
            </button>
          </div>
        </form>
      ) : null}

      {/* step6: メール認証 (確認コードを送信) */}
      {step === 6 ? (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">メールアドレスの確認</h2>
          <p className="text-sm text-gray-700">
            下記のメールアドレス宛に確認コードをお送りします。よろしければ「確認コードを送信」を
            押してください。
          </p>
          <p className="rounded-md bg-gray-50 px-4 py-3 text-sm font-medium text-gray-900">
            {customer.email.trim()}
          </p>
          {codeRequestState === "error" ? (
            <ErrorBanner message="確認コードの送信に失敗しました。メールアドレスをご確認のうえ、再度お試しください。" />
          ) : null}
          <TurnstileWidget
            key={`turnstile-step6-${turnstileNonce}`}
            onVerify={setTurnstileToken}
            onExpire={() => setTurnstileToken("")}
            onError={() => setTurnstileToken("")}
          />
          <div className="flex justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep(5)}
              className={backButtonClass}
              disabled={codeRequestState === "loading"}
            >
              戻る
            </button>
            <button
              type="button"
              onClick={() => void sendCode()}
              className={primaryButtonClass}
              disabled={codeRequestState === "loading" || turnstileToken === ""}
            >
              {codeRequestState === "loading" ? "送信中…" : "確認コードを送信"}
            </button>
          </div>
        </div>
      ) : null}

      {/* step7: コード入力 (verify + 予約確定) */}
      {step === 7 ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2 className="text-lg font-semibold">確認コードのご入力</h2>
          <p className="text-sm text-gray-700">
            {customer.email.trim()} 宛にお送りした確認コードをご入力ください。
          </p>
          {codeSent ? <p className="text-sm text-green-700">確認コードを送信しました。</p> : null}
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            <span className="flex items-center gap-2">
              確認コード
              <span className="text-xs text-red-600">必須</span>
            </span>
            <input
              className={`${fieldClass} tracking-[0.4em]`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              required
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          {/* 再送には新しい Turnstile トークンが要る (前回トークンは送信で消費済)。 */}
          <TurnstileWidget
            key={`turnstile-step7-${turnstileNonce}`}
            onVerify={setTurnstileToken}
            onExpire={() => setTurnstileToken("")}
            onError={() => setTurnstileToken("")}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep(6)}
              className={backButtonClass}
              disabled={submitting || codeRequestState === "loading"}
            >
              戻る
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => void sendCode()}
                className={backButtonClass}
                disabled={submitting || codeRequestState === "loading" || turnstileToken === ""}
              >
                {codeRequestState === "loading" ? "再送中…" : "コードを再送"}
              </button>
              <button
                type="submit"
                className={primaryButtonClass}
                disabled={submitting || code.trim().length === 0}
              >
                {submitting ? "送信中…" : "予約を確定する"}
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
}
