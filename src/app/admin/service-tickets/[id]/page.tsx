import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { customers } from "@/lib/db/schema/customers";
import { statuses } from "@/lib/db/schema/statuses";
import { stores } from "@/lib/db/schema/stores";
import { vehicles } from "@/lib/db/schema/vehicles";
import { workCategories } from "@/lib/db/schema/work_categories";
import { workMenus } from "@/lib/db/schema/work_menus";
import { getServiceTicketById } from "@/lib/services/service-tickets";
import { deleteServiceTicketAction, updateServiceTicketAction } from "./actions";

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

function InputField(props: { label: string; name: string; type?: string; defaultValue?: string | number; min?: number; max?: number }) {
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

function SelectField(props: { label: string; name: string; defaultValue: string | null; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
      {props.label}
      <select
        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        defaultValue={props.defaultValue ?? ""}
        name={props.name}
      >
        <option value="">未選択</option>
        {props.children}
      </select>
    </label>
  );
}

export default async function ServiceTicketDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();

  const adminUser = await getAdminUser();
  if (!adminUser) redirect(`/vendor/login?next=/admin/service-tickets/${id}`);

  const [ticket, vehicleOptions, customerOptions, storeOptions, statusOptions, categoryOptions, menuOptions] = await Promise.all([
    getServiceTicketById(parsed.data, { db, companyId: adminUser.companyId }),
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
  if (!ticket) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/service-tickets">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{ticket.ticketNo ?? ticket.id.slice(0, 8)}</h1>
          <p className="text-sm text-gray-600">整備伝票詳細・編集</p>
        </div>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">詳細情報</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <DetailField label="車両" value={ticket.vehicleLabel ?? "-"} />
          <DetailField label="顧客" value={ticket.customerName ?? "-"} />
          <DetailField label="店舗" value={ticket.storeName ?? "-"} />
          <DetailField label="ステータス" value={ticket.statusName ?? "-"} />
          <DetailField label="作業カテゴリ" value={ticket.workCategoryName ?? "-"} />
          <DetailField label="作業メニュー" value={ticket.workMenuName ?? "-"} />
          <DetailField label="請求ステータス" value={ticket.billingStatus} />
          <DetailField label="作成日時" value={formatDateTime(ticket.createdAt)} />
          <DetailField label="更新日時" value={formatDateTime(ticket.updatedAt)} />
        </dl>
      </section>

      <form action={updateServiceTicketAction} className="rounded-md border border-gray-200 bg-white p-6">
        <input name="id" type="hidden" value={ticket.id} />
        <h2 className="text-lg font-semibold text-gray-900">編集</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <InputField defaultValue={ticket.ticketNo ?? ""} label="伝票番号" name="ticketNo" />
          <SelectField defaultValue={ticket.vehicleId} label="車両" name="vehicleId">
            {vehicleOptions.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.registrationNumber ?? vehicle.vin ?? vehicle.model ?? vehicle.id.slice(0, 8)}
              </option>
            ))}
          </SelectField>
          <SelectField defaultValue={ticket.customerId} label="顧客" name="customerId">
            {customerOptions.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.fullName}
              </option>
            ))}
          </SelectField>
          <SelectField defaultValue={ticket.storeId} label="受付店舗" name="storeId">
            {storeOptions.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </SelectField>
          <SelectField defaultValue={ticket.statusId} label="ステータス" name="statusId">
            {statusOptions.map((status) => (
              <option key={status.id} value={status.id}>
                {status.name}
              </option>
            ))}
          </SelectField>
          <SelectField defaultValue={ticket.workCategoryId} label="作業カテゴリ" name="workCategoryId">
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </SelectField>
          <SelectField defaultValue={ticket.workMenuId} label="作業メニュー" name="workMenuId">
            {menuOptions.map((menu) => (
              <option key={menu.id} value={menu.id}>
                {menu.name}
              </option>
            ))}
          </SelectField>
          <InputField defaultValue={ticket.quotedAmountMinor} label="見積金額 (円)" min={0} name="quotedAmountMinor" type="number" />
          <InputField defaultValue={ticket.taxRateBps} label="税率 (bps)" max={10000} min={0} name="taxRateBps" type="number" />
          <InputField defaultValue={ticket.billingStatus} label="請求ステータス" name="billingStatus" />
        </div>
        <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-gray-700">
          備考
          <textarea
            className="min-h-28 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            defaultValue={ticket.notes ?? ""}
            name="notes"
          />
        </label>
        <div className="mt-6 flex justify-end">
          <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700" type="submit">
            保存する
          </button>
        </div>
      </form>

      <section className="rounded-md border border-red-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-red-700">削除</h2>
        <p className="mt-2 text-sm text-gray-600">この整備伝票を削除します。関連する陸送依頼がある場合、データベース制約により削除できません。</p>
        <form action={deleteServiceTicketAction} className="mt-4">
          <input name="id" type="hidden" value={ticket.id} />
          <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700" type="submit">
            削除する
          </button>
        </form>
      </section>
    </div>
  );
}
