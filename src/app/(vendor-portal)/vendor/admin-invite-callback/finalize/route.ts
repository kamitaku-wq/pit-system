// Phase 40 — admin invite callback finalize (after client-side setSession)
// Phase 31-B ADR-0010 補項: drizzle db client (postgres role) で RLS bypass で UPDATE。

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { adminVendorInvitations } from "@/lib/db/schema/admin_vendor_invitations";
import { vendorUsers } from "@/lib/db/schema/vendor_users";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ ok: false, error: "no_session" }, { status: 401 });
  }

  const updated = await db
    .update(vendorUsers)
    .set({ isActive: true, lastLoginAt: new Date() })
    .where(eq(vendorUsers.authUserId, user.id))
    .returning({ id: vendorUsers.id });

  const vendorUserId = updated[0]?.id;
  if (!vendorUserId) {
    return NextResponse.json({ ok: false, error: "vendor_user_not_found" }, { status: 404 });
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

  return NextResponse.json({ ok: true });
}
