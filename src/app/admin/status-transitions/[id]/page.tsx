import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { getStatusTransitionById } from "@/lib/services/status-transitions";
import { listStatuses, STATUS_TYPES, type StatusType } from "@/lib/services/statuses";
import { deleteStatusTransitionAction, updateStatusTransitionAction } from "./actions";

type PageProps = { params: Promise<{ id: string }> };

const uuidSchema = z.string().uuid();

const STATUS_TYPE_LABELS: Record<StatusType, string> = {
  reservation: "予約",
  service: "サービス",
  transport: "陸送",
  vendor: "ベンダー",
};

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

function statusLabel(name: string | null, key: string | null, fallback: string): string {
  return name ?? key ?? fallback;
}

export default async function StatusTransitionDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();

  const adminUser = await getAdminUser();
  if (!adminUser) redirect(`/vendor/login?next=/admin/status-transitions/${id}`);

  const ctx = { db, companyId: adminUser.companyId };
  const transition = await getStatusTransitionById(parsed.data, ctx);
  if (!transition) notFound();

  const statusTypeLabel =
    STATUS_TYPE_LABELS[transition.statusType as StatusType] ?? transition.statusType;

  const { rows: candidateStatuses } = await listStatuses(
    { statusType: transition.statusType as StatusType, limit: 100 },
    ctx,
  );

  const fromLabel =
    transition.fromStatusId === null
      ? "(初期遷移)"
      : statusLabel(
          transition.fromStatusName,
          transition.fromStatusKey,
          transition.fromStatusId.slice(0, 8),
        );
  const toLabel = statusLabel(
    transition.toStatusName,
    transition.toStatusKey,
    transition.toStatusId.slice(0, 8),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/status-transitions">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">
            {fromLabel} → {toLabel}
          </h1>
          <p className="text-sm text-gray-600">{statusTypeLabel} 遷移ルール 詳細・編集</p>
        </div>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">詳細情報</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <DetailField label="種別" value={statusTypeLabel} />
          <DetailField label="From" value={fromLabel} />
          <DetailField label="To" value={toLabel} />
          <DetailField label="必須権限キー" value={transition.requiredPermissionKey ?? "-"} />
          <DetailField label="必須ロールキー" value={transition.requiredRoleKey ?? "-"} />
          <DetailField label="通知" value={transition.triggersNotification ? "◯" : "-"} />
          <DetailField label="作成日時" value={formatDateTime(transition.createdAt)} />
          <DetailField label="更新日時" value={formatDateTime(transition.updatedAt)} />
        </dl>
      </section>

      <form action={updateStatusTransitionAction} className="rounded-md border border-gray-200 bg-white p-6">
        <input name="id" type="hidden" value={transition.id} />
        <input name="statusType" type="hidden" value={transition.statusType} />
        <h2 className="text-lg font-semibold text-gray-900">編集</h2>
        <p className="mt-1 text-xs text-gray-500">
          種別は変更不可。種別を変えたい場合は本ルールを削除して新規作成してください。
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            From ステータス
            <select
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue={transition.fromStatusId ?? ""}
              name="fromStatusId"
            >
              <option value="">(初期遷移 / NULL)</option>
              {candidateStatuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name} ({status.key})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            To ステータス<span className="text-xs text-red-600">必須</span>
            <select
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue={transition.toStatusId}
              name="toStatusId"
              required
            >
              {candidateStatuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name} ({status.key})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            必須権限キー (任意)
            <input
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue={transition.requiredPermissionKey ?? ""}
              name="requiredPermissionKey"
              type="text"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            必須ロールキー (任意)
            <input
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue={transition.requiredRoleKey ?? ""}
              name="requiredRoleKey"
              type="text"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              defaultChecked={transition.triggersNotification}
              name="triggersNotification"
              type="checkbox"
            />
            通知を発火する
          </label>
        </div>
        <div className="mt-6 flex justify-end">
          <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700" type="submit">
            保存する
          </button>
        </div>
      </form>

      <section className="rounded-md border border-red-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-red-700">削除</h2>
        <p className="mt-2 text-sm text-gray-600">
          この遷移ルールを物理削除します。参照中の statuses は削除されません。
        </p>
        <form action={deleteStatusTransitionAction} className="mt-4">
          <input name="id" type="hidden" value={transition.id} />
          <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700" type="submit">
            削除する
          </button>
        </form>
      </section>
    </div>
  );
}
