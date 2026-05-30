// Phase 65: Resend メール疎通の smoke 検証 (本番 .env.local 前提)。
//
// 目的: 「本番で実際にメールが送れるか」を Inngest / outbox に依存せず最短で確定する。
//   アプリの送信経路 (outbox-dispatcher) も最終的に `resend.emails.send` を呼ぶだけなので、
//   ここで API キー有効性 / from ドメイン認証 / sandbox 制約 (recipient restriction) を切り分ける。
//
// 使い方 (本番 RESEND_API_KEY / RESEND_FROM_EMAIL を持つ .env.local がある状態で):
//   pnpm tsx scripts/smoke-resend.ts                 # 既定宛先 kamitaku@funct.jp へ送信
//   pnpm tsx scripts/smoke-resend.ts you@example.com # 宛先を指定
//
// 破壊的操作ではない (メール 1 通送るのみ) ため確認フラグは設けないが、from / to / host を
// 送信前に表示する。Resend のエラーは原因解釈付きで表示する。

import { resolve } from "node:path";
import { config } from "dotenv";
import { Resend } from "resend";

const DEFAULT_TO = "kamitaku@funct.jp";

// Resend error name → 推定原因 (日本語)。outbox-dispatcher の RESEND_STATUS_BY_ERROR_NAME と整合。
const ERROR_HINTS: Record<string, string> = {
  missing_api_key: "RESEND_API_KEY が未設定/空。Vercel と .env.local の両方を確認。",
  invalid_api_Key: "RESEND_API_KEY が無効。Resend ダッシュボードで再発行。",
  invalid_from_address: "RESEND_FROM_EMAIL のドメインが未認証。Resend でドメイン認証 (DNS) を完了するか、検証用に onboarding@resend.dev を使う。",
  validation_error: "from ドメイン未認証の可能性が高い。Resend ダッシュボードで送信ドメインの verified 状態を確認。",
  rate_limit_exceeded: "送信レート上限。時間をおいて再試行。",
  not_found: "リソース不在 (from ドメイン/設定の指定ミス)。",
};

function loadEnvFiles(): void {
  config({ path: resolve(process.cwd(), ".env.local"), override: false });
  config({ path: resolve(process.cwd(), ".env"), override: false });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`smoke-resend: missing ${name}`);
    process.exit(1);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function describeError(error: unknown): string {
  if (!isRecord(error)) return String(error);
  const name = typeof error.name === "string" ? error.name : undefined;
  const message = typeof error.message === "string" ? error.message : JSON.stringify(error);
  const hint = name ? ERROR_HINTS[name] : undefined;
  return hint ? `${name}: ${message}\n  → ${hint}` : message;
}

async function main(): Promise<void> {
  loadEnvFiles();

  const apiKey = requireEnv("RESEND_API_KEY");
  const fromEmail = requireEnv("RESEND_FROM_EMAIL");
  const to = process.argv[2] ?? DEFAULT_TO;

  // from のドメイン部だけ表示 (キー本体は出さない)。
  const fromDomain = fromEmail.includes("@") ? fromEmail.split("@")[1] : fromEmail;
  console.log(`smoke-resend: from        = ${fromEmail}`);
  console.log(`smoke-resend: from domain = ${fromDomain}`);
  console.log(`smoke-resend: to          = ${to}`);
  console.log(`smoke-resend: api key     = ${apiKey.slice(0, 4)}…(${apiKey.length} chars)`);
  console.log("");

  const resend = new Resend(apiKey);

  const response = await resend.emails.send({
    from: fromEmail,
    to,
    subject: "【ピットマネ】Resend 疎通テスト",
    html:
      `<!doctype html><html lang="ja"><body style="font-family:sans-serif;line-height:1.6;color:#111827">` +
      `<p>これはピットマネ本番環境からの Resend 疎通テストメールです。</p>` +
      `<p>このメールが届いていれば、Resend の API キー・送信ドメイン認証・受信制約は正常です。</p>` +
      `</body></html>`,
    text: "ピットマネ本番環境からの Resend 疎通テストメールです。届いていれば送信経路は正常です。",
  });

  if (response.error) {
    console.error("smoke-resend: FAILED");
    console.error(describeError(response.error));
    process.exit(1);
  }

  console.log("smoke-resend: SENT");
  console.log(`  email id: ${response.data?.id ?? "(no id returned)"}`);
  console.log(`  → ${to} の受信トレイ (迷惑メールフォルダも) を確認してください。`);
}

main().catch((error: unknown) => {
  console.error("smoke-resend: unexpected error");
  console.error(error);
  process.exit(1);
});
