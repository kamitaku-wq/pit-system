import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { getAttachmentById } from "@/lib/services/attachments";
import { softDeleteAttachmentAction } from "./actions";
import { AttachmentDownloadButton } from "./download-button";

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

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  );
}

function parentLink(a: {
  serviceTicketId: string | null;
  reservationId: string | null;
  transportOrderId: string | null;
}): React.ReactNode {
  if (a.serviceTicketId) {
    return (
      <Link
        className="font-mono text-blue-600 hover:underline"
        href={`/admin/service-tickets/${a.serviceTicketId}`}
      >
        整備伝票 {a.serviceTicketId}
      </Link>
    );
  }
  if (a.reservationId) {
    return (
      <Link
        className="font-mono text-blue-600 hover:underline"
        href={`/admin/reservations/${a.reservationId}`}
      >
        予約 {a.reservationId}
      </Link>
    );
  }
  if (a.transportOrderId) {
    return (
      <Link
        className="font-mono text-blue-600 hover:underline"
        href={`/admin/transport-orders/${a.transportOrderId}`}
      >
        店間移動 {a.transportOrderId}
      </Link>
    );
  }
  return <span className="text-gray-500">親なし (不整合)</span>;
}

export default async function AttachmentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();

  const adminUser = await getAdminUser();
  if (!adminUser) redirect(`/vendor/login?next=/admin/attachments/${id}`);

  const ctx = { db, companyId: adminUser.companyId };
  const att = await getAttachmentById(parsed.data, ctx);
  if (!att) notFound();

  const isLive = att.deletedAt === null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/attachments">
          ← 一覧に戻る
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold font-mono">{att.id}</h1>
          {isLive ? (
            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
              有効
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-gray-300 px-2 py-0.5 text-xs font-medium text-gray-800">
              失効
            </span>
          )}
        </div>
        <p className="text-sm text-gray-600">添付ファイル詳細</p>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">基本情報</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-2">
          <DetailField label="ファイル名" value={att.fileName} />
          <DetailField label="親エンティティ" value={parentLink(att)} />
          <DetailField label="MIME タイプ" value={att.contentType ?? "-"} />
          <DetailField label="サイズ" value={`${formatBytes(att.byteSize)} (${att.byteSize.toLocaleString()} B)`} />
          <DetailField
            label="チェックサム"
            value={
              att.checksum ? (
                <span className="font-mono break-all">{att.checksum}</span>
              ) : (
                <span className="text-gray-500">-</span>
              )
            }
          />
          <DetailField
            label="アップロード user ID"
            value={
              att.uploadedByUserId ? (
                <span className="font-mono">{att.uploadedByUserId}</span>
              ) : (
                <span className="text-gray-500">-</span>
              )
            }
          />
        </dl>
      </section>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Storage 参照</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-2">
          <DetailField label="bucket" value={<span className="font-mono">{att.storageBucket}</span>} />
          <DetailField
            label="key"
            value={<span className="font-mono break-all">{att.storageKey}</span>}
          />
        </dl>
        {isLive ? (
          <div className="mt-4 flex flex-col gap-2">
            <AttachmentDownloadButton id={att.id} />
            <p className="text-xs text-gray-500">
              ※ service_role 経由で署名付き URL を発行します (TTL 5 分)。URL は
              この操作時のみ取得され、画面には保持されません。
            </p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-gray-500">
            ※ 失効済みのため署名付き URL は発行できません。
          </p>
        )}
      </section>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">監査</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-3">
          <DetailField label="登録日時" value={formatDateTime(att.createdAt)} />
          <DetailField label="更新日時" value={formatDateTime(att.updatedAt)} />
          <DetailField
            label="失効日時"
            value={att.deletedAt ? formatDateTime(att.deletedAt) : "-"}
          />
        </dl>
      </section>

      {isLive ? (
        <section className="rounded-md border border-red-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-red-700">失効 (soft delete)</h2>
          <p className="mt-2 text-sm text-gray-600">
            このメタデータ行を失効させ、デフォルトの一覧から除外します。Storage 上の
            実体ファイルは削除されません (Phase 4 統合で実体削除フローを追加予定)。
          </p>
          <form action={softDeleteAttachmentAction} className="mt-4">
            <input name="id" type="hidden" value={att.id} />
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
            このメタデータは既に失効済みです。操作はありません。
          </p>
        </section>
      )}
    </div>
  );
}
