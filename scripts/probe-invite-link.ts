if (process.env.NODE_ENV === 'production') { console.error('probe-invite-link: refusing to run in production'); process.exit(1); }

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { config } from "dotenv";

type RequiredEnv = {
  supabaseUrl: string;
  serviceRoleKey: string;
  appUrl: string;
  sendRealEmail: boolean;
};

type InvitePattern = "PKCE_QUERY" | "IMPLICIT_FRAGMENT" | "UNKNOWN";

type GenerateLinkData = {
  user?: User | null;
  properties?: {
    action_link?: string;
  };
};

function loadEnvFiles(): void {
  config({ path: resolve(process.cwd(), ".env.local"), override: false });
  config({ path: resolve(process.cwd(), ".env"), override: false });
}

function exitMissingEnv(name: string): never {
  console.error(`probe-invite-link: missing ${name}`);
  process.exit(1);
}

function getRequiredEnv(): RequiredEnv {
  const supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey: string | undefined = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl: string = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const sendRealEmail: boolean = process.env.PROBE_SEND_REAL_EMAIL === "1";

  if (!supabaseUrl) {
    exitMissingEnv("NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!serviceRoleKey) {
    exitMissingEnv("SUPABASE_SERVICE_ROLE_KEY");
  }

  return {
    supabaseUrl,
    serviceRoleKey,
    appUrl,
    sendRealEmail,
  };
}

function createSupabaseAdminClient(env: RequiredEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function createProbeEmail(): string {
  return `probe-invite-${randomUUID()}@test.local`;
}

function determinePattern(locationHeader: string | null): InvitePattern {
  if (locationHeader?.includes("?code=")) {
    return "PKCE_QUERY";
  }

  if (locationHeader?.includes("#access_token=")) {
    return "IMPLICIT_FRAGMENT";
  }

  return "UNKNOWN";
}

async function probeGenerateLink(
  supabase: SupabaseClient,
  testEmail: string,
  callbackUrl: string,
  createdUserIds: Set<string>,
): Promise<void> {
  console.log("=== Probe: generateLink(type=invite) ===");

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "invite",
    email: testEmail,
    options: { redirectTo: callbackUrl },
  });

  if (error) {
    throw new Error(`probe-invite-link: generateLink failed for ${testEmail}: ${error.message}`);
  }

  const generateLinkData: GenerateLinkData = data as GenerateLinkData;

  if (generateLinkData.user?.id) {
    createdUserIds.add(generateLinkData.user.id);
  }

  const actionLink: string | undefined = generateLinkData.properties?.action_link;

  if (!actionLink) {
    throw new Error(`probe-invite-link: generateLink returned no action_link for ${testEmail}`);
  }

  let locationHeader: string | null = null;

  try {
    const response: Response = await fetch(actionLink, { redirect: "manual" });
    locationHeader = response.headers.get("location");
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error);
    throw new Error(`probe-invite-link: failed to fetch action_link with manual redirect: ${message}`);
  }

  const pattern: InvitePattern = determinePattern(locationHeader);

  console.log(`action_link: ${actionLink}`);
  console.log(`location_header: ${locationHeader ?? "none"}`);
  console.log(`pattern: ${pattern}`);
  console.log("");
}

async function probeInviteUserByEmail(
  supabase: SupabaseClient,
  testEmail: string,
  callbackUrl: string,
  createdUserIds: Set<string>,
  sendRealEmail: boolean,
): Promise<void> {
  console.log("=== Probe: inviteUserByEmail() ===");

  if (!sendRealEmail) {
    console.log("(skipped, set PROBE_SEND_REAL_EMAIL=1 to enable)");
    return;
  }

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(testEmail, {
    redirectTo: callbackUrl,
  });

  if (error) {
    throw new Error(`probe-invite-link: inviteUserByEmail failed for ${testEmail}: ${error.message}`);
  }

  if (data.user?.id) {
    createdUserIds.add(data.user.id);
  }

  console.log(`user_id: ${data.user?.id ?? "none"}`);
  console.log(`email: ${data.user?.email ?? testEmail}`);
}

async function cleanupCreatedUsers(
  supabase: SupabaseClient,
  createdUserIds: Set<string>,
): Promise<void> {
  for (const userId of createdUserIds) {
    const { error } = await supabase.auth.admin.deleteUser(userId);

    if (error) {
      console.error(`probe-invite-link: cleanup failed for auth user ${userId}: ${error.message}`);
    }
  }
}

async function main(): Promise<void> {
  loadEnvFiles();

  const env: RequiredEnv = getRequiredEnv();
  const supabase: SupabaseClient = createSupabaseAdminClient(env);
  const testEmailA: string = createProbeEmail();
  const testEmailB: string = createProbeEmail();
  const callbackUrl: string = `${env.appUrl}/vendor/admin-invite-callback`;
  const createdUserIds: Set<string> = new Set<string>();

  try {
    await probeGenerateLink(supabase, testEmailA, callbackUrl, createdUserIds);
    await probeInviteUserByEmail(
      supabase,
      testEmailB,
      callbackUrl,
      createdUserIds,
      env.sendRealEmail,
    );
  } finally {
    await cleanupCreatedUsers(supabase, createdUserIds);
  }
}

main().catch((error: unknown): void => {
  console.error("probe-invite-link: failed");
  console.error(error);
  process.exit(1);
});
