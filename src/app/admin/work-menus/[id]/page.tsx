import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { listAllWorkCategoriesForSelect } from "@/lib/services/work-categories";
import { getWorkMenuById } from "@/lib/services/work-menus";
import { deleteWorkMenuAction, updateWorkMenuAction } from "./actions";

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

function formatPrice(priceMinor: number): string {
  return `¥${priceMinor.toLocaleString("ja-JP")}`;
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

export default async function WorkMenuDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();

  const adminUser = await getAdminUser();
  if (!adminUser) redirect(`/vendor/login?next=/admin/work-menus/${id}`);

  const ctx = { db, companyId: adminUser.companyId };
  const [menu, categories] = await Promise.all([
    getWorkMenuById(parsed.data, ctx),
    listAllWorkCategoriesForSelect(ctx),
  ]);
  if (!menu) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/work-menus">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{menu.name}</h1>
          <p className="text-sm text-gray-600">作業メニュー詳細・編集</p>
        </div>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">詳細情報</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <DetailField label="メニュー名" value={menu.name} />
          <DetailField label="コード" value={menu.code} />
          <DetailField label="カテゴリ" value={menu.workCategoryName ?? "未分類"} />
          <DetailField label="所要時間" value={`${menu.durationMinutes} 分`} />
          <DetailField label="価格" value={formatPrice(menu.priceMinor)} />
          <DetailField label="状態" value={menu.isActive ? "有効" : "無効"} />
          <DetailField label="作成日時" value={formatDateTime(menu.createdAt)} />
          <DetailField label="更新日時" value={formatDateTime(menu.updatedAt)} />
        </dl>
      </section>

      <form action={updateWorkMenuAction} className="rounded-md border border-gray-200 bg-white p-6">
        <input name="id" type="hidden" value={menu.id} />
        <h2 className="text-lg font-semibold text-gray-900">編集</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <InputField defaultValue={menu.name} label="メニュー名" name="name" required />
          <InputField defaultValue={menu.code} label="コード" name="code" required />
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            カテゴリ
            <select
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue={menu.workCategoryId ?? ""}
              name="workCategoryId"
            >
              <option value="">未分類</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </label>
          <InputField defaultValue={String(menu.durationMinutes)} label="所要時間 (分)" name="durationMinutes" required type="number" />
          <InputField defaultValue={String(menu.priceMinor)} label="価格 (税抜・整数)" name="priceMinor" type="number" />
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            状態
            <select
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue={menu.isActive ? "true" : "false"}
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
        <p className="mt-2 text-sm text-gray-600">この作業メニューを論理削除 (soft delete) します。レーン紐付け等の参照は保持されます。</p>
        <form action={deleteWorkMenuAction} className="mt-4">
          <input name="id" type="hidden" value={menu.id} />
          <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700" type="submit">
            削除する
          </button>
        </form>
      </section>
    </div>
  );
}
