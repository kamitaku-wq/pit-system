'use server';

// Phase 24 sub-task δ-server.
// ADR-0010 補項: service_role usage is permitted on this route.
import { createClient } from '@supabase/supabase-js';
import { db } from '@/lib/db/client';
import {
  InvitationTokenInvalidError,
  OnboardingError,
  VendorCrossTenantError,
  type OnboardResult,
  verifyAndOnboardSpotInvitation,
} from '@/lib/services/spot-onboarding';

export type OnboardActionResult =
  | { ok: true; result: OnboardResult }
  | {
      ok: false;
      code:
        | 'INVITATION_TOKEN_INVALID'
        | 'VENDOR_CROSS_TENANT'
        | 'ONBOARDING_ERROR'
        | 'CONFIG_ERROR';
      message: string;
    };

function getConfiguredSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function onboardSpotInvitationAction(
  token: string,
): Promise<OnboardActionResult> {
  const supabaseAdmin = getConfiguredSupabaseAdmin();

  if (!supabaseAdmin) {
    return {
      ok: false,
      code: 'CONFIG_ERROR',
      message: 'service_role not configured',
    };
  }

  try {
    const result = await verifyAndOnboardSpotInvitation(db, supabaseAdmin, token);
    return { ok: true, result };
  } catch (error) {
    if (error instanceof InvitationTokenInvalidError) {
      return { ok: false, code: 'INVITATION_TOKEN_INVALID', message: error.message };
    }

    if (error instanceof VendorCrossTenantError) {
      return { ok: false, code: 'VENDOR_CROSS_TENANT', message: error.message };
    }

    if (error instanceof OnboardingError) {
      return { ok: false, code: 'ONBOARDING_ERROR', message: error.message };
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, code: 'ONBOARDING_ERROR', message };
  }
}
