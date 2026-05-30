import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { STATUS_TYPES, type StatusType } from "@/lib/services/statuses";
import { createStatusAction } from "./actions";

const STATUS_TYPE_LABELS: Record<StatusType, string> = {
  reservation: "予約",
  service: "サービス",
  transport: "陸送",
  vendor: "ベンダー",
};

function InputField(props: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
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

function CheckboxField(props: { label: string; name: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
      <input
        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        defaultChecked={props.defaultChecked}
        name={props.name}
        type="checkbox"
      />
      {props.label}
    </label>
  );
}

export default async function NewStatusPage() {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/statuses/new");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/statuses">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">ステータス 新規作成</h1>
          <p className="text-sm text-gray-600">予約・サービス・陸送・ベンダーいずれかの状態を登録します。</p>
        </div>
      </div>

      <form action={createStatusAction} className="rounded-md border border-gray-200 bg-white p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            種別<span className="text-xs text-red-600">必須</span>
            <select
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue="reservation"
              name="statusType"
              required
            >
              {STATUS_TYPES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <InputField label="key (英数)" name="key" required />
          <InputField label="名称" name="name" required />
          <InputField defaultValue="0" label="表示順" name="displayOrder" type="number" />
        </div>
        <div className="mt-4 flex flex-wrap gap-4">
          <CheckboxField label="初期ステータス" name="isInitial" />
          <CheckboxField label="終了ステータス" name="isTerminal" />
          <CheckboxField defaultChecked label="有効" name="isActive" />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Link className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" href="/admin/statuses">
            キャンセル
          </Link>
          <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700" type="submit">
            登録する
          </button>
        </div>
      </form>
    </div>
  );
}
