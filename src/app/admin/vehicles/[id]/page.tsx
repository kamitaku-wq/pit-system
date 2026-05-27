import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { customers } from "@/lib/db/schema/customers";
import { stores } from "@/lib/db/schema/stores";
import { getVehicleById, listOwnershipsByVehicle } from "@/lib/services/vehicles";
import { deleteVehicleAction, transferOwnershipAction, updateVehicleAction } from "./actions";

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

export default async function VehicleDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();

  const adminUser = await getAdminUser();
  if (!adminUser) redirect(`/vendor/login?next=/admin/vehicles/${id}`);

  const ctx = { db, companyId: adminUser.companyId };

  const [vehicle, ownerships, storeOptions, customerOptions] = await Promise.all([
    getVehicleById(parsed.data, ctx),
    listOwnershipsByVehicle(parsed.data, ctx).catch(() => []),
    db.select({ id: stores.id, name: stores.name }).from(stores).where(eq(stores.companyId, adminUser.companyId)),
    db.select({ id: customers.id, fullName: customers.fullName }).from(customers).where(eq(customers.companyId, adminUser.companyId)),
  ]);
  if (!vehicle) notFound();

  const currentOwner = ownerships.find((row) => row.endsOn === null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/vehicles">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{vehicle.registrationNumber ?? vehicle.vin ?? vehicle.model ?? vehicle.id.slice(0, 8)}</h1>
          <p className="text-sm text-gray-600">車両詳細・編集・所有履歴</p>
        </div>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">詳細情報</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <DetailField label="登録番号" value={vehicle.registrationNumber ?? "-"} />
          <DetailField label="VIN" value={vehicle.vin ?? "-"} />
          <DetailField label="メーカー" value={vehicle.maker ?? "-"} />
          <DetailField label="車種" value={vehicle.model ?? "-"} />
          <DetailField label="年式" value={vehicle.modelYear ?? "-"} />
          <DetailField label="色" value={vehicle.color ?? "-"} />
          <DetailField label="所属店舗" value={vehicle.storeName ?? "-"} />
          <DetailField label="現在のオーナー" value={currentOwner?.customerName ?? "-"} />
          <DetailField label="作成日時" value={formatDateTime(vehicle.createdAt)} />
          <DetailField label="更新日時" value={formatDateTime(vehicle.updatedAt)} />
        </dl>
      </section>

      <form action={updateVehicleAction} className="rounded-md border border-gray-200 bg-white p-6">
        <input name="id" type="hidden" value={vehicle.id} />
        <h2 className="text-lg font-semibold text-gray-900">編集</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <InputField defaultValue={vehicle.registrationNumber ?? ""} label="登録番号 (ナンバー)" name="registrationNumber" />
          <InputField defaultValue={vehicle.vin ?? ""} label="VIN (車台番号)" name="vin" />
          <InputField defaultValue={vehicle.maker ?? ""} label="メーカー" name="maker" />
          <InputField defaultValue={vehicle.model ?? ""} label="車種" name="model" />
          <InputField defaultValue={vehicle.modelYear ?? ""} label="年式" max={2100} min={1900} name="modelYear" type="number" />
          <InputField defaultValue={vehicle.color ?? ""} label="色" name="color" />
          <SelectField defaultValue={vehicle.storeId} label="所属店舗" name="storeId">
            {storeOptions.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="mt-6 flex justify-end">
          <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700" type="submit">
            保存する
          </button>
        </div>
      </form>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">所有履歴</h2>
        {ownerships.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">所有履歴はまだ登録されていません。下の譲渡フォームから登録してください。</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-200">
            {ownerships.map((own) => (
              <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between" key={own.id}>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-gray-900">
                    {own.customerName ?? "(不明)"}
                    {own.endsOn === null ? (
                      <span className="ml-2 inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">現所有</span>
                    ) : null}
                    {own.isPrimary ? (
                      <span className="ml-2 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">primary</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-gray-500">
                    {own.startsOn} 〜 {own.endsOn ?? "現在"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form action={transferOwnershipAction} className="mt-6 border-t border-gray-200 pt-6">
          <input name="vehicleId" type="hidden" value={vehicle.id} />
          <h3 className="text-base font-semibold text-gray-900">所有者を譲渡</h3>
          <p className="mt-1 text-sm text-gray-600">
            既存の現所有 (ends_on が空) はすべて本日付で終了し、新しい所有関係が作成されます。
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <SelectField defaultValue={null} label="新しい所有者" name="customerId">
              {customerOptions.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.fullName}
                </option>
              ))}
            </SelectField>
            <InputField label="開始日 (YYYY-MM-DD、空欄で本日)" name="startsOn" />
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input defaultChecked name="isPrimary" type="checkbox" value="true" />
              primary 所有者にする
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700" type="submit">
              譲渡を実行
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-md border border-red-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-red-700">削除</h2>
        <p className="mt-2 text-sm text-gray-600">この車両を論理削除 (soft delete) します。所有履歴と整備伝票への参照は保持されます。</p>
        <form action={deleteVehicleAction} className="mt-4">
          <input name="id" type="hidden" value={vehicle.id} />
          <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700" type="submit">
            削除する
          </button>
        </form>
      </section>
    </div>
  );
}
