import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import {
  listNotificationRules,
  NOTIFICATION_RULE_CHANNELS,
  NOTIFICATION_RULE_TARGET_TYPES,
  type NotificationRuleChannel,
  type NotificationRuleTargetType,
} from "@/lib/services/notification-rules";

type PageProps = {
  searchParams: Promise<{
    page?: string | string[];
    q?: string | string[];
    targetType?: string | string[];
    channel?: string | string[];
    isEnabled?: string | string[];
  }>;
};

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function parsePage(value: string): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function formatDate(value: Date): string {
  const parts = dateFormatter.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((datePart) => datePart.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function asTargetType(value: string): NotificationRuleTargetType | undefined {
  return (NOTIFICATION_RULE_TARGET_TYPES as readonly string[]).includes(value)
    ? (value as NotificationRuleTargetType)
    : undefined;
}

function asChannel(value: string): NotificationRuleChannel | undefined {
  return (NOTIFICATION_RULE_CHANNELS as readonly string[]).includes(value)
    ? (value as NotificationRuleChannel)
    : undefined;
}

export default async function AdminNotificationRulesPage({ searchParams }: PageProps) {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/notification-rules");

  const params = await searchParams;
  const page = parsePage(firstValue(params.page));
  const q = firstValue(params.q);
  const targetTypeRaw = firstValue(params.targetType);
  const channelRaw = firstValue(params.channel);
  const isEnabledRaw = firstValue(params.isEnabled);
  const targetType = asTargetType(targetTypeRaw);
  const channel = asChannel(channelRaw);
  const isEnabled =
    isEnabledRaw === "1" ? true : isEnabledRaw === "0" ? false : undefined;

  const { rows, total } = await listNotificationRules(
    {
      page,
      limit: 20,
      q: q || undefined,
      targetType,
      channel,
      isEnabled,
    },
    { db, companyId: adminUser.companyId },
  );

  const totalPages = Math.max(Math.ceil(total / 20), 1);
  const searchBase = new URLSearchParams();
  if (q) searchBase.set("q", q);
  if (targetType) searchBase.set("targetType", targetType);
  if (channel) searchBase.set("channel", channel);
  if (isEnabledRaw === "1" || isEnabledRaw === "0") searchBase.set("isEnabled", isEnabledRaw);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">通知ルール (notification_rules) 管理</h1>
          <p className="text-sm text-gray-600">
            イベント・対象・チャネルの組み合わせ毎に通知の有効化／タイミング／リトライを設定します。同一の組み合わせは一意です。
          </p>
        </div>
        <Link
          className="inline-flex w-fit items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          href="/admin/notification-rules/new"
        >
          新規作成
        </Link>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          イベント
          <input
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            defaultValue={q}
            name="q"
            placeholder="event_type 部分一致"
            type="text"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          対象
          <select
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            defaultValue={targetType ?? ""}
            name="targetType"
          >
            <option value="">すべて</option>
            {NOTIFICATION_RULE_TARGET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          チャネル
          <select
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            defaultValue={channel ?? ""}
            name="channel"
          >
            <option value="">すべて</option>
            {NOTIFICATION_RULE_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          状態
          <select
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            defaultValue={isEnabledRaw}
            name="isEnabled"
          >
            <option value="">すべて</option>
            <option value="1">有効のみ</option>
            <option value="0">無効のみ</option>
          </select>
        </label>
        <button
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          type="submit"
        >
          絞り込む
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
          該当する通知ルールがありません。
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["状態", "event_type", "対象", "チャネル", "前後分", "リトライ分", "上限", "作成日"].map(
                    (heading) => (
                      <th
                        className="px-4 py-3 text-left font-medium text-gray-700"
                        key={heading}
                        scope="col"
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-4 py-4">
                      {r.isEnabled ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          有効
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">
                          無効
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 font-mono text-gray-700">
                      <Link
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                        href={`/admin/notification-rules/${r.id}`}
                      >
                        {r.eventType}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 font-mono text-gray-700">
                      {r.targetType}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 font-mono text-gray-700">
                      {r.channel}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                      {r.timingMinutesOffset ?? "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                      {r.retryAfterMinutes ?? "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                      {r.maxReminders ?? "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                      {formatDate(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>
          {total} 件中 {rows.length} 件表示
        </span>
        <div className="flex gap-2">
          {page > 1 ? (
            <Link
              className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50"
              href={`/admin/notification-rules?${new URLSearchParams({ ...Object.fromEntries(searchBase), page: String(page - 1) })}`}
            >
              前へ
            </Link>
          ) : null}
          {page < totalPages ? (
            <Link
              className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50"
              href={`/admin/notification-rules?${new URLSearchParams({ ...Object.fromEntries(searchBase), page: String(page + 1) })}`}
            >
              次へ
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
