import type { ReactNode } from "react";
import { ClipboardList, LogOut } from "lucide-react";

import { logoutAction } from "@/app/(vendor-portal)/vendor/login/actions";

type VendorShellProps = {
  vendorName: string;
  children: ReactNode;
};

const navigationItems = [{ label: "依頼一覧", href: "/vendor/requests", icon: ClipboardList }] as const;

export function VendorShell({ vendorName, children }: VendorShellProps) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <aside className="fixed inset-y-0 left-0 flex w-60 flex-col border-r border-gray-200 bg-white">
        <div className="flex h-16 items-center border-b border-gray-200 px-6">
          <p className="text-lg font-semibold">ピットマネ Vendor</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 py-4" aria-label="業者メニュー">
          {navigationItems.map((item) => {
            const Icon = item.icon;

            return (
              <a
                className="flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
                href={item.href}
                key={item.href}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
      </aside>
      <div className="min-h-screen pl-60">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-8">
          <div>
            <p className="text-xs font-medium text-gray-500">業者ポータル</p>
            <h1 className="text-lg font-semibold">{vendorName}</h1>
          </div>
          <form action={logoutAction}>
            <button
              className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
              type="submit"
            >
              <LogOut className="size-4" aria-hidden="true" />
              <span>ログアウト</span>
            </button>
          </form>
        </header>
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}
