import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import {
  NOTIFICATION_RULE_CHANNELS,
  NOTIFICATION_RULE_TARGET_TYPES,
} from "@/lib/services/notification-rules";
import { createNotificationRuleAction } from "./actions";

function TextInput(props: {
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
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
        placeholder={props.placeholder}
        required={props.required}
        type={props.type ?? "text"}
      />
    </label>
  );
}

export default async function NewNotificationRulePage() {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/notification-rules/new");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/notification-rules">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">通知ルール 新規作成</h1>
          <p className="text-sm text-gray-600">
            event_type / 対象 / チャネルの 3 つの組み合わせは自社内で一意です。
          </p>
        </div>
      </div>

      <form
        action={createNotificationRuleAction}
        className="rounded-md border border-gray-200 bg-white p-6"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <TextInput
            label="event_type"
            name="eventType"
            placeholder="例: transport_order.invited"
            required
          />
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            対象 (target_type)<span className="text-xs text-red-600">必須</span>
            <select
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
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
              defaultChecked
              name="isEnabled"
              type="checkbox"
              value="1"
            />
            有効 (is_enabled)
          </label>
          <TextInput
            label="timing_minutes_offset (例: -1440 = 前日)"
            name="timingMinutesOffset"
            placeholder="任意"
            type="number"
          />
          <TextInput
            label="retry_after_minutes"
            name="retryAfterMinutes"
            placeholder="任意"
            type="number"
          />
          <TextInput
            label="max_reminders"
            name="maxReminders"
            placeholder="任意"
            type="number"
          />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Link
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            href="/admin/notification-rules"
          >
            キャンセル
          </Link>
          <button
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            type="submit"
          >
            登録する
          </button>
        </div>
      </form>
    </div>
  );
}
