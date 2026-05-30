import { config as loadEnv } from "dotenv";
import path from "node:path";
import { vi } from "vitest";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const missingEnv = (["DATABASE_URL", "DIRECT_URL"] as const).filter((name) => !process.env[name]);

if (missingEnv.length > 0) {
  console.warn(`[vitest] Integration tests skipped: missing ${missingEnv.join(", ")}.`);

  vi.mock("@/lib/db/client", () => ({
    db: new Proxy(
      {},
      {
        get() {
          throw new Error("Integration database client is unavailable because DB env is missing.");
        },
      },
    ),
  }));
}

// 本番 DB 汚染防止ガード (Phase 65)。
// integration test は TRUNCATE / INSERT / DELETE を本番相当の権限で実行するため、
// DATABASE_URL / DIRECT_URL が localhost (Supabase ローカルスタック) 以外を指していたら
// 即座に fail させる。過去に .env.local が本番を指した状態で `pnpm test:integration` が
// 走り、本番に test 由来の company 残骸が生まれた事故を再発させない。
// 意図的に remote へ向けたい場合のみ ALLOW_REMOTE_INTEGRATION_DB=1 で明示解除する。
const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function extractHost(connectionString: string | undefined): string | null {
  if (!connectionString) return null;
  try {
    return new URL(connectionString).hostname;
  } catch {
    // URL parse 不能な接続文字列は安全側に倒して「不明 = 非ローカル扱い」にする。
    return "(unparseable)";
  }
}

if (missingEnv.length === 0 && process.env.ALLOW_REMOTE_INTEGRATION_DB !== "1") {
  const offending = (["DATABASE_URL", "DIRECT_URL"] as const)
    .map((name) => ({ name, host: extractHost(process.env[name]) }))
    .filter(({ host }) => host !== null && !LOCAL_DB_HOSTS.has(host));

  if (offending.length > 0) {
    const detail = offending.map(({ name, host }) => `${name}=${host}`).join(", ");
    throw new Error(
      `[vitest] Integration tests refused: DB host is not local (${detail}). ` +
        `Integration tests TRUNCATE/INSERT/DELETE and would corrupt that database. ` +
        `Point DATABASE_URL/DIRECT_URL at the local Supabase stack (127.0.0.1), or set ` +
        `ALLOW_REMOTE_INTEGRATION_DB=1 to override intentionally.`,
    );
  }
}
