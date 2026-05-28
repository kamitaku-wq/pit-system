'use client';

import { useActionState } from 'react';
import {
  confirmAndConsumeReservationFormAction,
  type ConfirmReservationByTokenResult,
} from './actions';

const fmtDateTime = (d: Date) =>
  new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(d);

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b pb-2">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right">{value ?? '—'}</dd>
    </div>
  );
}

function vehicleDisplay(
  v: NonNullable<
    Extract<ConfirmReservationByTokenResult, { ok: true }>['detail']['vehicle']
  >,
): string {
  const parts = [v.maker, v.model].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  const makerModel = parts.length > 0 ? parts.join(' ') : '';
  const reg = v.registrationNumber ?? '';
  if (makerModel && reg) return `${makerModel} (${reg})`;
  if (makerModel) return makerModel;
  if (reg) return reg;
  return '—';
}

export function ConfirmForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<
    ConfirmReservationByTokenResult | null,
    FormData
  >(confirmAndConsumeReservationFormAction, null);

  if (state?.ok) {
    const { detail } = state;
    return (
      <section className="mt-8">
        <h2 className="text-xl font-semibold">予約のご確認</h2>
        <dl className="mt-4 space-y-3 text-gray-800">
          <Row
            label="開始時刻"
            value={fmtDateTime(detail.reservation.startAt)}
          />
          <Row label="終了時刻" value={fmtDateTime(detail.reservation.endAt)} />
          <Row
            label="店舗"
            value={detail.store ? detail.store.name : null}
          />
          <Row label="レーン" value={detail.lane ? detail.lane.name : null} />
          <Row
            label="メニュー"
            value={
              detail.workMenu
                ? `${detail.workMenu.name} (${detail.workMenu.durationMinutes}分)`
                : null
            }
          />
          <Row
            label="車両"
            value={detail.vehicle ? vehicleDisplay(detail.vehicle) : null}
          />
          <Row
            label="お名前"
            value={detail.customer ? detail.customer.fullName : null}
          />
          <Row
            label="ステータス"
            value={detail.status ? detail.status.name : null}
          />
          {detail.reservation.notes && (
            <div className="border-b pb-2">
              <dt className="text-gray-500">備考</dt>
              <dd className="mt-1 whitespace-pre-wrap text-gray-800">
                {detail.reservation.notes}
              </dd>
            </div>
          )}
        </dl>
        <p className="mt-6 text-sm text-gray-500">
          このリンクは一度限り有効です。再度ご確認が必要な場合は店舗にお問い合わせください。
        </p>
      </section>
    );
  }

  if (state && !state.ok) {
    return (
      <section className="mt-8">
        <h2 className="text-xl font-semibold text-red-600">
          {state.reason === 'not_found' && 'リンクが見つかりません'}
          {state.reason === 'expired' && '有効期限が切れています'}
          {state.reason === 'used' && 'このリンクは既に使用されています'}
          {state.reason === 'revoked' && 'リンクが無効化されました'}
        </h2>
        <p className="mt-4 text-gray-700">発行元の店舗にお問い合わせください。</p>
      </section>
    );
  }

  return (
    <form action={formAction} className="mt-8">
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-blue-600 px-6 py-3 text-white disabled:opacity-50"
      >
        {pending ? '確認中…' : '予約を表示する'}
      </button>
      <p className="mt-3 text-xs text-gray-500">
        ボタンを押すとリンクは消費されます (一度限り有効)。
      </p>
    </form>
  );
}
