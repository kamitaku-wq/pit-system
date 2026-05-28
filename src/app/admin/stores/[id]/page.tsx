import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { getStoreById } from "@/lib/services/stores";
import { deleteStoreAction, updateStoreAction } from "./actions";

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

export default async function StoreDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();

  const adminUser = await getAdminUser();
  if (!adminUser) redirect(`/vendor/login?next=/admin/stores/${id}`);

  const ctx = { db, companyId: adminUser.companyId };
  const store = await getStoreById(parsed.data, ctx);
  if (!store) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/stores">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{store.name}</h1>
          <p className="text-sm text-gray-600">店舗詳細・編集</p>
        </div>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">詳細情報</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <DetailField label="店舗名" value={store.name} />
          <DetailField label="店舗コード" value={store.code ?? "-"} />
          <DetailField label="郵便番号" value={store.postalCode ?? "-"} />
          <DetailField label="住所" value={store.address ?? "-"} />
          <DetailField label="電話番号" value={store.phone ?? "-"} />
          <DetailField label="状態" value={store.isActive ? "有効" : "無効"} />
          <DetailField label="作成日時" value={formatDateTime(store.createdAt)} />
          <DetailField label="更新日時" value={formatDateTime(store.updatedAt)} />
        </dl>
      </section>

      <form action={updateStoreAction} className="rounded-md border border-gray-200 bg-white p-6">
        <input name="id" type="hidden" value={store.id} />
        <h2 className="text-lg font-semibold text-gray-900">編集</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <InputField defaultValue={store.name} label="店舗名" name="name" required />
          <InputField defaultValue={store.code ?? ""} label="店舗コード" name="code" />
          <InputField defaultValue={store.postalCode ?? ""} label="郵便番号" name="postalCode" />
          <InputField defaultValue={store.address ?? ""} label="住所" name="address" />
          <InputField defaultValue={store.phone ?? ""} label="電話番号" name="phone" type="tel" />
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            状態
            <select
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue={store.isActive ? "true" : "false"}
              name="isActive"
            >
              <option value="true">有効</option>
              <option value="false">無効</option>
            </select>
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
        <p className="mt-2 text-sm text-gray-600">この店舗を論理削除 (soft delete) します。所属するレーンや営業時間設定への参照は保持されます。</p>
        <form action={deleteStoreAction} className="mt-4">
          <input name="id" type="hidden" value={store.id} />
          <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700" type="submit">
            削除する
          </button>
        </form>
      </section>
    </div>
  );
}
