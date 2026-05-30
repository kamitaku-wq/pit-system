import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { stores } from "@/lib/db/schema/stores";
import { createVehicleAction } from "./actions";

function InputField(props: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
      {props.label}
      <input
        className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        defaultValue={props.defaultValue}
        max={props.max}
        min={props.min}
        name={props.name}
        type={props.type ?? "text"}
      />
    </label>
  );
}

function SelectField(props: { label: string; name: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
      {props.label}
      <select
        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        name={props.name}
      >
        <option value="">未選択</option>
        {props.children}
      </select>
    </label>
  );
}

export default async function NewVehiclePage() {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/vehicles/new");

  const storeOptions = await db
    .select({ id: stores.id, name: stores.name })
    .from(stores)
    .where(eq(stores.companyId, adminUser.companyId));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/vehicles">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">車両 新規作成</h1>
          <p className="text-sm text-gray-600">車両の基本情報を登録します。所有関係は登録後に詳細画面から設定できます。</p>
        </div>
      </div>

      <form action={createVehicleAction} className="rounded-md border border-gray-200 bg-white p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <InputField label="登録番号 (ナンバー)" name="registrationNumber" />
          <InputField label="VIN (車台番号)" name="vin" />
          <InputField label="メーカー" name="maker" />
          <InputField label="車種" name="model" />
          <InputField label="年式" max={2100} min={1900} name="modelYear" type="number" />
          <InputField label="色" name="color" />
          <SelectField label="所属店舗" name="storeId">
            {storeOptions.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Link className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" href="/admin/vehicles">
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
