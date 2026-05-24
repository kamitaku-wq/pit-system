if (process.env.NODE_ENV === 'production') { console.error('seed-vendor-dev: refusing to run in production'); process.exit(1); }

import { resolve } from "node:path";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { companies, type Company, type NewCompany } from "../src/lib/db/schema/companies";
import { vendorUsers, type NewVendorUser, type VendorUser } from "../src/lib/db/schema/vendor_users";
import { vendors, type NewVendor, type Vendor } from "../src/lib/db/schema/vendors";

type SeedDatabase = ReturnType<typeof drizzle>;
type QueryClient = ReturnType<typeof postgres>;

type RequiredEnv = {
  supabaseUrl: string;
  serviceRoleKey: string;
  databaseUrl: string;
};

type VendorSeed = {
  email: string;
  password: string;
  vendorName: string;
};

type SeededRecord = {
  email: string;
  vendor_user_id: string;
  vendor_id: string;
};

const VENDOR_SEEDS: readonly VendorSeed[] = [
  {
    email: "vendor-dev1@example.com",
    password: "vendor-dev-pass-001",
    vendorName: "Dev Vendor A",
  },
  {
    email: "vendor-dev2@example.com",
    password: "vendor-dev-pass-002",
    vendorName: "Dev Vendor B",
  },
];

function loadEnvFiles(): void {
  config({ path: resolve(process.cwd(), ".env.local"), override: false });
  config({ path: resolve(process.cwd(), ".env"), override: false });
}

function exitMissingEnv(name: string): never {
  console.error(`seed-vendor-dev: missing ${name}`);
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
  seed: VendorSeed,
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
    throw new Error(`seed-vendor-dev: Supabase createUser returned no user for ${seed.email}`);
  }

  return data.user.id;
}

async function getOrCreateCompany(db: SeedDatabase): Promise<Company> {
  const existingCompanies: Company[] = await db
    .select()
    .from(companies)
    .where(isNull(companies.deletedAt))
    .limit(1);
  const existingCompany: Company | undefined = existingCompanies[0];

  if (existingCompany) {
    return existingCompany;
  }

  const seedCompany: NewCompany = {
    name: "Seed Vendor Dev Company",
    code: "seed-vendor-dev",
    isActive: true,
  };

  const createdCompanies: Company[] = await db
    .insert(companies)
    .values(seedCompany)
    .onConflictDoUpdate({
      target: companies.code,
      set: {
        name: seedCompany.name,
        isActive: true,
        updatedAt: new Date(),
        deletedAt: null,
      },
    })
    .returning();
  const createdCompany: Company | undefined = createdCompanies[0];

  if (!createdCompany) {
    throw new Error("seed-vendor-dev: failed to create or update seed company");
  }

  return createdCompany;
}

async function upsertVendor(
  db: SeedDatabase,
  companyId: string,
  seed: VendorSeed,
): Promise<Vendor> {
  const existingVendors: Vendor[] = await db
    .select()
    .from(vendors)
    .where(
      and(eq(vendors.companyId, companyId), eq(vendors.email, seed.email), isNull(vendors.deletedAt)),
    )
    .limit(1);
  const existingVendor: Vendor | undefined = existingVendors[0];
  const now: Date = new Date();

  if (existingVendor) {
    const updatedVendors: Vendor[] = await db
      .update(vendors)
      .set({
        name: seed.vendorName,
        contactPersonName: seed.vendorName,
        notificationMethod: "portal",
        isActive: true,
        updatedAt: now,
      })
      .where(eq(vendors.id, existingVendor.id))
      .returning();
    const updatedVendor: Vendor | undefined = updatedVendors[0];

    if (!updatedVendor) {
      throw new Error(`seed-vendor-dev: failed to update vendor for ${seed.email}`);
    }

    return updatedVendor;
  }

  const newVendor: NewVendor = {
    companyId,
    name: seed.vendorName,
    contactPersonName: seed.vendorName,
    email: seed.email,
    notificationMethod: "portal",
    isActive: true,
  };

  const createdVendors: Vendor[] = await db.insert(vendors).values(newVendor).returning();
  const createdVendor: Vendor | undefined = createdVendors[0];

  if (!createdVendor) {
    throw new Error(`seed-vendor-dev: failed to create vendor for ${seed.email}`);
  }

  return createdVendor;
}

async function upsertVendorUser(
  db: SeedDatabase,
  companyId: string,
  vendorId: string,
  authUserId: string,
  seed: VendorSeed,
): Promise<VendorUser> {
  const now: Date = new Date();
  const vendorUserName: string = deriveNameFromEmail(seed.email);
  const newVendorUser: NewVendorUser = {
    authUserId,
    companyId,
    vendorId,
    email: seed.email,
    name: vendorUserName,
    isActive: true,
  };

  const vendorUserRows: VendorUser[] = await db
    .insert(vendorUsers)
    .values(newVendorUser)
    .onConflictDoUpdate({
      target: [vendorUsers.vendorId, vendorUsers.email],
      set: {
        authUserId,
        companyId,
        name: vendorUserName,
        isActive: true,
        updatedAt: now,
        deletedAt: null,
      },
    })
    .returning();
  const vendorUser: VendorUser | undefined = vendorUserRows[0];

  if (!vendorUser) {
    throw new Error(`seed-vendor-dev: failed to create or update vendor user for ${seed.email}`);
  }

  return vendorUser;
}

async function seedVendorUser(
  db: SeedDatabase,
  supabase: SupabaseClient,
  seed: VendorSeed,
): Promise<SeededRecord> {
  const authUserId: string = await getOrCreateAuthUserId(supabase, seed);
  const company: Company = await getOrCreateCompany(db);
  const vendor: Vendor = await upsertVendor(db, company.id, seed);
  const vendorUser: VendorUser = await upsertVendorUser(
    db,
    company.id,
    vendor.id,
    authUserId,
    seed,
  );

  return {
    email: seed.email,
    vendor_user_id: vendorUser.id,
    vendor_id: vendor.id,
  };
}

async function main(): Promise<void> {
  loadEnvFiles();

  const env: RequiredEnv = getRequiredEnv();
  const supabase: SupabaseClient = createSupabaseAdminClient(env);
  const { db, queryClient } = createDbConnection(env.databaseUrl);

  try {
    const records: SeededRecord[] = [];

    for (const seed of VENDOR_SEEDS) {
      const record: SeededRecord = await seedVendorUser(db, supabase, seed);
      records.push(record);
    }

    console.table(records);
  } finally {
    await queryClient.end();
  }
}

main().catch((error: unknown): void => {
  console.error("seed-vendor-dev: failed");
  console.error(error);
  process.exit(1);
});
