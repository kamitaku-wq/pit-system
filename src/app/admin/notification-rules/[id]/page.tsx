import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import {
  getNotificationRuleById,
  NOTIFICATION_RULE_CHANNELS,
  NOTIFICATION_RULE_TARGET_TYPES,
} from "@/lib/services/notification-rules";
import { deleteNotificationRuleAction, updateNotificationRuleAction } from "./actions";

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

function TextInput(props: {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
      {props.label}
      {props.required ? <span className="text-xs text-red-600">必須</span> : null}
      <input
        className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        defaultValue={props.defaultValue}
        name={props.name}
        required={props.required}
        type={props.type ?? "text"}
      />
    </label>
  );
}

export default async function NotificationRuleDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();

  const adminUser = await getAdminUser();
  if (!adminUser) redirect(`/vendor/login?next=/admin/notification-rules/${id}`);

  const ctx = { db, companyId: adminUser.companyId };
  const rule = await getNotificationRuleById(parsed.data, ctx);
  if (!rule) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/notification-rules">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold font-mono">{rule.eventType}</h1>
            {rule.isEnabled ? (
              <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                有効
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">
                無効
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600">通知ルール詳細・編集</p>
        </div>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">詳細情報</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <DetailField label="event_type" value={<span className="font-mono">{rule.eventType}</span>} />
          <DetailField label="対象 (target_type)" value={<span className="font-mono">{rule.targetType}</span>} />
          <DetailField label="チャネル (channel)" value={<span className="font-mono">{rule.channel}</span>} />
          <DetailField label="状態" value={rule.isEnabled ? "有効" : "無効"} />
          <DetailField
            label="timing_minutes_offset"
            value={rule.timingMinutesOffset ?? "-"}
          />
          <DetailField label="retry_after_minutes" value={rule.retryAfterMinutes ?? "-"} />
          <DetailField label="max_reminders" value={rule.maxReminders ?? "-"} />
          <DetailField label="作成日時" value={formatDateTime(rule.createdAt)} />
          <DetailField label="更新日時" value={formatDateTime(rule.updatedAt)} />
        </dl>
      </section>

      <form
        action={updateNotificationRuleAction}
        className="rounded-md border border-gray-200 bg-white p-6"
      >
        <input name="id" type="hidden" value={rule.id} />
        <h2 className="text-lg font-semibold text-gray-900">編集</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <TextInput defaultValue={rule.eventType} label="event_type" name="eventType" required />
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            対象 (target_type)<span className="text-xs text-red-600">必須</span>
            <select
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
              defaultValue={rule.targetType}
              name="targetType"
              required
            >
              {NOTIFICATION_RULE_TARGET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            チャネル (channel)<span className="text-xs text-red-600">必須</span>
            <select
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
              defaultValue={rule.channel}
              name="channel"
              required
            >
              {NOTIFICATION_RULE_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              defaultChecked={rule.isEnabled}
              name="isEnabled"
              type="checkbox"
              value="1"
            />
            有効 (is_enabled)
          </label>
          <TextInput
            defaultValue={rule.timingMinutesOffset?.toString() ?? ""}
            label="timing_minutes_offset"
            name="timingMinutesOffset"
            type="number"
          />
          <TextInput
            defaultValue={rule.retryAfterMinutes?.toString() ?? ""}
            label="retry_after_minutes"
            name="retryAfterMinutes"
            type="number"
          />
          <TextInput
            defaultValue={rule.maxReminders?.toString() ?? ""}
            label="max_reminders"
            name="maxReminders"
            type="number"
          />
        </div>
        <div className="mt-6 flex justify-end">
          <button
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            type="submit"
          >
            保存する
          </button>
        </div>
      </form>

      <section className="rounded-md border border-red-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-red-700">削除</h2>
        <p className="mt-2 text-sm text-gray-600">
          このルールを物理削除します。送信済の outbox / deliveries には影響しません。
        </p>
        <form action={deleteNotificationRuleAction} className="mt-4">
          <input name="id" type="hidden" value={rule.id} />
          <button
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700"
            type="submit"
          >
            削除する
          </button>
        </form>
      </section>
    </div>
  );
}
