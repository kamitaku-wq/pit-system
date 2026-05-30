// Phase 64-A.31b-2: 顧客公開予約 wizard のエントリページ (Server Component, GET-safe)。
// ---------------------------------------------------------------------------
//
// 本 page は listPublicStores (純 read) のみを呼び、店舗一覧を server-side でロードして
//   client wizard に props で渡す。予約の write (createPublicReservation) は wizard が
//   POST /reservations route 経由でのみ起動する — 本 page から write 系関数は一切 import
//   しない (GET-safe invariant、A.23/A.31a 踏襲)。unfurl/prefetch/scanner が GET しても副作用なし。
//
// テナント境界: path の companyId が唯一の company scope。listPublicStores が
//   company active 検証 + company scope の active store のみ返す。
//
// 露出制約: GET/POST 公開 surface は A.33 (Turnstile + rate 制限) まで production 露出禁止。

import { listPublicStores } from "@/lib/services/customer-reservation-public";
import { ReservationWizard } from "./reservation-wizard";

export const dynamic = "force-dynamic";

export default async function PublicReservationPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const result = await listPublicStores(companyId);

  if (!result.ok) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-bold text-red-600">ご予約ページが見つかりません</h1>
        <p className="mt-4 text-gray-700">
          URL をご確認のうえ、発行元の店舗にお問い合わせください。
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">ご予約</h1>
      <p className="mt-2 text-sm text-gray-600">
        店舗・メニュー・ご希望の日時を順にお選びいただき、お客様情報をご入力ください。
      </p>
      <div className="mt-6">
        <ReservationWizard companyId={companyId} stores={result.stores} />
      </div>
    </main>
  );
}
