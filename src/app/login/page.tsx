import { signInAction } from "@/app/(vendor-portal)/vendor/login/actions";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import { signInWithGoogleAction } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string | Array<string>;
    next?: string | Array<string>;
  }>;
};

const errorMessages: Record<string, string> = {
  domain_not_allowed:
    "このアカウントではログインできません。会社から付与された Google アカウントでお試しください。",
  user_disabled: "このアカウントは無効化されています。管理者にお問い合わせください。",
  oauth_failed: "Google との認証に失敗しました。もう一度お試しください。",
  missing_code: "Google との認証に失敗しました。もう一度お試しください。",
  server_error: "サーバーエラーが発生しました。しばらくしてからお試しください。",
  invalid_credentials: "メールアドレスまたはパスワードが正しくありません。",
};

function getErrorMessage(error: string | Array<string> | undefined): string | null {
  const code = Array.isArray(error) ? error[0] : error;
  if (!code) return null;
  return errorMessages[code] ?? "ログインに失敗しました。もう一度お試しください。";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolved = await searchParams;
  const errorMessage = getErrorMessage(resolved.error);
  const next = safeNextPath(
    Array.isArray(resolved.next) ? resolved.next[0] : resolved.next,
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 text-gray-900">
      <section className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <p className="text-sm font-semibold text-gray-500">ピットマネ</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">管理画面 ログイン</h1>
          <p className="mt-2 text-sm text-gray-600">社内スタッフは会社の Google アカウントでログインしてください。</p>
        </div>

        {errorMessage ? (
          <p className="mb-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}

        <form action={signInWithGoogleAction}>
          <input type="hidden" name="next" value={next} />
          <button
            className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50"
            type="submit"
          >
            Google でログイン
          </button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-gray-400">
          <span className="h-px flex-1 bg-gray-200" />
          または
          <span className="h-px flex-1 bg-gray-200" />
        </div>

        {/* パスワードログイン (初期管理者・移行期間用)。vendor の signInAction を next 付きで再利用。 */}
        <form action={signInAction} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="email">
              メールアドレス
            </label>
            <input
              autoComplete="email"
              className="mt-2 block h-11 w-full rounded-md border border-gray-300 px-3 text-sm outline-none transition-colors focus:border-gray-900 focus:ring-2 focus:ring-gray-200"
              id="email"
              name="email"
              required
              type="email"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="password">
              パスワード
            </label>
            <input
              autoComplete="current-password"
              className="mt-2 block h-11 w-full rounded-md border border-gray-300 px-3 text-sm outline-none transition-colors focus:border-gray-900 focus:ring-2 focus:ring-gray-200"
              id="password"
              name="password"
              required
              type="password"
            />
          </div>
          <button
            className="flex h-11 w-full items-center justify-center rounded-md bg-gray-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-gray-700"
            type="submit"
          >
            パスワードでログイン
          </button>
        </form>
      </section>
    </main>
  );
}
