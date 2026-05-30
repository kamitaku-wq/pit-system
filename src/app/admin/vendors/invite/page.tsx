import { asc, and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { vendors } from "@/lib/db/schema/vendors";

import { InviteVendorForm } from "./form";

export default async function AdminVendorInvitePage() {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    redirect("/vendor/login?next=/admin/vendors/invite");
  }

  const vendorOptions = await db
    .select({
      id: vendors.id,
      name: vendors.name,
      email: vendors.email,
    })
    .from(vendors)
    .where(and(eq(vendors.companyId, adminUser.companyId), isNull(vendors.deletedAt)))
    .orderBy(asc(vendors.displayOrder), asc(vendors.name));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold">業者ユーザー招待</h2>
        <p className="text-sm text-gray-600">業者ポータルにログインするユーザーを招待します。</p>
      </div>

      {vendorOptions.length === 0 ? (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          招待できる業者がありません。
        </div>
      ) : null}

      <InviteVendorForm vendors={vendorOptions} />
    </div>
  );
}
