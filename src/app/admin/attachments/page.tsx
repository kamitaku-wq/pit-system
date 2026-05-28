import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import {
  type AttachmentListFilters,
  listAttachments,
  PARENT_TYPES,
  type ParentType,
} from "@/lib/services/attachments";

type PageProps = {
  searchParams: Promise<{
    page?: string | string[];
    parentType?: string | string[];
    parentId?: string | string[];
    uploadedByUserId?: string | string[];
    includeDeleted?: string | string[];
  }>;
};

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function parsePage(value: string): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function formatDateTime(value: Date): string {
  return dateFormatter.format(value);
}

function asParentType(value: string): ParentType | undefined {
  return (PARENT_TYPES as readonly string[]).includes(value)
    ? (value as ParentType)
    : undefined;
}

function parentRefLabel(row: {
  serviceTicketId: string | null;
  reservationId: string | null;
  transportOrderId: string | null;
}): { type: string; id: string } | null {
  if (row.serviceTicketId) return { type: "service_ticket", id: row.serviceTicketId };
  if (row.reservationId) return { type: "reservation", id: row.reservationId };
  if (row.transportOrderId) return { type: "transport_order", id: row.transportOrderId };
  return null;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

const filterAsListFilters: (form: {
  parentType?: ParentType;
  parentId?: string;
  uploadedByUserId?: string;
  includeDeleted?: boolean;
  page?: number;
}) => AttachmentListFilters = (form) => form;

export default async function AdminAttachmentsPage({ searchParams }: PageProps) {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/vendor/login?next=/admin/attachments");

  const params = await searchParams;
  const page = parsePage(firstValue(params.page));
  const parentTypeRaw = firstValue(params.parentType);
  const parentIdRaw = firstValue(params.parentId).trim();
  const uploadedByUserIdRaw = firstValue(params.uploadedByUserId).trim();
  const includeDeletedRaw = firstValue(params.includeDeleted);

  const parentType = asParentType(parentTypeRaw);
  const includeDeleted = includeDeletedRaw === "1";

  const { rows, total } = await listAttachments(
    filterAsListFilters({
      page,
      parentType: parentType && parentIdRaw ? parentType : undefined,
      parentId: parentType && parentIdRaw ? parentIdRaw : undefined,
      uploadedByUserId: uploadedByUserIdRaw || undefined,
      includeDeleted,
    }),
    { db, companyId: adminUser.companyId },
  );

  const limit = 50;
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  const searchBase = new URLSearchParams();
  if (parentType) searchBase.set("parentType", parentType);
  if (parentIdRaw) searchBase.set("parentId", parentIdRaw);
  if (uploadedByUserIdRaw) searchBase.set("uploadedByUserId", uploadedByUserIdRaw);
  if (includeDeleted) searchBase.set("includeDeleted", "1");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">添付ファイル (attachments) 管理</h1>
        <p className="text-sm text-gray-600">
          整備伝票 / 予約 / 店間移動指示への添付ファイルメタデータの一覧です。アップロード本体は将来の
          Phase 4 統合で Supabase Storage 連携経由で実施されます。当画面はメタデータ閲覧・失効
          (soft delete) のみを提供します。
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          親種別
          <select
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            defaultValue={parentType ?? ""}
            name="parentType"
          >
            <option value="">すべて</option>
            <option value="service_ticket">整備伝票</option>
            <option value="reservation">予約</option>
            <option value="transport_order">店間移動</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          親 ID (任意)
          <input
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono"
            defaultValue={parentIdRaw}
            name="parentId"
            placeholder="親種別と組み合わせて指定"
            type="text"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          アップロード者 user ID
          <input
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono"
            defaultValue={uploadedByUserIdRaw}
            name="uploadedByUserId"
            placeholder="UUID"
            type="text"
          />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            defaultChecked={includeDeleted}
            name="includeDeleted"
            type="checkbox"
            value="1"
          />
          失効済みも含める
        </label>
        <button
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          type="submit"
        >
          絞り込む
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
          該当する添付ファイルがありません。
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {[
                    "状態",
                    "ID",
                    "親種別",
                    "親 ID",
                    "ファイル名",
                    "サイズ",
                    "MIME",
                    "登録日時",
                  ].map((heading) => (
                    <th
                      className="px-4 py-3 text-left font-medium text-gray-700"
                      key={heading}
                      scope="col"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {rows.map((r) => {
                  const parent = parentRefLabel(r);
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-4 py-4">
                        {r.deletedAt ? (
                          <span className="inline-flex items-center rounded-full bg-gray-300 px-2 py-0.5 text-xs font-medium text-gray-800">
                            失効
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                            有効
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-gray-700">
                        <Link
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                          href={`/admin/attachments/${r.id}`}
                        >
                          {r.id.slice(0, 8)}…
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                        {parent?.type ?? "-"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-gray-700">
                        {parent ? `${parent.id.slice(0, 8)}…` : "-"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                        {r.fileName}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                        {formatBytes(r.byteSize)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                        {r.contentType ?? "-"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                        {formatDateTime(r.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>
          {total} 件中 {rows.length} 件表示
        </span>
        <div className="flex gap-2">
          {page > 1 ? (
            <Link
              className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50"
              href={`/admin/attachments?${new URLSearchParams({ ...Object.fromEntries(searchBase), page: String(page - 1) })}`}
            >
              前へ
            </Link>
          ) : null}
          {page < totalPages ? (
            <Link
              className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50"
              href={`/admin/attachments?${new URLSearchParams({ ...Object.fromEntries(searchBase), page: String(page + 1) })}`}
            >
              次へ
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
