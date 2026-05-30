import { config as loadDotenv } from "dotenv";
import postgres from "postgres";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env", override: false });

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: DIRECT_URL or DATABASE_URL not set");
    process.exit(1);
  }
  const sql = postgres(url, { prepare: false });
  try {
    const [row] = await sql<{ id: string; name: string }[]>`
      INSERT INTO companies (name, code)
      VALUES ('D2 Smoke Co', 'D2-SMOKE')
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name
    `;
    console.log(JSON.stringify(row));
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
