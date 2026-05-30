import { signInAction } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string | Array<string>;
    next?: string | Array<string>;
  }>;
};

const errorMessages: Record<string, string> = {
  invalid_credentials: "メールアドレスまたはパスワードが正しくありません。",
};

function getErrorMessage(error: string | Array<string> | undefined): string | null {
  const errorCode = Array.isArray(error) ? error[0] : error;

  if (!errorCode) {
    return null;
  }

  return errorMessages[errorCode] ?? "ログインに失敗しました。もう一度お試しください。";
}

// Phase 31-A 追補: middleware が付与する `?next=` を取り出し、open-redirect を弾く。
function safeNext(value: string | Array<string> | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export default async function VendorLoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  const errorMessage = getErrorMessage(resolvedSearchParams.error);
  const next = safeNext(resolvedSearchParams.next);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 text-gray-900">
      <section className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <p className="text-sm font-semibold text-gray-500">ピットマネ</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">業者ポータル ログイン</h1>
        </div>

        {errorMessage ? (
          <p className="mb-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}

        <form action={signInAction} className="space-y-5">
          {next ? <input type="hidden" name="next" value={next} /> : null}
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
            ログイン
          </button>
        </form>
      </section>
    </main>
  );
}
