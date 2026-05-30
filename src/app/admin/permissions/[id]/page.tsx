import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { getPermissionById } from "@/lib/services/permissions";
import { deletePermissionAction, updatePermissionAction } from "./actions";

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
      />
    </label>
  );
}

export default async function PermissionDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();

  const adminUser = await getAdminUser();
  if (!adminUser) redirect(`/vendor/login?next=/admin/permissions/${id}`);

  const ctx = { db, companyId: adminUser.companyId };
  const permission = await getPermissionById(parsed.data, ctx);
  if (!permission) notFound();

  // 自社 role 紐付け かつ system role でないものだけ編集可。
  const isReadOnly = permission.roleIsSystem || permission.companyId !== adminUser.companyId;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/permissions">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold font-mono">{permission.code}</h1>
            {isReadOnly ? (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                システム標準
              </span>
            ) : null}
          </div>
          <p className="text-sm text-gray-600">権限詳細・編集</p>
        </div>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">詳細情報</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <DetailField label="種別" value={permission.roleIsSystem ? "システム標準" : "テナント"} />
          <DetailField
            label="ロール"
            value={`${permission.roleName ?? "-"} (${permission.roleCode ?? "-"})`}
          />
          <DetailField label="code" value={<span className="font-mono">{permission.code}</span>} />
          <DetailField
            label="resource"
            value={<span className="font-mono">{permission.resource ?? "-"}</span>}
          />
          <DetailField
            label="action"
            value={<span className="font-mono">{permission.action ?? "-"}</span>}
          />
          <DetailField label="作成日時" value={formatDateTime(permission.createdAt)} />
          <DetailField label="更新日時" value={formatDateTime(permission.updatedAt)} />
        </dl>
      </section>

      {isReadOnly ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          この権限はシステム標準ロール配下のため、編集・削除はできません。テナント固有のロールに権限を付与する場合は新規作成してください。
        </section>
      ) : (
        <>
          <form action={updatePermissionAction} className="rounded-md border border-gray-200 bg-white p-6">
            <input name="id" type="hidden" value={permission.id} />
            <h2 className="text-lg font-semibold text-gray-900">編集</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <InputField defaultValue={permission.code} label="code" name="code" required />
              <InputField defaultValue={permission.resource ?? ""} label="resource" name="resource" />
              <InputField defaultValue={permission.action ?? ""} label="action" name="action" />
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
              この権限を物理削除します。同一ロールの他の権限には影響しません。
            </p>
            <form action={deletePermissionAction} className="mt-4">
              <input name="id" type="hidden" value={permission.id} />
              <button
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700"
                type="submit"
              >
                削除する
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
