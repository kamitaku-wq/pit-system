// Phase 31-B — admin vendor invitation accept callback
// ADR-0010 補項: drizzle db client runs as postgres user (RLS bypass), 同 (vendor-portal)/vendor/invitations/callback と同方針。
// vendor_users RLS は current_user_company_id() (= users 参照) を満たせないため bypass で UPDATE する。

import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { adminVendorInvitations } from "@/lib/db/schema/admin_vendor_invitations";
import { vendorUsers } from "@/lib/db/schema/vendor_users";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code");

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

  const vendorUserId = updated[0]?.id;
  if (!vendorUserId) {
    return NextResponse.redirect(`${origin}/vendor/login?error=vendor_user_not_found`);
  }

  await db
    .update(adminVendorInvitations)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(
      and(
        eq(adminVendorInvitations.vendorUserId, vendorUserId),
        eq(adminVendorInvitations.status, "sent"),
      ),
    );

  return NextResponse.redirect(`${origin}/vendor/requests`);
}
