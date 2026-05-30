import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";

import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { stores } from "@/lib/db/schema/stores";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendorCompanyMemberships } from "@/lib/db/schema/vendor_company_memberships";
import { vendors } from "@/lib/db/schema/vendors";
import { createTransportOrderAction } from "./actions";

function SelectField(props: {
  label: string;
  name: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
      {props.label}
      {props.required ? <span className="text-red-500"> *</span> : null}
      <select
        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        name={props.name}
        required={props.required}
        defaultValue=""
      >
        <option value="">未選択</option>
        {props.children}
      </select>
    </label>
  );
}

function DateTimeField(props: { label: string; name: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
      {props.label}
      <input
        className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        name={props.name}
        type="datetime-local"
      />
    </label>
  );
}

export default async function NewTransportOrderPage() {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/transport-orders/new");

  const [ticketOptions, vehicleOptions, vendorOptions, storeOptions] = await Promise.all([
    db
      .select({ id: serviceTickets.id, ticketNo: serviceTickets.ticketNo })
      .from(serviceTickets)
      .where(eq(serviceTickets.companyId, adminUser.companyId)),
    db
      .select({
        id: vehicles.id,
        registrationNumber: vehicles.registrationNumber,
        vin: vehicles.vin,
        maker: vehicles.maker,
        model: vehicles.model,
      })
      .from(vehicles)
      .where(and(eq(vehicles.companyId, adminUser.companyId), isNull(vehicles.deletedAt))),
    // active membership を持つ業者のみ (createTransportOrderWithNotification の membership 検証と同条件)。
    db
      .select({ id: vendors.id, name: vendors.name })
      .from(vendorCompanyMemberships)
      .innerJoin(vendors, eq(vendors.id, vendorCompanyMemberships.vendorId))
      .where(
        and(
          eq(vendorCompanyMemberships.companyId, adminUser.companyId),
          eq(vendorCompanyMemberships.isEnabled, true),
          isNull(vendorCompanyMemberships.deletedAt),
          eq(vendors.isActive, true),
          isNull(vendors.deletedAt),
        ),
      )
      .orderBy(vendors.name),
    db
      .select({ id: stores.id, name: stores.name })
      .from(stores)
      .where(eq(stores.companyId, adminUser.companyId)),
  ]);

  function vehicleLabel(v: {
    id: string;
    registrationNumber: string | null;
    vin: string | null;
    maker: string | null;
    model: string | null;
  }): string {
    return (
      v.registrationNumber ??
      [v.maker, v.model].filter(Boolean).join(" ") ||
      v.vin ||
      v.id.slice(0, 8)
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/transport-orders">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">陸送依頼 新規作成</h1>
          <p className="text-sm text-gray-600">
            店間移動が発生する整備の陸送・回送依頼を作成し、業者へ通知します。
          </p>
        </div>
      </div>

      {vendorOptions.length === 0 ? (
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          有効な業者が登録されていません。先に業者マスターで業者を登録・有効化してください。
        </p>
      ) : null}

      <form
        action={createTransportOrderAction}
        className="rounded-md border border-gray-200 bg-white p-6"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="整備伝票" name="serviceTicketId" required>
            {ticketOptions.map((ticket) => (
              <option key={ticket.id} value={ticket.id}>
                {ticket.ticketNo ?? ticket.id.slice(0, 8)}
              </option>
            ))}
          </SelectField>
          <SelectField label="車両" name="vehicleId" required>
            {vehicleOptions.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicleLabel(vehicle)}
              </option>
            ))}
          </SelectField>
          <SelectField label="業者" name="vendorId" required>
            {vendorOptions.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="移動パターン" name="movementType" required>
            <option value="one_way">片道 (引取→納車)</option>
            <option value="round_trip">往復 (引取→納車→返却)</option>
            <option value="pickup_only">引取のみ</option>
            <option value="three_point">三点移動 (引取・納車・返却すべて異なる)</option>
          </SelectField>
          <SelectField label="引取店舗" name="pickupStoreId">
            {storeOptions.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="納車店舗" name="deliveryStoreId">
            {storeOptions.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="返却店舗" name="returnStoreId">
            {storeOptions.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </SelectField>
          <DateTimeField label="引取希望日時" name="requestedPickupAt" />
          <DateTimeField label="納車希望日時" name="requestedDeliveryAt" />
          <DateTimeField label="返却希望日時" name="requestedReturnAt" />
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm font-medium text-gray-700">
          <input defaultChecked name="canDrive" type="checkbox" />
          自走可能 (チェックを外すとレッカー必須として業者へ通知)
        </label>

        <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-gray-700">
          備考
          <textarea
            className="min-h-28 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            name="notes"
          />
        </label>

        <div className="mt-6 flex justify-end gap-3">
          <Link
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            href="/admin/transport-orders"
          >
            キャンセル
          </Link>
          <button
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            type="submit"
            disabled={vendorOptions.length === 0}
          >
            依頼を作成して業者へ通知
          </button>
        </div>
      </form>
    </div>
  );
}
