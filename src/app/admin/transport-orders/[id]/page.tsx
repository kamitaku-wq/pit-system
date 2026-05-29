import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";

import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { getTransportOrderDetail } from "@/lib/services/transport-orders";
import { cancelTransportOrderAction, confirmTransportOrderAction } from "./actions";

type PageProps = { params: Promise<{ id: string }> };

type BadgeConfig = {
  className: string;
  label: string;
};

const uuidSchema = z.string().uuid();

const movementTypeLabels: Record<string, string> = {
  one_way: "片道",
  round_trip: "往復",
  pickup_only: "引取のみ",
  three_point: "三点移動",
};

const vendorResponseBadges: Record<string, BadgeConfig> = {
  pending: {
    className: "bg-yellow-100 text-yellow-800",
    label: "対応待ち",
  },
  accepted: {
    className: "bg-green-100 text-green-800",
    label: "対応可",
  },
  rejected: {
    className: "bg-red-100 text-red-800",
    label: "対応不可",
  },
};

const invitationResponseBadges: Record<string, BadgeConfig> = {
  pending: {
    className: "bg-yellow-100 text-yellow-800",
    label: "招待中",
  },
  accepted: {
    className: "bg-green-100 text-green-800",
    label: "受諾",
  },
  rejected: {
    className: "bg-red-100 text-red-800",
    label: "辞退",
  },
  revoked: {
    className: "bg-gray-100 text-gray-700",
    label: "取消",
  },
  expired: {
    className: "bg-gray-100 text-gray-700",
    label: "期限切れ",
  },
};

const notificationStatusBadges: Record<string, BadgeConfig> = {
  pending: {
    label: "通知前",
    className: "bg-yellow-100 text-yellow-800",
  },
  processing: {
    label: "送信中",
    className: "bg-blue-100 text-blue-800",
  },
  sent: {
    label: "送信済",
    className: "bg-green-100 text-green-800",
  },
  failed: {
    label: "失敗",
    className: "bg-red-100 text-red-800",
  },
  cancelled: {
    label: "中止",
    className: "bg-gray-100 text-gray-700",
  },
};

const noInvitationBadge: BadgeConfig = {
  className: "bg-gray-100 text-gray-700",
  label: "招待なし",
};

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function getMovementTypeLabel(movementType: string): string {
  return movementTypeLabels[movementType] ?? movementType;
}

function getStatusBadge(status: string): BadgeConfig {
  return {
    className: "bg-blue-100 text-blue-800",
    label: status,
  };
}

function getVendorResponseBadge(response: string | null): BadgeConfig | null {
  if (!response) {
    return null;
  }

  return (
    vendorResponseBadges[response] ?? {
      className: "bg-gray-100 text-gray-700",
      label: response,
    }
  );
}

function getInvitationResponseBadge(response: string | null): BadgeConfig {
  if (!response) {
    return noInvitationBadge;
  }

  return (
    invitationResponseBadges[response] ?? {
      className: "bg-gray-100 text-gray-700",
      label: response,
    }
  );
}

function getNotificationStatusBadge(status: string): BadgeConfig {
  return (
    notificationStatusBadges[status] ?? {
      className: "bg-gray-100 text-gray-700",
      label: status,
    }
  );
}

function formatDateTime(value: Date | string | null): string {
  if (!value) {
    return "-";
  }

  const date = value instanceof Date ? value : new Date(value);
  const parts = dateTimeFormatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    return parts.find((datePart) => datePart.type === type)?.value ?? "";
  };

  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

function formatBoolean(value: boolean): string {
  return value ? "可" : "不可";
}

function truncateLastError(lastError: string | null): string {
  if (!lastError) {
    return "-";
  }

  return lastError.length > 100 ? `${lastError.slice(0, 100)}...` : lastError;
}

function Badge({ badge }: { badge: BadgeConfig }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  );
}

export default async function TransportOrderDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) return notFound();

  const adminUser = await getAdminUser();
  if (!adminUser) redirect(`/vendor/login?next=/admin/transport-orders/${id}`);

  const order = await getTransportOrderDetail(db, adminUser.companyId, parsed.data);
  if (!order) return notFound();

  const vendorResponseBadge = getVendorResponseBadge(order.vendorResponse);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link href="/admin/transport-orders" className="text-sm text-blue-600 hover:underline">
          ← 一覧に戻る
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{order.orderNumber}</h1>
          <p className="text-sm text-gray-600">陸送依頼詳細</p>
        </div>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">詳細情報</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <DetailField label="案件番号" value={order.orderNumber} />
          <DetailField
            label="ステータス"
            value={<Badge badge={getStatusBadge(order.statusName)} />}
          />
          <DetailField label="移動パターン" value={getMovementTypeLabel(order.movementType)} />
          <DetailField label="走行可否" value={formatBoolean(order.canDrive)} />
          <DetailField label="レッカー要否" value={order.towRequired ? "要" : "不要"} />
          <DetailField label="業者名" value={order.vendorName ?? "—"} />
          <DetailField label="引取希望日時" value={formatDateTime(order.requestedPickupAt)} />
          <DetailField label="納車希望日時" value={formatDateTime(order.requestedDeliveryAt)} />
          <DetailField label="返却希望日時" value={formatDateTime(order.requestedReturnAt)} />
          <DetailField label="店舗確認日時" value={formatDateTime(order.storeConfirmedAt)} />
          <DetailField label="通知送信日時" value={formatDateTime(order.notificationSentAt)} />
          <DetailField
            label="業者対応"
            value={
              vendorResponseBadge ? (
                <Badge badge={vendorResponseBadge} />
              ) : (
                <span className="text-gray-700">-</span>
              )
            }
          />
          <DetailField label="業者対応日時" value={formatDateTime(order.vendorResponseAt)} />
          <DetailField label="備考" value={order.notes ?? "-"} />
          <DetailField label="作成日時" value={formatDateTime(order.createdAt)} />
          <DetailField label="引取店舗" value={order.pickupStoreName ?? "-"} />
          <DetailField label="納車店舗" value={order.deliveryStoreName ?? "-"} />
          <DetailField label="返却店舗" value={order.returnStoreName ?? "-"} />
          <DetailField label="引取店舗ID" value={order.pickupStoreId ?? "-"} />
          <DetailField label="納車店舗ID" value={order.deliveryStoreId ?? "-"} />
          <DetailField label="返却店舗ID" value={order.returnStoreId ?? "-"} />
        </dl>
      </section>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">招待一覧</h2>
        {order.invitations.length === 0 ? (
          <p className="mt-4 text-sm text-gray-600">招待なし</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["業者/担当", "招待日時", "応答", "応答日時", "先着受注"].map((heading) => (
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
                {order.invitations.map((invitation) => (
                  <tr key={invitation.invitationId}>
                    <td className="px-4 py-4 font-medium whitespace-nowrap text-gray-900">
                      {invitation.vendorName ??
                        invitation.inviteeName ??
                        invitation.inviteeEmail ??
                        "（スポット業者）"}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-gray-700">
                      {formatDateTime(invitation.invitedAt)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <Badge badge={getInvitationResponseBadge(invitation.response)} />
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-gray-700">
                      {formatDateTime(invitation.respondedAt)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      {invitation.isWinningBid ? (
                        <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                          先着受注
                        </span>
                      ) : (
                        <span className="text-gray-700">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">通知履歴</h2>
        {order.notifications.length === 0 ? (
          <p className="mt-4 text-sm text-gray-600">通知なし</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["イベント", "ステータス", "試行回数", "作成日時", "送信日時", "エラー"].map(
                    (heading) => (
                      <th
                        className="px-4 py-3 text-left font-medium text-gray-700"
                        key={heading}
                        scope="col"
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {order.notifications.map((notification) => (
                  <tr key={notification.outboxId}>
                    <td className="px-4 py-4 font-medium whitespace-nowrap text-gray-900">
                      {notification.eventType}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <Badge badge={getNotificationStatusBadge(notification.status)} />
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-gray-700">
                      {notification.attempts}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-gray-700">
                      {formatDateTime(notification.createdAt)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-gray-700">
                      {formatDateTime(notification.sentAt)}
                    </td>
                    <td className="max-w-md px-4 py-4 text-gray-700">
                      <span className="break-words">
                        {truncateLastError(notification.lastError)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {order.statusKey === "accepted" && !order.storeConfirmedAt && (
        <section className="rounded-md border border-blue-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-blue-700">店舗確定</h2>
          <p className="mt-2 text-sm text-gray-600">
            業者が「対応可」と回答した本依頼を店舗として確定します。確定すると店舗確認日時が記録され、業者へ確定通知が送信されます。(自動確定モードの依頼は業者の承諾時に確定済みのため、ここには表示されません)
          </p>
          <form action={confirmTransportOrderAction} className="mt-4 space-y-4">
            <input type="hidden" name="transportOrderId" value={order.transportOrderId} />
            <input type="hidden" name="expectedVersion" value={order.version} />
            <button
              type="submit"
              className="inline-flex items-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
            >
              この依頼を店舗確定する
            </button>
          </form>
        </section>
      )}

      {order.statusKey !== "cancelled" && (
        <section className="rounded-md border border-red-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-red-700">依頼キャンセル</h2>
          <p className="mt-2 text-sm text-gray-600">
            この依頼をキャンセルします。関連する全ての招待 (pending / accepted)
            が失効し、業者へキャンセル通知が送信されます。この操作は取り消せません。
          </p>
          <form action={cancelTransportOrderAction} className="mt-4 space-y-4">
            <input type="hidden" name="transportOrderId" value={order.transportOrderId} />
            <input type="hidden" name="expectedVersion" value={order.version} />
            <div>
              <label htmlFor="reason" className="block text-sm font-medium text-gray-700">
                キャンセル理由 (任意、最大 1000 文字)
              </label>
              <textarea
                id="reason"
                name="reason"
                rows={3}
                maxLength={1000}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 focus:outline-none"
                placeholder="例: 顧客都合により入庫キャンセル"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center rounded-md border border-transparent bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:outline-none"
            >
              この依頼をキャンセルする
            </button>
          </form>
        </section>
      )}

      {order.statusKey === "cancelled" && (
        <section className="rounded-md border border-gray-200 bg-gray-50 p-6">
          <h2 className="text-lg font-semibold text-gray-700">キャンセル済み</h2>
          <p className="mt-2 text-sm text-gray-600">この依頼はキャンセル済みです。</p>
        </section>
      )}
    </div>
  );
}
