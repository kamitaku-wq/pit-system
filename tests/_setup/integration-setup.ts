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
