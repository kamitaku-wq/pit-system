// 今日の工場ボード (店舗別ピット稼働) — Phase 69 S2 スキャフォルド。
// ★DRAFT★: 本ページは無人セッションで視覚未検証のまま作成された雛形。
// docs/assets/screenshots/c6-floor.png / c2-calendar.png と照合してレイアウト・配色を
// 本実装すること。データ層 (getStorePitUtilization) は unit + integration で検証済。
// ナビ導線は未追加 (URL /admin/floor で到達)。本実装時に admin-shell.tsx へ項目追加。

import { redirect } from "next/navigation";

import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import {
  getStorePitUtilization,
  type StoreUtilization,
} from "@/lib/services/pit-utilization";

export const dynamic = "force-dynamic";

function todayJst(): string {
  // en-CA は YYYY-MM-DD を返す。Asia/Tokyo の暦日。
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

function hoursLabel(minutes: number): string {
  if (minutes <= 0) return "休業";
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h}時間稼働`;
}

function StoreCard({ store }: { store: StoreUtilization }) {
  const barWidth = Math.min(store.utilizationRate, 100);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">{store.storeName}</h3>
        <span className="text-xs text-gray-500">{store.laneCount}レーン</span>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="text-gray-600">
            予約 {store.reservationCount}件
            {store.totalCapacity > 0 ? ` / 容量 ${store.totalCapacity}` : ""}
          </span>
          <span className="font-semibold text-gray-900">{store.utilizationRate}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-blue-600"
            style={{ width: `${barWidth}%` }}
            aria-hidden
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
        <span>{hoursLabel(store.availableMinutes)}</span>
        {store.transferCount > 0 ? <span>店間 {store.transferCount}件</span> : null}
        {store.isHoliday ? (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-700">休業日</span>
        ) : null}
        {store.needsAttentionCount > 0 ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
            ⚠ 要対応 {store.needsAttentionCount}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default async function FloorBoardPage() {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    redirect("/vendor/login?next=/admin/floor");
  }

  const date = todayJst();
  const stores = await getStorePitUtilization(
    { db, companyId: adminUser.companyId },
    { date },
  );

  return (
    <div className="flex flex-col gap-6">
      <div
        role="alert"
        className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        ⚠ <strong>DRAFT</strong> — このページは視覚未検証のスキャフォルドです。
        <code>docs/assets/screenshots/c6-floor.png</code> と照合してから本実装してください (Phase 69 S2)。
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-normal">今日の工場ボード</h2>
        <p className="text-sm text-gray-600">
          {date}・全{stores.length}店舗のピット稼働状況
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2" aria-label="店舗別ピット稼働">
        {stores.length === 0 ? (
          <p className="text-sm text-gray-600">表示できる店舗がありません。</p>
        ) : (
          stores.map((store) => <StoreCard key={store.storeId} store={store} />)
        )}
      </section>
    </div>
  );
}
