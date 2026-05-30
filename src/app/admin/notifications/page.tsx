import { redirect } from "next/navigation";

import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { listFailedNotifications, type FailedNotificationListItem } from "@/lib/services/notifications";
import { requeueFailedNotificationAction } from "./actions";

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});

function formatDateTime(value: Date): string {
  return dateTimeFormatter.format(value).replace(/\//g, "-");
}

function truncateLastError(lastError: string | null): string {
  if (!lastError) return "-";
  return lastError.length > 200 ? `${lastError.slice(0, 200)}...` : lastError;
}

type TargetNotification = Pick<
  FailedNotificationListItem,
  "targetType" | "targetId" | "transportOrderId" | "reservationId" | "transportOrderInvitationId"
>;

function getTargetDisplay(notification: TargetNotification): string {
  if (notification.transportOrderId) return `回送案件 #${notification.transportOrderId.slice(0, 8)}`;
  if (notification.reservationId) return `予約 #${notification.reservationId.slice(0, 8)}`;
  if (notification.transportOrderInvitationId) return `業者招待 #${notification.transportOrderInvitationId.slice(0, 8)}`;
  return `${notification.targetType} #${notification.targetId.slice(0, 8)}`;
}

export default async function AdminNotificationsPage() {
  const adminUser = await getAdminUser();

  if (!adminUser) {
    redirect("/vendor/login?next=/admin/notifications");
  }

  const notifications = await listFailedNotifications(db, adminUser.companyId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">通知エラー管理</h1>
        <p className="text-sm text-gray-600">送信に失敗した通知を確認し、再送キューへ戻します。</p>
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
          通知失敗はありません。
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["eventType", "target", "attempts", "lastError", "nextAttemptAt", "createdAt", "requeue-button"].map((heading) => (
                    <th className="px-4 py-3 text-left font-medium text-gray-700" key={heading} scope="col">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {notifications.map((notification) => (
                  <tr key={notification.id}>
                    <td className="whitespace-nowrap px-4 py-4 font-medium text-gray-900">{notification.eventType}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{getTargetDisplay(notification)}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                      {notification.attempts}/{notification.maxAttempts}
                    </td>
                    <td className="max-w-md px-4 py-4 text-gray-700">
                      <span className="break-words">{truncateLastError(notification.lastError)}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{formatDateTime(notification.nextAttemptAt)}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">{formatDateTime(notification.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-right">
                      <form action={requeueFailedNotificationAction}>
                        <input name="outboxId" type="hidden" value={notification.id} />
                        <button
                          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
                          type="submit"
                        >
                          再キュー
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
