import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { getTokenById } from "@/lib/services/customer-reservation-tokens";
import { revokeTokenAction } from "./actions";

type PageProps = { params: Promise<{ id: string }> };

const uuidSchema = z.string().uuid();

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  );
}

function statusBadge(token: {
  usedAt: Date | null;
  deletedAt: Date | null;
  expiresAt: Date;
}): { label: string; color: string } {
  if (token.deletedAt) return { label: "失効", color: "bg-gray-300 text-gray-800" };
  if (token.usedAt) return { label: "使用済", color: "bg-blue-100 text-blue-800" };
  if (token.expiresAt.getTime() <= Date.now())
    return { label: "期限切れ", color: "bg-yellow-100 text-yellow-800" };
  return { label: "有効", color: "bg-green-100 text-green-800" };
}

export default async function CustomerReservationTokenDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();

  const adminUser = await getAdminUser();
  if (!adminUser) redirect(`/vendor/login?next=/admin/customer-reservation-tokens/${id}`);

  const ctx = { db, companyId: adminUser.companyId };
  const token = await getTokenById(parsed.data, ctx);
  if (!token) notFound();

  const badge = statusBadge(token);
  const isActive = !token.deletedAt && !token.usedAt && token.expiresAt.getTime() > Date.now();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          className="text-sm text-blue-600 hover:underline"
          href="/admin/customer-reservation-tokens"
        >
          ← 一覧に戻る
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold font-mono">{token.id}</h1>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}
          >
            {badge.label}
          </span>
        </div>
        <p className="text-sm text-gray-600">顧客予約トークン詳細</p>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">詳細情報</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-2">
          <DetailField
            label="予約 ID"
            value={
              <Link
                className="text-blue-600 hover:underline font-mono"
                href={`/admin/reservations/${token.reservationId}`}
              >
                {token.reservationId}
              </Link>
            }
          />
          <DetailField
            label="顧客 ID"
            value={
              token.customerId ? (
                <Link
                  className="text-blue-600 hover:underline font-mono"
                  href={`/admin/customers/${token.customerId}`}
                >
                  {token.customerId}
                </Link>
              ) : (
                <span className="text-gray-500">-</span>
              )
            }
          />
          <DetailField label="期限 (expires_at)" value={formatDateTime(token.expiresAt)} />
          <DetailField
            label="使用日時 (used_at)"
            value={token.usedAt ? formatDateTime(token.usedAt) : "-"}
          />
          <DetailField
            label="失効日時 (deleted_at)"
            value={token.deletedAt ? formatDateTime(token.deletedAt) : "-"}
          />
          <DetailField label="発行日時" value={formatDateTime(token.createdAt)} />
          <DetailField label="更新日時" value={formatDateTime(token.updatedAt)} />
        </dl>
      </section>

      <section className="rounded-md border border-yellow-200 bg-yellow-50 p-6">
        <h2 className="text-sm font-semibold text-yellow-900">セキュリティ注意</h2>
        <p className="mt-2 text-sm text-yellow-800">
          トークン生値は発行時にのみ返却され、データベースには SHA-256 hash として保存されます。再発行が必要な場合は新規発行してください。
        </p>
      </section>

      {isActive ? (
        <section className="rounded-md border border-red-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-red-700">失効 (revoke)</h2>
          <p className="mt-2 text-sm text-gray-600">
            このトークンを失効させ、以後の verify を不可にします。soft delete (deleted_at にタイムスタンプ) であり、監査履歴は残ります。
          </p>
          <form action={revokeTokenAction} className="mt-4">
            <input name="id" type="hidden" value={token.id} />
            <button
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700"
              type="submit"
            >
              失効させる
            </button>
          </form>
        </section>
      ) : (
        <section className="rounded-md border border-gray-200 bg-gray-50 p-6">
          <p className="text-sm text-gray-600">
            このトークンは既に
            {token.deletedAt
              ? "失効済"
              : token.usedAt
                ? "使用済"
                : "期限切れ"}
            のため、操作はありません。
          </p>
        </section>
      )}
    </div>
  );
}
