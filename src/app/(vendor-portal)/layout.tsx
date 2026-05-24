import type { ReactNode } from "react";
import { and, eq, isNull } from "drizzle-orm";

import { VendorShell } from "@/components/vendor-portal/vendor-shell";
import { db } from "@/lib/db/client";
import { vendorUsers } from "@/lib/db/schema/vendor_users";
import { createClient } from "@/lib/supabase/server";

type VendorPortalLayoutProps = {
  children: ReactNode;
};

export default async function VendorPortalLayout({ children }: VendorPortalLayoutProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return children;
  }

  const [vendorUser] = await db
    .select({ name: vendorUsers.name, email: vendorUsers.email })
    .from(vendorUsers)
    .where(
      and(
        eq(vendorUsers.authUserId, user.id),
        eq(vendorUsers.isActive, true),
        isNull(vendorUsers.deletedAt),
      ),
    )
    .limit(1);

  const vendorName = vendorUser?.name ?? vendorUser?.email ?? user.email ?? "業者";

  return <VendorShell vendorName={vendorName}>{children}</VendorShell>;
}
