import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { listVendorAvailableDaysByVendorId } from "@/lib/services/vendor-available-days";
import {
  listStoreIdsByVendorId,
  listStoresForVendorSelect,
} from "@/lib/services/vendor-available-stores";
import { listVendorSlaOverridesByVendorId } from "@/lib/services/vendor-sla-overrides";
import { getVendorById } from "@/lib/services/vendors";
import {
  createSlaOverrideAction,
  deleteSlaOverrideAction,
  deleteVendorAction,
  replaceAvailableDaysAction,
  replaceAvailableStoresAction,
  updateSlaOverrideAction,
  updateVendorAction,
} from "./actions";

type PageProps = { params: Promise<{ id: string }> };

const uuidSchema = z.string().uuid();

const dayLabels = ["日", "月", "火", "水", "木", "金", "土"];

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

function InputField(props: { label: string; name: string; type?: string; defaultValue?: string | number; required?: boolean }) {
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

function formatTimeShort(value: string | null): string {
  if (!value) return "";
  // PG time は "HH:MM:SS" 形式で返るので HH:MM に短縮
  return value.slice(0, 5);
}

export default async function VendorDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();

  const adminUser = await getAdminUser();
  if (!adminUser) redirect(`/vendor/login?next=/admin/vendors/${id}`);

  const ctx = { db, companyId: adminUser.companyId };

  const [vendor, availableDays, storeOptions, selectedStoreIds, slaOverrides] = await Promise.all([
    getVendorById(parsed.data, ctx),
    listVendorAvailableDaysByVendorId(parsed.data, ctx).catch(() => []),
    listStoresForVendorSelect(ctx),
    listStoreIdsByVendorId(parsed.data, ctx).catch(() => [] as string[]),
    listVendorSlaOverridesByVendorId(parsed.data, ctx).catch(() => []),
  ]);
  if (!vendor) notFound();
  const selectedStoreSet = new Set(selectedStoreIds);
  const overriddenStoreSet = new Set(slaOverrides.map((row) => row.storeId).filter((id): id is string => id !== null));
  const remainingStoresForSla = storeOptions.filter((store) => !overriddenStoreSet.has(store.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/vendors">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{vendor.name}</h1>
          <p className="text-sm text-gray-600">業者詳細・編集・対応曜日</p>
        </div>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">詳細情報</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <DetailField label="業者名" value={vendor.name} />
          <DetailField label="担当者名" value={vendor.contactPersonName ?? "-"} />
          <DetailField label="メール" value={vendor.email ?? "-"} />
          <DetailField label="電話番号" value={vendor.phone ?? "-"} />
          <DetailField
            label="通知方法"
            value={
              vendor.notificationMethod === "both"
                ? "メール + ポータル"
                : vendor.notificationMethod === "email"
                  ? "メールのみ"
                  : "ポータルのみ"
            }
          />
          <DetailField label="業者種別" value={vendor.isShared ? "共有" : "専属"} />
          <DetailField label="優先度" value={vendor.priority ?? "-"} />
          <DetailField label="表示順" value={vendor.displayOrder ?? "-"} />
          <DetailField label="作成日時" value={formatDateTime(vendor.createdAt)} />
          <DetailField label="更新日時" value={formatDateTime(vendor.updatedAt)} />
        </dl>
        {vendor.notes ? (
          <div className="mt-4">
            <dt className="text-xs font-medium text-gray-500">メモ</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-900">{vendor.notes}</dd>
          </div>
        ) : null}
      </section>

      <form action={updateVendorAction} className="rounded-md border border-gray-200 bg-white p-6">
        <input name="id" type="hidden" value={vendor.id} />
        <h2 className="text-lg font-semibold text-gray-900">編集</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <InputField defaultValue={vendor.name} label="業者名" name="name" required />
          <InputField defaultValue={vendor.contactPersonName ?? ""} label="担当者名" name="contactPersonName" />
          <InputField defaultValue={vendor.email ?? ""} label="メール" name="email" type="email" />
          <InputField defaultValue={vendor.phone ?? ""} label="電話番号" name="phone" type="tel" />
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            通知方法
            <select
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue={vendor.notificationMethod}
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
              defaultValue={vendor.isShared ? "true" : "false"}
              name="isShared"
            >
              <option value="false">専属</option>
              <option value="true">共有</option>
            </select>
          </label>
          <InputField defaultValue={vendor.priority ?? 0} label="優先度" name="priority" type="number" />
          <InputField defaultValue={vendor.displayOrder ?? 0} label="表示順" name="displayOrder" type="number" />
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700 md:col-span-2">
            メモ
            <textarea
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue={vendor.notes ?? ""}
              name="notes"
              rows={3}
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end">
          <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700" type="submit">
            保存する
          </button>
        </div>
      </form>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">対応曜日 / 時間帯</h2>
        <p className="mt-1 text-sm text-gray-600">
          各曜日ごとに対応可能な時間帯を 0 件以上登録できます (空欄で終日)。保存時に既存設定を全て置き換えます。
        </p>

        <form action={replaceAvailableDaysAction} className="mt-4">
          <input name="vendorId" type="hidden" value={vendor.id} />
          <div className="space-y-3">
            {dayLabels.map((label, dayOfWeek) => {
              const rowsForDay = availableDays.filter((row) => row.dayOfWeek === dayOfWeek);
              const renderRows = rowsForDay.length > 0 ? rowsForDay : [{ id: "new", dayOfWeek, startsAt: null, endsAt: null }];
              return (
                <div className="rounded-md border border-gray-200 p-3" key={dayOfWeek}>
                  <div className="text-sm font-medium text-gray-700">{label}曜日</div>
                  <div className="mt-2 space-y-2">
                    {renderRows.map((row, idx) => (
                      <div className="flex flex-wrap items-center gap-3" key={`${dayOfWeek}-${idx}`}>
                        <label className="flex items-center gap-2 text-xs text-gray-600">
                          開始
                          <input
                            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                            defaultValue={formatTimeShort(row.startsAt)}
                            name={`day_${dayOfWeek}_starts_${idx}`}
                            type="time"
                          />
                        </label>
                        <label className="flex items-center gap-2 text-xs text-gray-600">
                          終了
                          <input
                            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                            defaultValue={formatTimeShort(row.endsAt)}
                            name={`day_${dayOfWeek}_ends_${idx}`}
                            type="time"
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-gray-500">
            ※ MVP 版は曜日ごとに 1 時間帯のみ編集できます。複数時間帯への対応は将来拡張です。
          </p>
          <div className="mt-4 flex justify-end">
            <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700" type="submit">
              対応曜日を保存
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">対応可能店舗</h2>
        <p className="mt-1 text-sm text-gray-600">
          この業者が対応可能な店舗を選択します。保存時に既存設定を全て置き換えます。
        </p>
        {storeOptions.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">登録されている店舗がありません。</p>
        ) : (
          <form action={replaceAvailableStoresAction} className="mt-4">
            <input name="vendorId" type="hidden" value={vendor.id} />
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {storeOptions.map((store) => (
                <label className="flex items-center gap-2 text-sm text-gray-700" key={store.id}>
                  <input
                    defaultChecked={selectedStoreSet.has(store.id)}
                    name="storeIds"
                    type="checkbox"
                    value={store.id}
                  />
                  <span>
                    {store.name}
                    {store.code ? <span className="ml-1 text-xs text-gray-500">({store.code})</span> : null}
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700" type="submit">
                対応店舗を保存
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">SLA 上書き</h2>
        <p className="mt-1 text-sm text-gray-600">
          店舗別に応答期限・引取期限 (分) を上書きできます。空欄ならデフォルト値を使用します。
        </p>

        {slaOverrides.length > 0 ? (
          <ul className="mt-4 divide-y divide-gray-200">
            {slaOverrides.map((row) => (
              <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-end sm:gap-4" key={row.id}>
                <div className="text-sm font-medium text-gray-900 sm:w-48">{row.storeName ?? "(店舗不明)"}</div>
                <form action={updateSlaOverrideAction} className="flex flex-wrap items-end gap-3">
                  <input name="vendorId" type="hidden" value={vendor.id} />
                  <input name="overrideId" type="hidden" value={row.id} />
                  <InputField defaultValue={row.responseDeadlineMinutes ?? ""} label="応答期限(分)" name="responseDeadlineMinutes" type="number" />
                  <InputField defaultValue={row.pickupDeadlineMinutes ?? ""} label="引取期限(分)" name="pickupDeadlineMinutes" type="number" />
                  <button className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50" type="submit">
                    更新
                  </button>
                </form>
                <form action={deleteSlaOverrideAction}>
                  <input name="vendorId" type="hidden" value={vendor.id} />
                  <input name="overrideId" type="hidden" value={row.id} />
                  <button className="rounded-md border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-700 shadow-sm hover:bg-red-50" type="submit">
                    削除
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}

        {remainingStoresForSla.length > 0 ? (
          <form action={createSlaOverrideAction} className="mt-6 border-t border-gray-200 pt-6">
            <input name="vendorId" type="hidden" value={vendor.id} />
            <h3 className="text-base font-semibold text-gray-900">SLA 上書きを追加</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                対象店舗
                <select
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  defaultValue=""
                  name="storeId"
                  required
                >
                  <option disabled value="">
                    店舗を選択
                  </option>
                  {remainingStoresForSla.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>
              <InputField label="応答期限(分)" name="responseDeadlineMinutes" type="number" />
              <InputField label="引取期限(分)" name="pickupDeadlineMinutes" type="number" />
            </div>
            <div className="mt-4 flex justify-end">
              <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700" type="submit">
                追加する
              </button>
            </div>
          </form>
        ) : storeOptions.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">登録されている店舗がありません。</p>
        ) : (
          <p className="mt-4 text-sm text-gray-500">全店舗の SLA 上書きが登録済みです。</p>
        )}
      </section>

      <section className="rounded-md border border-red-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-red-700">削除</h2>
        <p className="mt-2 text-sm text-gray-600">この業者を論理削除 (soft delete) します。既存の依頼・通知履歴への参照は保持されます。</p>
        <form action={deleteVendorAction} className="mt-4">
          <input name="id" type="hidden" value={vendor.id} />
          <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700" type="submit">
            削除する
          </button>
        </form>
      </section>
    </div>
  );
}
