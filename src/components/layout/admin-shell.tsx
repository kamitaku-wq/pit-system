import type { ReactNode } from "react";
import { Calendar, LayoutDashboard, Settings, Users, Wrench } from "lucide-react";

type AdminShellProps = {
  children: ReactNode;
};

const navigationItems = [
  { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
  { label: "カレンダー", href: "/admin/calendar", icon: Calendar },
  { label: "顧客", href: "/admin/customers", icon: Users },
  { label: "業者", href: "/admin/vendors", icon: Wrench },
  { label: "設定", href: "/admin/settings", icon: Settings },
] as const;

export function AdminShell({ children }: AdminShellProps) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <aside className="fixed inset-y-0 left-0 flex w-60 flex-col border-r border-gray-200 bg-white">
        <div className="flex h-16 items-center border-b border-gray-200 px-6">
          <p className="text-lg font-semibold">ピットマネ Admin</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 py-4" aria-label="管理メニュー">
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
          <h1 className="text-lg font-semibold">ピットマネ Admin</h1>
          <div className="flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            <span className="size-8 rounded-full bg-gray-200" aria-hidden="true" />
            <span>管理者</span>
          </div>
        </header>
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}
