import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { listStatuses, STATUS_TYPES, type StatusType } from "@/lib/services/statuses";
import { createStatusTransitionAction } from "./actions";

const STATUS_TYPE_LABELS: Record<StatusType, string> = {
  reservation: "予約",
  service: "サービス",
  transport: "陸送",
  vendor: "ベンダー",
};

type PageProps = {
  searchParams: Promise<{ statusType?: string | string[] }>;
};

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function parseStatusType(value: string): StatusType {
  return (STATUS_TYPES as readonly string[]).includes(value)
    ? (value as StatusType)
    : "reservation";
}

export default async function NewStatusTransitionPage({ searchParams }: PageProps) {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/status-transitions/new");

  const params = await searchParams;
  const statusType = parseStatusType(firstValue(params.statusType));

  const { rows: candidateStatuses } = await listStatuses(
    { statusType, limit: 100 },
    { db, companyId: adminUser.companyId },
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/status-transitions">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">遷移ルール 新規作成</h1>
          <p className="text-sm text-gray-600">
            From / To に表示される候補は、選択中の種別のステータスのみです。種別を変更すると候補が更新されます。
          </p>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          種別 (候補絞り込み)
          <select
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            defaultValue={statusType}
            name="statusType"
          >
            {STATUS_TYPES.map((value) => (
              <option key={value} value={value}>
                {STATUS_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" type="submit">
          候補を更新
        </button>
      </form>

      <form action={createStatusTransitionAction} className="rounded-md border border-gray-200 bg-white p-6">
        <input name="statusType" type="hidden" value={statusType} />
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            種別<span className="text-xs text-red-600">必須</span>
            <input
              className="rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm shadow-sm"
              readOnly
              value={STATUS_TYPE_LABELS[statusType]}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            From ステータス
            <select
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue=""
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
              defaultValue=""
              name="toStatusId"
              required
            >
              <option disabled value="">
                選択してください
              </option>
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
              name="requiredPermissionKey"
              placeholder="例: status.change"
              type="text"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            必須ロールキー (任意)
            <input
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              name="requiredRoleKey"
              placeholder="例: admin"
              type="text"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              name="triggersNotification"
              type="checkbox"
            />
            通知を発火する
          </label>
        </div>
        {candidateStatuses.length === 0 ? (
          <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            選択中の種別 ({STATUS_TYPE_LABELS[statusType]}) のステータスが登録されていません。先に
            <Link className="ml-1 underline" href="/admin/statuses/new">
              ステータスを作成
            </Link>
            してください。
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-3">
          <Link className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" href="/admin/status-transitions">
            キャンセル
          </Link>
          <button
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            disabled={candidateStatuses.length === 0}
            type="submit"
          >
            登録する
          </button>
        </div>
      </form>
    </div>
  );
}
