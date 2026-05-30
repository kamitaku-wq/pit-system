import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { customers } from "@/lib/db/schema/customers";
import { statuses } from "@/lib/db/schema/statuses";
import { stores } from "@/lib/db/schema/stores";
import { vehicles } from "@/lib/db/schema/vehicles";
import { workCategories } from "@/lib/db/schema/work_categories";
import { workMenus } from "@/lib/db/schema/work_menus";
import { createServiceTicketAction } from "./actions";

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

function SelectField(props: {
  label: string;
  name: string;
  children: React.ReactNode;
}) {
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

export default async function NewServiceTicketPage() {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/service-tickets/new");

  const [vehicleOptions, customerOptions, storeOptions, statusOptions, categoryOptions, menuOptions] = await Promise.all([
    db
      .select({ id: vehicles.id, registrationNumber: vehicles.registrationNumber, vin: vehicles.vin, model: vehicles.model })
      .from(vehicles)
      .where(eq(vehicles.companyId, adminUser.companyId)),
    db.select({ id: customers.id, fullName: customers.fullName }).from(customers).where(eq(customers.companyId, adminUser.companyId)),
    db.select({ id: stores.id, name: stores.name }).from(stores).where(eq(stores.companyId, adminUser.companyId)),
    db
      .select({ id: statuses.id, name: statuses.name })
      .from(statuses)
      .where(and(eq(statuses.companyId, adminUser.companyId), eq(statuses.statusType, "service"))),
    db.select({ id: workCategories.id, name: workCategories.name }).from(workCategories).where(eq(workCategories.companyId, adminUser.companyId)),
    db.select({ id: workMenus.id, name: workMenus.name }).from(workMenus).where(eq(workMenus.companyId, adminUser.companyId)),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/service-tickets">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">整備伝票 新規作成</h1>
          <p className="text-sm text-gray-600">整備伝票の基本情報を登録します。</p>
        </div>
      </div>

      <form action={createServiceTicketAction} className="rounded-md border border-gray-200 bg-white p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <InputField label="伝票番号" name="ticketNo" />
          <SelectField label="車両" name="vehicleId">
            {vehicleOptions.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.registrationNumber ?? vehicle.vin ?? vehicle.model ?? vehicle.id.slice(0, 8)}
              </option>
            ))}
          </SelectField>
          <SelectField label="顧客" name="customerId">
            {customerOptions.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.fullName}
              </option>
            ))}
          </SelectField>
          <SelectField label="受付店舗" name="storeId">
            {storeOptions.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="ステータス" name="statusId">
            {statusOptions.map((status) => (
              <option key={status.id} value={status.id}>
                {status.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="作業カテゴリ" name="workCategoryId">
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="作業メニュー" name="workMenuId">
            {menuOptions.map((menu) => (
              <option key={menu.id} value={menu.id}>
                {menu.name}
              </option>
            ))}
          </SelectField>
          <InputField defaultValue={0} label="見積金額 (円)" min={0} name="quotedAmountMinor" type="number" />
          <InputField defaultValue={1000} label="税率 (bps)" max={10000} min={0} name="taxRateBps" type="number" />
          <InputField defaultValue="unbilled" label="請求ステータス" name="billingStatus" />
        </div>
        <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-gray-700">
          備考
          <textarea
            className="min-h-28 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            name="notes"
          />
        </label>
        <div className="mt-6 flex justify-end gap-3">
          <Link className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" href="/admin/service-tickets">
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
