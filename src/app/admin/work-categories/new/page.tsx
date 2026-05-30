import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { createWorkCategoryAction } from "./actions";

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

export default async function NewWorkCategoryPage() {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/work-categories/new");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/work-categories">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">作業カテゴリ 新規作成</h1>
          <p className="text-sm text-gray-600">作業カテゴリの基本情報を登録します。</p>
        </div>
      </div>

      <form action={createWorkCategoryAction} className="rounded-md border border-gray-200 bg-white p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <InputField label="カテゴリ名" name="name" required />
          <InputField label="コード" name="code" required />
          <InputField defaultValue="0" label="表示順" name="sortOrder" type="number" />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Link className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" href="/admin/work-categories">
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
