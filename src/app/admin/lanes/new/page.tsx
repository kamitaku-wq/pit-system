import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { listAllLaneTypesForSelect } from "@/lib/services/lane-types";
import { listAllStoresForSelect } from "@/lib/services/stores";
import { createLaneAction } from "./actions";

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

export default async function NewLanePage() {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/lanes/new");

  const ctx = { db, companyId: adminUser.companyId };
  const [storesList, laneTypesList] = await Promise.all([
    listAllStoresForSelect(ctx),
    listAllLaneTypesForSelect(ctx),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/lanes">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">レーン 新規作成</h1>
          <p className="text-sm text-gray-600">店舗内レーンの基本情報を登録します。</p>
        </div>
      </div>

      {storesList.length === 0 ? (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
          レーンを作成するには先に店舗を登録してください。
          <Link className="ml-2 text-yellow-900 underline" href="/admin/stores/new">店舗を登録</Link>
        </div>
      ) : (
        <form action={createLaneAction} className="rounded-md border border-gray-200 bg-white p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              店舗
              <span className="text-xs text-red-600">必須</span>
              <select
                className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                name="storeId"
                required
              >
                {storesList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.code ? ` (${s.code})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <InputField label="レーン名" name="name" required />
            <InputField label="コード" name="code" />
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              種別
              <select
                className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                defaultValue=""
                name="laneTypeId"
              >
                <option value="">未分類</option>
                {laneTypesList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.code})
                  </option>
                ))}
              </select>
            </label>
            <InputField defaultValue="1" label="収容台数" name="capacity" required type="number" />
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              状態
              <select
                className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                defaultValue="true"
                name="isActive"
              >
                <option value="true">有効</option>
                <option value="false">無効</option>
              </select>
            </label>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Link className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" href="/admin/lanes">
              キャンセル
            </Link>
            <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700" type="submit">
              登録する
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
