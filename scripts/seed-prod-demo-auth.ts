// Phase 65: 本番デモ環境のログインユーザー (admin / vendor) を作成する。
//
// なぜ専用スクリプトか:
//   - ログインユーザー作成は Supabase Auth Admin API (service_role) が必須で、
//     Supabase MCP / execute_sql では作れない (auth.users 直 INSERT は GoTrue 内部依存で脆い)。
//   - seed-admin-dev.ts / seed-vendor-dev.ts は「自前の dev company を作る」「production で実行拒否」
//     ため本番デモ用途に使えない。本スクリプトは既存の demo company (code='pitmane-demo') を
//     ターゲットにし、その company/vendor に auth user を紐付ける。
//
// 安全装置:
//   - DATABASE_URL のホストを表示し、SEED_PROD_CONFIRM=1 が無いと書き込まない (誤実行防止)。
//   - demo company / vendor が存在しなければ throw (空 DB への誤投入防止。master seed が前提)。
//   - get-or-create で冪等 (再実行で重複なし)。
//
// 実行 (本番 .env.local が ljcruianqmfhpdzvfubl を指している前提):
//   SEED_PROD_CONFIRM=1 pnpm tsx scripts/seed-prod-demo-auth.ts

import { resolve } from "node:path";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { companies } from "../src/lib/db/schema/companies";
import { roles } from "../src/lib/db/schema/roles";
import { users } from "../src/lib/db/schema/users";
import { vendors } from "../src/lib/db/schema/vendors";
import { vendorUsers } from "../src/lib/db/schema/vendor_users";

const DEMO_COMPANY_CODE = "pitmane-demo";
const DEMO_VENDOR_NAME = "デモ陸送サービス";

const ADMIN_SEED = {
  email: "admin@pitmane-demo.example.com",
  password: "PitmaneDemo!2026",
  name: "デモ管理者",
} as const;

const VENDOR_SEED = {
  email: "vendor@pitmane-demo.example.com",
  password: "PitmaneVendor!2026",
  name: "デモ陸送担当",
} as const;

type RequiredEnv = {
  supabaseUrl: string;
  serviceRoleKey: string;
  databaseUrl: string;
};

function loadEnvFiles(): void {
  config({ path: resolve(process.cwd(), ".env.local"), override: false });
  config({ path: resolve(process.cwd(), ".env"), override: false });
}

function exitMissingEnv(name: string): never {
  console.error(`seed-prod-demo-auth: missing ${name}`);
  process.exit(1);
}

function getRequiredEnv(): RequiredEnv {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;

  if (!supabaseUrl) exitMissingEnv("NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) exitMissingEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!databaseUrl) exitMissingEnv("DATABASE_URL");

  return { supabaseUrl, serviceRoleKey, databaseUrl };
}

function hostOf(connectionString: string): string {
  try {
    return new URL(connectionString).hostname;
  } catch {
    return "(unparseable)";
  }
}

function createSupabaseAdminClient(env: RequiredEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function findAuthUserByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<User | null> {
  const normalized = email.toLowerCase();
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const match = data.users.find((u) => u.email?.toLowerCase() === normalized);
    if (match) return match;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function getOrCreateAuthUserId(
  supabase: SupabaseClient,
  seed: { email: string; password: string },
): Promise<string> {
  const existing = await findAuthUserByEmail(supabase, seed.email);
  if (existing) return existing.id;

  const { data, error } = await supabase.auth.admin.createUser({
    email: seed.email,
    password: seed.password,
    email_confirm: true,
  });

  if (error) {
    const raced = await findAuthUserByEmail(supabase, seed.email);
    if (raced) return raced.id;
    throw error;
  }
  if (!data.user) {
    throw new Error(`seed-prod-demo-auth: createUser returned no user for ${seed.email}`);
  }
  return data.user.id;
}

type Db = ReturnType<typeof drizzle>;

async function getDemoCompanyId(db: Db): Promise<string> {
  const rows = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.code, DEMO_COMPANY_CODE), isNull(companies.deletedAt)))
    .limit(1);
  const company = rows[0];
  if (!company) {
    throw new Error(
      `seed-prod-demo-auth: demo company (code=${DEMO_COMPANY_CODE}) not found. ` +
        `Apply the master seed first.`,
    );
  }
  return company.id;
}

async function getGlobalAdminRoleId(db: Db): Promise<string> {
  const rows = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.code, "admin"), isNull(roles.companyId)))
    .limit(1);
  const role = rows[0];
  if (!role) throw new Error("seed-prod-demo-auth: global admin role not found.");
  return role.id;
}

async function getDemoVendorId(db: Db, companyId: string): Promise<string> {
  const rows = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(
      and(
        eq(vendors.companyId, companyId),
        eq(vendors.name, DEMO_VENDOR_NAME),
        isNull(vendors.deletedAt),
      ),
    )
    .limit(1);
  const vendor = rows[0];
  if (!vendor) {
    throw new Error(
      `seed-prod-demo-auth: demo vendor (name=${DEMO_VENDOR_NAME}) not found. ` +
        `Apply the master seed first.`,
    );
  }
  return vendor.id;
}

async function upsertAdminPublicUser(
  db: Db,
  authUserId: string,
  companyId: string,
  roleId: string,
): Promise<void> {
  const now = new Date();
  await db
    .insert(users)
    .values({
      id: authUserId,
      companyId,
      roleId,
      email: ADMIN_SEED.email,
      name: ADMIN_SEED.name,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        companyId,
        roleId,
        email: ADMIN_SEED.email,
        name: ADMIN_SEED.name,
        isActive: true,
        updatedAt: now,
        deletedAt: null,
      },
    });
}

async function upsertVendorUser(
  db: Db,
  authUserId: string,
  companyId: string,
  vendorId: string,
): Promise<void> {
  const now = new Date();
  // company_id は enforce_vendor_user_tenancy trigger が vendor から導出するため値は揃えておく。
  await db
    .insert(vendorUsers)
    .values({
      authUserId,
      companyId,
      vendorId,
      email: VENDOR_SEED.email,
      name: VENDOR_SEED.name,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [vendorUsers.vendorId, vendorUsers.email],
      set: {
        authUserId,
        companyId,
        name: VENDOR_SEED.name,
        isActive: true,
        updatedAt: now,
        deletedAt: null,
      },
    });
}

async function main(): Promise<void> {
  loadEnvFiles();
  const env = getRequiredEnv();

  const dbHost = hostOf(env.databaseUrl);
  const supabaseHost = hostOf(env.supabaseUrl);
  console.log(`seed-prod-demo-auth: target DB host    = ${dbHost}`);
  console.log(`seed-prod-demo-auth: target Supabase    = ${supabaseHost}`);

  if (process.env.SEED_PROD_CONFIRM !== "1") {
    console.error(
      "\nseed-prod-demo-auth: aborted (dry check). " +
        "Confirm the hosts above are your production project, then re-run with SEED_PROD_CONFIRM=1.",
    );
    process.exit(1);
  }

  const supabase = createSupabaseAdminClient(env);
  const queryClient = postgres(env.databaseUrl, { prepare: false });
  const db = drizzle(queryClient);

  try {
    const companyId = await getDemoCompanyId(db);
    const adminRoleId = await getGlobalAdminRoleId(db);
    const vendorId = await getDemoVendorId(db, companyId);

    const adminAuthId = await getOrCreateAuthUserId(supabase, ADMIN_SEED);
    await upsertAdminPublicUser(db, adminAuthId, companyId, adminRoleId);

    const vendorAuthId = await getOrCreateAuthUserId(supabase, VENDOR_SEED);
    await upsertVendorUser(db, vendorAuthId, companyId, vendorId);

    console.log("\nseed-prod-demo-auth: done.");
    console.log(`  company_id : ${companyId}`);
    console.log(`  admin      : ${ADMIN_SEED.email} / ${ADMIN_SEED.password}`);
    console.log(`  vendor     : ${VENDOR_SEED.email} / ${VENDOR_SEED.password}`);
    console.log("\nAdmin login URL: <APP_URL>/admin/dashboard  (NOT /vendor/login directly)");
  } finally {
    await queryClient.end();
  }
}

main().catch((error: unknown) => {
  console.error("seed-prod-demo-auth: failed");
  console.error(error);
  process.exit(1);
});
