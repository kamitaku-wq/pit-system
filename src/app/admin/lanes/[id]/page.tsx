import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { listAllLaneTypesForSelect } from "@/lib/services/lane-types";
import { getLaneById } from "@/lib/services/lanes";
import { deleteLaneAction, updateLaneAction } from "./actions";

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

export default async function LaneDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();

  const adminUser = await getAdminUser();
  if (!adminUser) redirect(`/vendor/login?next=/admin/lanes/${id}`);

  const ctx = { db, companyId: adminUser.companyId };
  const [lane, laneTypesList] = await Promise.all([
    getLaneById(parsed.data, ctx),
    listAllLaneTypesForSelect(ctx),
  ]);
  if (!lane) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-blue-600 hover:underline" href="/admin/lanes">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{lane.name}</h1>
          <p className="text-sm text-gray-600">レーン 詳細・編集</p>
        </div>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">詳細情報</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <DetailField label="レーン名" value={lane.name} />
          <DetailField label="コード" value={lane.code ?? "—"} />
          <DetailField label="店舗" value={lane.storeName ?? "—"} />
          <DetailField label="種別" value={lane.laneTypeName ?? "未分類"} />
          <DetailField label="収容台数" value={lane.capacity} />
          <DetailField label="状態" value={lane.isActive ? "有効" : "無効"} />
          <DetailField label="作成日時" value={formatDateTime(lane.createdAt)} />
          <DetailField label="更新日時" value={formatDateTime(lane.updatedAt)} />
        </dl>
        <p className="mt-4 text-xs text-gray-500">店舗の変更はできません。店舗を変更したい場合は、新しいレーンを作成して旧レーンを削除してください。</p>
      </section>

      <form action={updateLaneAction} className="rounded-md border border-gray-200 bg-white p-6">
        <input name="id" type="hidden" value={lane.id} />
        <h2 className="text-lg font-semibold text-gray-900">編集</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <InputField defaultValue={lane.name} label="レーン名" name="name" required />
          <InputField defaultValue={lane.code ?? ""} label="コード" name="code" />
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            種別
            <select
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue={lane.laneTypeId ?? ""}
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
          <InputField defaultValue={String(lane.capacity)} label="収容台数" name="capacity" required type="number" />
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            状態
            <select
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue={lane.isActive ? "true" : "false"}
              name="isActive"
            >
              <option value="true">有効</option>
              <option value="false">無効</option>
            </select>
          </label>
        </div>
        <div className="mt-6 flex justify-end">
          <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700" type="submit">
            保存する
          </button>
        </div>
      </form>

      <section className="rounded-md border border-red-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-red-700">削除</h2>
        <p className="mt-2 text-sm text-gray-600">このレーンを論理削除 (soft delete) します。関連する稼働実績・予約参照は保持されます。</p>
        <form action={deleteLaneAction} className="mt-4">
          <input name="id" type="hidden" value={lane.id} />
          <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700" type="submit">
            削除する
          </button>
        </form>
      </section>
    </div>
  );
}
