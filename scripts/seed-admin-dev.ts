if (process.env.NODE_ENV === 'production') { console.error('seed-admin-dev: refusing to run in production'); process.exit(1); }

import { resolve } from "node:path";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { companies, type Company, type NewCompany } from "../src/lib/db/schema/companies";
import { roles, type Role } from "../src/lib/db/schema/roles";
import { users, type NewUser, type User as PublicUser } from "../src/lib/db/schema/users";

type SeedDatabase = ReturnType<typeof drizzle>;
type QueryClient = ReturnType<typeof postgres>;

type RequiredEnv = {
  supabaseUrl: string;
  serviceRoleKey: string;
  databaseUrl: string;
};

type AdminSeed = {
  email: string;
  password: string;
  companyName: string;
  companyCode: string;
};

type SeededRecord = {
  email: string;
  password: string;
  user_id: string;
  company_id: string;
  role_id: string;
};

const ADMIN_SEED: AdminSeed = {
  email: "admin-dev@local.test",
  password: "admin-dev-pass-001",
  companyName: "Dev Admin Company",
  companyCode: "dev_admin",
};

function loadEnvFiles(): void {
  config({ path: resolve(process.cwd(), ".env.local"), override: false });
  config({ path: resolve(process.cwd(), ".env"), override: false });
}

function exitMissingEnv(name: string): never {
  console.error(`seed-admin-dev: missing ${name}`);
  process.exit(1);
}

function getRequiredEnv(): RequiredEnv {
  const supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey: string | undefined = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl: string | undefined = process.env.DATABASE_URL ?? process.env.DIRECT_URL;

  if (!supabaseUrl) {
    exitMissingEnv("NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!serviceRoleKey) {
    exitMissingEnv("SUPABASE_SERVICE_ROLE_KEY");
  }

  if (!databaseUrl) {
    exitMissingEnv("DATABASE_URL");
  }

  return {
    supabaseUrl,
    serviceRoleKey,
    databaseUrl,
  };
}

function createDbConnection(databaseUrl: string): {
  db: SeedDatabase;
  queryClient: QueryClient;
} {
  const queryClient: QueryClient = postgres(databaseUrl, { prepare: false });
  const db: SeedDatabase = drizzle(queryClient);

  return { db, queryClient };
}

function createSupabaseAdminClient(env: RequiredEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function deriveNameFromEmail(email: string): string {
  const localPart: string | undefined = email.split("@")[0];
  return localPart ?? email;
}

async function findAuthUserByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<User | null> {
  const normalizedEmail: string = email.toLowerCase();
  const perPage: number = 1000;
  let page: number = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw error;
    }

    const users: User[] = data.users;
    const matchingUser: User | undefined = users.find((user: User): boolean => {
      return user.email?.toLowerCase() === normalizedEmail;
    });

    if (matchingUser) {
      return matchingUser;
    }

    if (users.length < perPage) {
      return null;
    }

    page += 1;
  }
}

async function getOrCreateAuthUserId(
  supabase: SupabaseClient,
  seed: AdminSeed,
): Promise<string> {
  const existingUser: User | null = await findAuthUserByEmail(supabase, seed.email);

  if (existingUser) {
    return existingUser.id;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: seed.email,
    password: seed.password,
    email_confirm: true,
  });

  if (error) {
    const racedUser: User | null = await findAuthUserByEmail(supabase, seed.email);

    if (racedUser) {
      return racedUser.id;
    }

    throw error;
  }

  if (!data.user) {
    throw new Error(`seed-admin-dev: Supabase createUser returned no user for ${seed.email}`);
  }

  return data.user.id;
}

async function getOrCreateCompany(db: SeedDatabase, seed: AdminSeed): Promise<Company> {
  const now: Date = new Date();
  const seedCompany: NewCompany = {
    name: seed.companyName,
    code: seed.companyCode,
    isActive: true,
    deletedAt: null,
  };

  const companyRows: Company[] = await db
    .insert(companies)
    .values(seedCompany)
    .onConflictDoUpdate({
      target: companies.code,
      set: {
        name: seedCompany.name,
        isActive: true,
        updatedAt: now,
        deletedAt: null,
      },
    })
    .returning();
  const company: Company | undefined = companyRows[0];

  if (!company) {
    throw new Error("seed-admin-dev: failed to create or update seed company");
  }

  return company;
}

async function getGlobalAdminRole(db: SeedDatabase): Promise<Role> {
  const adminRoles: Role[] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.code, "admin"), isNull(roles.companyId)))
    .limit(1);
  const adminRole: Role | undefined = adminRoles[0];

  if (!adminRole) {
    throw new Error("seed-admin-dev: global admin role not found. Was seed master applied?");
  }

  return adminRole;
}

async function upsertPublicUser(
  db: SeedDatabase,
  companyId: string,
  roleId: string,
  authUserId: string,
  seed: AdminSeed,
): Promise<PublicUser> {
  const now: Date = new Date();
  const publicUserName: string = deriveNameFromEmail(seed.email);
  const newUser: NewUser = {
    id: authUserId,
    companyId,
    roleId,
    email: seed.email,
    name: publicUserName,
    isActive: true,
    deletedAt: null,
  };

  const publicUserRows: PublicUser[] = await db
    .insert(users)
    .values(newUser)
    .onConflictDoUpdate({
      target: users.id,
      set: {
        companyId,
        roleId,
        email: seed.email,
        name: publicUserName,
        isActive: true,
        updatedAt: now,
        deletedAt: null,
      },
    })
    .returning();
  const publicUser: PublicUser | undefined = publicUserRows[0];

  if (!publicUser) {
    throw new Error(`seed-admin-dev: failed to create or update public user for ${seed.email}`);
  }

  return publicUser;
}

async function seedAdminUser(
  db: SeedDatabase,
  supabase: SupabaseClient,
  seed: AdminSeed,
): Promise<SeededRecord> {
  const authUserId: string = await getOrCreateAuthUserId(supabase, seed);
  const company: Company = await getOrCreateCompany(db, seed);
  const adminRole: Role = await getGlobalAdminRole(db);
  const publicUser: PublicUser = await upsertPublicUser(
    db,
    company.id,
    adminRole.id,
    authUserId,
    seed,
  );

  return {
    email: seed.email,
    password: seed.password,
    user_id: publicUser.id,
    company_id: company.id,
    role_id: adminRole.id,
  };
}

async function main(): Promise<void> {
  loadEnvFiles();

  const env: RequiredEnv = getRequiredEnv();
  const supabase: SupabaseClient = createSupabaseAdminClient(env);
  const { db, queryClient } = createDbConnection(env.databaseUrl);

  try {
    const record: SeededRecord = await seedAdminUser(db, supabase, ADMIN_SEED);

    console.log(`email: ${record.email}`);
    console.log(`password: ${record.password}`);
    console.log(`company_id: ${record.company_id}`);
  } finally {
    await queryClient.end();
  }
}

main().catch((error: unknown): void => {
  console.error("seed-admin-dev: failed");
  console.error(error);
  process.exit(1);
});
