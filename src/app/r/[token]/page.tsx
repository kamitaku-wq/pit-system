import { loadTokenStatusAction } from './actions';
import { ConfirmForm } from './confirm-form';

export const dynamic = 'force-dynamic';

// Phase 64-A.23 顧客 facing skeleton (GET safe):
// - 本 page は loadTokenStatusAction のみ呼ぶ (token を consume しない)
// - unfurl/prefetch/email scanner が GET しても token は焼けない (RFC 7231 GET safe 準拠)
// - 「予約を表示する」button を押した時のみ ConfirmForm の Server Action が
//   verifyAndConsumeTokenViaServiceRole を呼んで consume + 監査ログ INSERT

export default async function CustomerReservationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const status = await loadTokenStatusAction(token);

  if (!status.ok) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-2xl font-bold text-red-600">
          {status.reason === 'not_found' && 'リンクが見つかりません'}
          {status.reason === 'expired' && '有効期限が切れています'}
          {status.reason === 'used' && 'このリンクは既に使用されています'}
          {status.reason === 'revoked' && 'リンクが無効化されました'}
        </h1>
        <p className="mt-4 text-gray-700">
          発行元の店舗にお問い合わせください。
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold">予約確認リンク</h1>
      <p className="mt-4 text-gray-700">
        ご予約内容をご確認いただけます。下のボタンを押すとリンクが消費され、予約内容が表示されます。
      </p>
      <ConfirmForm token={token} />
    </main>
  );
}
