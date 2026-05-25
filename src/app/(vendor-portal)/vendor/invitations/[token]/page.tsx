import Link from 'next/link';
import { onboardSpotInvitationAction } from './onboard-action';

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await onboardSpotInvitationAction(token);

  if (!result.ok) {
    const code = result.code;

    if (code === 'INVITATION_TOKEN_INVALID') {
      return (
        <main className="mx-auto max-w-xl p-8">
          <h1 className="text-2xl font-bold text-red-600">招待が無効です</h1>
          <p className="mt-4">
            このリンクは無効か、有効期限が切れています。発行元にお問い合わせください。
          </p>
        </main>
      );
    }

    if (code === 'VENDOR_CROSS_TENANT') {
      return (
        <main className="mx-auto max-w-xl p-8">
          <h1 className="text-2xl font-bold text-red-600">このアカウントでは利用できません</h1>
          <p className="mt-4">
            別の取引先として既にご登録があります。発行元にお問い合わせください。
          </p>
        </main>
      );
    }

    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-2xl font-bold text-red-600">エラーが発生しました</h1>
        <p className="mt-4">{result.message}</p>
      </main>
    );
  }

  if (result.result.case === 'new') {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-2xl font-bold">招待を受け付けました</h1>
        <p className="mt-4">
          ご登録のメールアドレスに、ログイン用のリンクをお送りしました。メール内のリンクをクリックして、パスワードを設定してください。
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold">既にアカウントをお持ちです</h1>
      <p className="mt-4">ログインしてご利用ください。</p>
      <Link href="/vendor/login" className="mt-6 inline-block text-blue-600 underline">
        ログインへ
      </Link>
    </main>
  );
}
