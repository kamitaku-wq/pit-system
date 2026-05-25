// Phase 25 F10 — vendor invitation callback route
// ADR-0010 補項 (Phase 25 拡張):
//   drizzle db client runs as postgres user (RLS bypass) because vendor portal users
//   cannot satisfy tenant_isolation policy via current_user_company_id() (which queries
//   public.users only). This is intentional and safe for the vendor_users table.

import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { vendorUsers } from '@/lib/db/schema/vendor_users';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(`${origin}/vendor/login?error=invalid_callback`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    return NextResponse.redirect(`${origin}/vendor/login?error=callback_failed`);
  }

  const authUserId = data.session.user.id;

  const updated = await db
    .update(vendorUsers)
    .set({ isActive: true, lastLoginAt: new Date() })
    .where(eq(vendorUsers.authUserId, authUserId))
    .returning({ id: vendorUsers.id });

  if (updated.length === 0) {
    return NextResponse.redirect(`${origin}/vendor/login?error=vendor_user_not_found`);
  }

  return NextResponse.redirect(`${origin}/vendor/requests`);
}
