'use client';

import { useActionState } from 'react';
import {
  confirmAndConsumeReservationFormAction,
  type ConfirmReservationByTokenResult,
} from './actions';

const fmt = (d: Date) =>
  new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(d);

export function ConfirmForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<
    ConfirmReservationByTokenResult | null,
    FormData
  >(confirmAndConsumeReservationFormAction, null);

  if (state?.ok) {
    const { reservation } = state;
    return (
      <section className="mt-8">
        <h2 className="text-xl font-semibold">予約のご確認</h2>
        <dl className="mt-4 space-y-3 text-gray-800">
          <div className="flex justify-between border-b pb-2">
            <dt className="text-gray-500">予約 ID</dt>
            <dd className="font-mono text-sm">{reservation.id}</dd>
          </div>
          <div className="flex justify-between border-b pb-2">
            <dt className="text-gray-500">開始時刻</dt>
            <dd>{fmt(reservation.startAt)}</dd>
          </div>
          <div className="flex justify-between border-b pb-2">
            <dt className="text-gray-500">終了時刻</dt>
            <dd>{fmt(reservation.endAt)}</dd>
          </div>
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
