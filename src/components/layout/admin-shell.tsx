import type { ReactNode } from "react";
import {
  Bell,
  BellRing,
  Building2,
  Calendar,
  Car,
  ClipboardList,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  Layers,
  Settings,
  Shield,
  ShieldCheck,
  Store,
  Tag,
  Ticket,
  Truck,
  UserCog,
  Users,
  Wrench,
} from "lucide-react";

type AdminShellProps = {
  children: ReactNode;
};

type NavItem = { label: string; href: string; icon: typeof LayoutDashboard };
type NavGroup = { title: string | null; items: NavItem[] };

// spec/screen-list.md §1 (管理画面=業務) / §3 (設定画面=マスター) の構成に対応。
// 実装済みページ (src/app/admin/*) をすべて動線に載せる (ナビ欠落の是正)。
const navigationGroups: readonly NavGroup[] = [
  {
    title: null,
    items: [
      { label: "ダッシュボード", href: "/admin/dashboard", icon: LayoutDashboard },
      { label: "カレンダー", href: "/admin/calendar", icon: Calendar },
    ],
  },
  {
    title: "業務",
    items: [
      { label: "整備伝票", href: "/admin/service-tickets", icon: ClipboardList },
      { label: "車両", href: "/admin/vehicles", icon: Car },
      { label: "顧客", href: "/admin/customers", icon: Users },
      { label: "業者通知・回送", href: "/admin/transport-orders", icon: Truck },
      { label: "通知 (失敗・運用)", href: "/admin/notifications", icon: Bell },
      { label: "予約トークン", href: "/admin/customer-reservation-tokens", icon: Ticket },
    ],
  },
  {
    title: "マスター・設定",
    items: [
      { label: "店舗", href: "/admin/stores", icon: Store },
      { label: "レーン", href: "/admin/lanes", icon: Wrench },
      { label: "レーン種別", href: "/admin/lane-types", icon: Layers },
      { label: "作業カテゴリ", href: "/admin/work-categories", icon: Tag },
      { label: "作業メニュー", href: "/admin/work-menus", icon: ListChecks },
      { label: "業者マスター", href: "/admin/vendors", icon: Building2 },
      { label: "通知ルール", href: "/admin/notification-rules", icon: BellRing },
      { label: "ステータス", href: "/admin/statuses", icon: Tag },
      { label: "状態遷移", href: "/admin/status-transitions", icon: GitBranch },
      { label: "ロール", href: "/admin/roles", icon: Shield },
      { label: "権限", href: "/admin/permissions", icon: ShieldCheck },
      { label: "社内ユーザー", href: "/admin/users", icon: UserCog },
      { label: "設定", href: "/admin/settings", icon: Settings },
    ],
  },
];

export function AdminShell({ children }: AdminShellProps) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <aside className="fixed inset-y-0 left-0 flex w-60 flex-col border-r border-gray-200 bg-white">
        <div className="flex h-16 items-center border-b border-gray-200 px-6">
          <p className="text-lg font-semibold">ピットマネ Admin</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4" aria-label="管理メニュー">
          {navigationGroups.map((group, groupIndex) => (
            <div key={group.title ?? `group-${groupIndex}`} className="flex flex-col gap-1">
              {group.title ? (
                <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {group.title}
                </p>
              ) : null}
              {group.items.map((item) => {
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
            </div>
          ))}
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
