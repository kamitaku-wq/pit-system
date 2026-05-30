// Phase 41 — vendor invitation callback finalize (after client-side setSession). Mirror of admin-invite-callback finalize. ADR-0010 補項 (Phase 25): drizzle db client (postgres role) で RLS bypass.

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db/client';
import { vendorUsers } from '@/lib/db/schema/vendor_users';
import { createClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ ok: false, error: 'no_session' }, { status: 401 });
  }

  const updated = await db
    .update(vendorUsers)
    .set({ isActive: true, lastLoginAt: new Date() })
    .where(eq(vendorUsers.authUserId, user.id))
    .returning({ id: vendorUsers.id });

  if (updated.length === 0) {
    return NextResponse.json({ ok: false, error: 'vendor_user_not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
