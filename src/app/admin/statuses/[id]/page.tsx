import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { getStatusById, STATUS_TYPES, type StatusType } from "@/lib/services/statuses";
import { deleteStatusAction, updateStatusAction } from "./actions";

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

export default async function StatusDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();

  const adminUser = await getAdminUser();
  if (!adminUser) redirect(`/vendor/login?next=/admin/statuses/${id}`);

  const ctx = { db, companyId: adminUser.companyId };
  const status = await getStatusById(parsed.data, ctx);
  if (!status) notFound();

  const statusTypeLabel =
    STATUS_TYPE_LABELS[status.statusType as StatusType] ?? status.statusType;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/statuses">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{status.name}</h1>
          <p className="text-sm text-gray-600">{statusTypeLabel} ステータス 詳細・編集</p>
        </div>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">詳細情報</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <DetailField label="種別" value={statusTypeLabel} />
          <DetailField label="名称" value={status.name} />
          <DetailField label="key" value={status.key} />
          <DetailField label="表示順" value={status.displayOrder ?? "-"} />
          <DetailField label="初期" value={status.isInitial ? "◯" : "-"} />
          <DetailField label="終了" value={status.isTerminal ? "◯" : "-"} />
          <DetailField label="有効" value={status.isActive === null ? "-" : status.isActive ? "◯" : "×"} />
          <DetailField label="作成日時" value={formatDateTime(status.createdAt)} />
          <DetailField label="更新日時" value={formatDateTime(status.updatedAt)} />
        </dl>
      </section>

      <form action={updateStatusAction} className="rounded-md border border-gray-200 bg-white p-6">
        <input name="id" type="hidden" value={status.id} />
        <h2 className="text-lg font-semibold text-gray-900">編集</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            種別<span className="text-xs text-red-600">必須</span>
            <select
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue={status.statusType}
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
          <InputField defaultValue={status.key} label="key (英数)" name="key" required />
          <InputField defaultValue={status.name} label="名称" name="name" required />
          <InputField
            defaultValue={status.displayOrder !== null ? String(status.displayOrder) : ""}
            label="表示順"
            name="displayOrder"
            type="number"
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-4">
          <CheckboxField defaultChecked={status.isInitial} label="初期ステータス" name="isInitial" />
          <CheckboxField defaultChecked={status.isTerminal} label="終了ステータス" name="isTerminal" />
          <CheckboxField defaultChecked={status.isActive ?? false} label="有効" name="isActive" />
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
          この状態を物理削除します。予約・サービス・陸送・遷移ルールから参照中の場合は削除できません。
        </p>
        <form action={deleteStatusAction} className="mt-4">
          <input name="id" type="hidden" value={status.id} />
          <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700" type="submit">
            削除する
          </button>
        </form>
      </section>
    </div>
  );
}
