# Phase E-1: tenant-isolation.test.ts (vitest)

## ゴール

`tests/integration/tenant-isolation.test.ts` を新規作成。PoC #6 verify.sql の 5 assertion を alpha-1 public schema 用に移植。RLS 漏洩 0 を vitest で検証 (Sprint α-1 DoD)。

## 既存テストパターン

`tests/integration/record-audit-log.test.ts` (E-2 で作成済) と同じ:
- `import postgres from 'postgres'` (raw connection)
- `prepare: false` + `DIRECT_URL`
- `sql.begin(async (tx) => { ... throw __rollback__ })` 各テスト完結

## fixture 設計

2 companies + 2 admin users + 1 vendor + 1 vendor_user で:
- Company A admin (auth.uid=A) → Vendor A のみ見える
- Company B admin (auth.uid=B) → Vendor A 見えない
- Vendor user (auth.uid=V) → vendors 0 件 (vendor_id 一致しないため)
- anon → 0 件 (RLS が全 block)

## PoC #6 verify.sql からの 5 assertion 移植

1. **admin (company A) sees own vendor only** (own company の vendors のみ)
2. **vendor_user seat sees 0 from vendors** (vendors RLS は社内 admin 専用)
3. **anon seat sees 0 from vendors**
4. **current_vendor_id() works for vendor_user seat** (auth_user_id 経由)
5. **vendor_accessible_company_ids() works for vendor_user seat** (membership 経由)

## auth.users INSERT 戦略

service_role 経由で direct INSERT 可。`auth.users` には id (uuid) のみ必須:
```sql
INSERT INTO auth.users (id, email, instance_id) VALUES (
  '11111111-0000-0000-0000-000000000001', 'admin-a@test.com',
  '00000000-0000-0000-0000-000000000000'
);
```

または `auth.uid()` simulation を `SET LOCAL request.jwt.claims` だけで実施 (auth.users INSERT 不要、users.id を任意の UUID にして claims sub と一致させる):

```typescript
// Simpler: skip auth.users entirely
// users.id REFERENCES auth.users(id) ON DELETE CASCADE — strict FK
// → auth.users INSERT 必須
```

Wait, users.id は auth.users.id FK。auth.users INSERT を要求。

実装案 (transaction 内で完結):
```typescript
await sql.begin(async (tx) => {
  // 1. auth.users + companies + users + vendors + vendor_users INSERT
  // 2. SET LOCAL ROLE authenticated
  // 3. SET LOCAL request.jwt.claims = JSON
  // 4. SELECT (RLS 適用下で)
  // 5. assert
  // 6. throw '__rollback__'
});
```

## 完全な実装コード (この内容をベースに書き出す)

```typescript
import { config } from "dotenv";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DIRECT_URL or DATABASE_URL must be set");

const sql = postgres(databaseUrl, { prepare: false });

afterAll(async () => {
  await sql.end();
});

// 固定 UUID で reproducible fixture
const COMPANY_A = "aaaaaaaa-0000-0000-0000-000000000001";
const COMPANY_B = "bbbbbbbb-0000-0000-0000-000000000001";
const ADMIN_A = "11111111-0000-0000-0000-000000000001";
const ADMIN_B = "22222222-0000-0000-0000-000000000001";
const VENDOR_A = "33333333-0000-0000-0000-000000000001";
const VENDOR_USER_A_AUTH = "44444444-0000-0000-0000-000000000001";

const claims = (sub: string) =>
  JSON.stringify({ sub, role: "authenticated" });

async function withFixture<T>(
  setupRole: "admin_a" | "admin_b" | "vendor_user" | "anon",
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  let captured: T;
  try {
    await sql.begin(async (tx) => {
      // fixture (within transaction, will rollback)
      await tx`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
        (${ADMIN_A}::uuid, 'admin_a@test.local', '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated'),
        (${ADMIN_B}::uuid, 'admin_b@test.local', '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated'),
        (${VENDOR_USER_A_AUTH}::uuid, 'vu_a@test.local', '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated')`;
      await tx`INSERT INTO companies (id, name) VALUES (${COMPANY_A}::uuid, '__e1_A__'), (${COMPANY_B}::uuid, '__e1_B__')`;
      await tx`INSERT INTO users (id, company_id, email, name) VALUES
        (${ADMIN_A}::uuid, ${COMPANY_A}::uuid, 'admin_a@test.local', 'Admin A'),
        (${ADMIN_B}::uuid, ${COMPANY_B}::uuid, 'admin_b@test.local', 'Admin B')`;
      await tx`INSERT INTO vendors (id, company_id, name) VALUES (${VENDOR_A}::uuid, ${COMPANY_A}::uuid, 'VendorA')`;
      await tx`INSERT INTO vendor_users (vendor_id, company_id, auth_user_id, email) VALUES
        (${VENDOR_A}::uuid, ${COMPANY_A}::uuid, ${VENDOR_USER_A_AUTH}::uuid, 'vu_a@test.local')`;

      // role + claims
      if (setupRole === "anon") {
        await tx`SET LOCAL ROLE anon`;
      } else {
        const sub =
          setupRole === "admin_a" ? ADMIN_A :
          setupRole === "admin_b" ? ADMIN_B : VENDOR_USER_A_AUTH;
        await tx`SET LOCAL ROLE authenticated`;
        await tx.unsafe(`SET LOCAL request.jwt.claims = '${claims(sub)}'`);
      }

      captured = await fn(tx);
      throw new Error("__rollback__");
    });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
  }
  return captured!;
}

describe("tenant-isolation RLS (PoC #6 移植)", () => {
  it("admin A sees own company vendor only", async () => {
    const vendors = await withFixture("admin_a", async (tx) =>
      tx<{ id: string }[]>`SELECT id FROM vendors`);
    expect(vendors.map((v) => v.id)).toEqual([VENDOR_A]);
  });

  it("admin B sees 0 vendors (different company)", async () => {
    const vendors = await withFixture("admin_b", async (tx) =>
      tx<{ id: string }[]>`SELECT id FROM vendors`);
    expect(vendors).toHaveLength(0);
  });

  it("vendor_user sees 0 vendors (vendors is internal-admin only)", async () => {
    const vendors = await withFixture("vendor_user", async (tx) =>
      tx<{ id: string }[]>`SELECT id FROM vendors`);
    expect(vendors).toHaveLength(0);
  });

  it("anon sees 0 vendors", async () => {
    const vendors = await withFixture("anon", async (tx) =>
      tx<{ id: string }[]>`SELECT id FROM vendors`);
    expect(vendors).toHaveLength(0);
  });

  it("current_vendor_id() works for vendor_user", async () => {
    const result = await withFixture("vendor_user", async (tx) =>
      tx<{ id: string | null }[]>`SELECT public.current_vendor_id() AS id`);
    expect(result[0]?.id).toBe(VENDOR_A);
  });

  it("vendor_accessible_company_ids(vendor_id) works for vendor_user", async () => {
    const ids = await withFixture("vendor_user", async (tx) =>
      tx<{ company_id: string }[]>`SELECT public.vendor_accessible_company_ids(${VENDOR_A}::uuid) AS company_id`);
    expect(ids.map((r) => r.company_id)).toEqual([COMPANY_A]);
  });

  it("current_user_company_id() returns NULL for vendor_user (not an internal user)", async () => {
    const result = await withFixture("vendor_user", async (tx) =>
      tx<{ id: string | null }[]>`SELECT public.current_user_company_id() AS id`);
    expect(result[0]?.id).toBeNull();
  });

  it("current_user_company_id() returns company_a for admin A", async () => {
    const result = await withFixture("admin_a", async (tx) =>
      tx<{ id: string | null }[]>`SELECT public.current_user_company_id() AS id`);
    expect(result[0]?.id).toBe(COMPANY_A);
  });
});
```

## 重要点

- destructure `const [foo] = await tx<...>` パターンは strict TS で `T | undefined` → 全て `(await tx<...>)[0]!` か `result[0]?.id` 形式に
- auth.users 必須列 (id, email, instance_id, aud, role) のみ、その他は default
- vendor_user は auth_user_id 経由で users とは別 (Phase 8-A 教訓)
- claims の SET LOCAL は string interp 必要 (`tx.unsafe`)
- 各テスト独立トランザクション (fixture seed → claims → assert → rollback)

## 完了条件

- ファイル ~140-160 行
- 8 it テスト (PoC #6 の 5 + 追加 3)
- `pnpm test tenant-isolation` 全 PASS
- `pnpm typecheck` 緑
- 既存テストに影響なし

## 禁止事項

- pnpm 実行はしない
- 既存テストは触らない
