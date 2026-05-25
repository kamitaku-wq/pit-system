import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AdminShell } from "@/components/layout/admin-shell";
import { getAdminUser } from "@/lib/auth/admin-role";

type AdminLayoutProps = {
  children: ReactNode;
};

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    redirect("/vendor/login?next=/admin/dashboard");
  }
  return <AdminShell>{children}</AdminShell>;
}
