import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { createVendorAction } from "./actions";

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

export default async function NewVendorPage() {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/vendors/new");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/vendors">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">業者 新規作成</h1>
          <p className="text-sm text-gray-600">陸送・外注業者の基本情報を登録します。</p>
        </div>
      </div>

      <form action={createVendorAction} className="rounded-md border border-gray-200 bg-white p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <InputField label="業者名" name="name" required />
          <InputField label="担当者名" name="contactPersonName" />
          <InputField label="メールアドレス" name="email" type="email" />
          <InputField label="電話番号" name="phone" type="tel" />
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            通知方法
            <select
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue="both"
              name="notificationMethod"
            >
              <option value="both">メール + ポータル</option>
              <option value="email">メールのみ</option>
              <option value="portal">ポータルのみ</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            業者種別
            <select
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue="false"
              name="isShared"
            >
              <option value="false">専属</option>
              <option value="true">共有 (複数販社対応)</option>
            </select>
          </label>
          <InputField defaultValue="0" label="優先度 (低数値が高優先)" name="priority" type="number" />
          <InputField defaultValue="0" label="表示順" name="displayOrder" type="number" />
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700 md:col-span-2">
            メモ
            <textarea
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              name="notes"
              rows={3}
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Link className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" href="/admin/vendors">
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
