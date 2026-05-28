import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { createCustomerAction } from "./actions";

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

function TextareaField(props: { label: string; name: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-gray-700 md:col-span-2">
      {props.label}
      <textarea
        className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        name={props.name}
        rows={3}
      />
    </label>
  );
}

export default async function NewCustomerPage() {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/customers/new");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/customers">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">顧客 新規作成</h1>
          <p className="text-sm text-gray-600">顧客の基本情報を登録します。</p>
        </div>
      </div>

      <form action={createCustomerAction} className="rounded-md border border-gray-200 bg-white p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <InputField label="氏名" name="fullName" required />
          <InputField label="氏名 (カナ)" name="fullNameKana" />
          <InputField label="メールアドレス" name="email" type="email" />
          <InputField label="電話番号" name="phone" type="tel" />
          <InputField label="郵便番号" name="postalCode" />
          <InputField label="住所" name="address" />
          <TextareaField label="備考" name="notes" />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Link className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" href="/admin/customers">
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
