import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { getRoleById } from "@/lib/services/roles";
import { deleteRoleAction, updateRoleAction } from "./actions";

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

function TextareaField(props: { label: string; name: string; defaultValue?: string; rows?: number }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
      {props.label}
      <textarea
        className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        defaultValue={props.defaultValue}
        name={props.name}
        rows={props.rows ?? 3}
      />
    </label>
  );
}

export default async function RoleDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();

  const adminUser = await getAdminUser();
  if (!adminUser) redirect(`/vendor/login?next=/admin/roles/${id}`);

  const ctx = { db, companyId: adminUser.companyId };
  const role = await getRoleById(parsed.data, ctx);
  if (!role) notFound();

  const isReadOnly = role.isSystem || role.companyId === null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/roles">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{role.name}</h1>
            {isReadOnly ? (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                システム標準
              </span>
            ) : null}
          </div>
          <p className="text-sm text-gray-600">ロール詳細・編集</p>
        </div>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">詳細情報</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <DetailField label="種別" value={isReadOnly ? "システム標準" : "テナント"} />
          <DetailField label="code" value={role.code} />
          <DetailField label="名称" value={role.name} />
          <DetailField label="説明" value={role.description ?? "-"} />
          <DetailField label="作成日時" value={formatDateTime(role.createdAt)} />
          <DetailField label="更新日時" value={formatDateTime(role.updatedAt)} />
        </dl>
      </section>

      {isReadOnly ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          このロールはシステム標準のため、編集・削除はできません。テナント固有のロールが必要な場合は新規作成してください。
        </section>
      ) : (
        <>
          <form action={updateRoleAction} className="rounded-md border border-gray-200 bg-white p-6">
            <input name="id" type="hidden" value={role.id} />
            <h2 className="text-lg font-semibold text-gray-900">編集</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <InputField defaultValue={role.code} label="code (英数)" name="code" required />
              <InputField defaultValue={role.name} label="名称" name="name" required />
            </div>
            <div className="mt-4">
              <TextareaField defaultValue={role.description ?? ""} label="説明" name="description" rows={3} />
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
              このロールを物理削除します。所属ユーザーの role_id は NULL に、配下の permissions は連鎖削除されます。
            </p>
            <form action={deleteRoleAction} className="mt-4">
              <input name="id" type="hidden" value={role.id} />
              <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700" type="submit">
                削除する
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
