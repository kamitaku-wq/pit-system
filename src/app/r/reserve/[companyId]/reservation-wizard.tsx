"use client";

// Phase 64-A.31b-2: 顧客公開予約 multi-step wizard (step1-5)。
// ---------------------------------------------------------------------------
//
// step1 店舗 (server props) → step2 メニュー (GET /menus) → step3 空き日時 (GET /slots)
//   → step4 顧客情報 → step5 車両情報・備考 → POST /reservations。
//
// 本 wizard は A.31b-1 で構築・テスト済みの公開 API route を fetch で消費する薄い client:
//   cross-tenant / visible_to_customers / lane↔store / gate→create 同一 laneId の保証は
//   すべて service 層 (createPublicReservation) と route に集約され、wizard は入力収集と
//   選択値の受け渡しのみを担う。境界ロジックを wizard に再実装しないこと。
//
// 最重要 invariant: GET /slots が返した {startAt, endAt, laneId} を **verbatim** に POST body に
//   乗せる (buildReservationPayload に集約)。時刻を再フォーマットしたり menu.duration から
//   endAt を再導出してはならない。表示のみ Asia/Tokyo に整形する (送信値とは別)。
//
// 露出制約: 本 surface は A.33 (Turnstile + rate 制限) まで production 露出禁止 (A.31a 踏襲)。

import { useRef, useState } from "react";
import type { PublicStore } from "@/lib/services/customer-reservation-public";
import {
  buildReservationPayload,
  emptyCustomerForm,
  emptyVehicleForm,
  reasonIsSlotRecoverable,
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

const STEP_LABELS = ["店舗", "メニュー", "日時", "お客様情報", "車両・確認"];

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
    setStep(4);
  }

  async function submit() {
    if (!store || !menu || !slot) return;
    setSubmitting(true);
    setSubmitError(null);
    const payload = buildReservationPayload({ store, menu, slot, customer, vehicle, notes });
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
        setStep(6);
        return;
      }
      const reason = json.ok ? "unknown" : json.reason;
      setSubmitError(reasonToMessage(reason));
      // 空き枠の競合等は step3 へ戻れるよう slot をクリア (再取得を促す)。
      if (reasonIsSlotRecoverable(reason)) {
        setSlot(null);
      }
    } catch {
      setSubmitError(reasonToMessage("network_error"));
    } finally {
      setSubmitting(false);
    }
  }

  // step6: 完了画面。
  if (step === 6 && reservationId) {
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

      {/* step4: 顧客情報 */}
      {step === 4 ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(5);
          }}
        >
          <h2 className="text-lg font-semibold">お客様情報をご入力ください</h2>
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

      {/* step5: 車両情報・備考・送信 */}
      {step === 5 ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2 className="text-lg font-semibold">車両情報・備考</h2>
          <p className="text-sm text-gray-600">車両情報は任意です。分かる範囲でご入力ください。</p>
          {submitError ? <ErrorBanner message={submitError} /> : null}
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
            <button
              type="button"
              onClick={() => setStep(4)}
              className={backButtonClass}
              disabled={submitting}
            >
              戻る
            </button>
            <button type="submit" className={primaryButtonClass} disabled={submitting}>
              {submitting ? "送信中…" : "予約を確定する"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
