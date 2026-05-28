import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import {
  getVendorsWithInvitationStatus,
  type VendorWithInvitationStatus,
} from "@/lib/services/admin-vendors";

import {
  resendInvitationAction,
  type ResendInvitationActionState,
  revokeInvitationAction,
  type RevokeInvitationActionState,
} from "./actions";

type AdminVendorsPageProps = {
  searchParams: Promise<{
    invited?: string;
    resent?: string;
    revoked?: string;
  }>;
};

type InvitationStatus = VendorWithInvitationStatus["latestInvitationStatus"];

type BadgeConfig = {
  className: string;
  label: string;
};

const invitationStatusBadges: Record<NonNullable<InvitationStatus>, BadgeConfig> = {
  pending: {
    className: "bg-yellow-100 text-yellow-800",
    label: "招待準備中",
  },
  sent: {
    className: "bg-blue-100 text-blue-800",
    label: "送信済み",
  },
  accepted: {
    className: "bg-green-100 text-green-800",
    label: "受諾済み",
  },
  expired: {
    className: "bg-gray-100 text-gray-800",
    label: "期限切れ",
  },
  revoked: {
    className: "bg-red-100 text-red-800",
    label: "取消済み",
  },
};

const notInvitedBadge: BadgeConfig = {
  className: "bg-gray-50 text-gray-500",
  label: "未招待",
};

const initialResendInvitationActionState: ResendInvitationActionState = {
  error: null,
  success: false,
};

const initialRevokeInvitationActionState: RevokeInvitationActionState = {
  error: null,
  success: false,
};

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function getInvitationStatusBadge(status: InvitationStatus): BadgeConfig {
  if (!status) {
    return notInvitedBadge;
  }
  return invitationStatusBadges[status];
}

function formatSentAt(sentAt: Date | null): string {
  if (!sentAt) {
    return "-";
  }
  return dateTimeFormatter.format(sentAt);
}

function canManageInvitation(status: InvitationStatus): boolean {
  return status === "pending" || status === "sent";
}

export default async function AdminVendorsPage({ searchParams }: AdminVendorsPageProps) {
  const params = await searchParams;
  const adminUser = await getAdminUser();
  if (!adminUser) {
    redirect("/vendor/login?next=/admin/vendors");
  }

  async function resendInvitationFormAction(formData: FormData): Promise<void> {
    "use server";

    await resendInvitationAction(initialResendInvitationActionState, formData);
  }

  async function revokeInvitationFormAction(formData: FormData): Promise<void> {
    "use server";

    await revokeInvitationAction(initialRevokeInvitationActionState, formData);
  }

  const vendors = await getVendorsWithInvitationStatus(db, adminUser.companyId);
  const invited = params.invited === "ok";
  const resent = params.resent === "ok";
  const revoked = params.revoked === "ok";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">業者一覧</h1>
        <p className="text-sm text-gray-600">業者ユーザーの招待状況を確認し、招待の再送信や取り消しを行います。</p>
      </div>

      {invited ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          業者ユーザーへの招待を送信しました。
        </div>
      ) : null}

      {resent ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          招待を再送信しました。
        </div>
      ) : null}

      {revoked ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          招待を取り消しました。
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Link
          className="inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          href="/admin/vendors/new"
        >
          新規作成
        </Link>
        <Link
          className="inline-flex rounded-md border border-blue-600 bg-white px-4 py-2 text-sm font-medium text-blue-700 shadow-sm hover:bg-blue-50"
          href="/admin/vendors/invite"
        >
          招待する
        </Link>
      </div>

      {vendors.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
          登録されている業者がありません。
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-700" scope="col">
                    業者名
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700" scope="col">
                    招待ステータス
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700" scope="col">
                    招待メール
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700" scope="col">
                    最終送信日時
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700" scope="col">
                    アクション
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {vendors.map((vendor) => {
                  const badge = getInvitationStatusBadge(vendor.latestInvitationStatus);
                  const showActions = canManageInvitation(vendor.latestInvitationStatus);

                  return (
                    <tr key={vendor.vendorId}>
                      <td className="whitespace-nowrap px-4 py-4 font-medium text-gray-900">
                        <Link className="text-blue-600 hover:underline" href={`/admin/vendors/${vendor.vendorId}`}>
                          {vendor.vendorName}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                        {vendor.latestInvitationEmail ?? "-"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                        {formatSentAt(vendor.latestInvitationSentAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        {showActions ? (
                          <div className="flex items-center gap-2">
                            <form action={resendInvitationFormAction}>
                              <input name="invitationId" type="hidden" value={vendor.latestInvitationId ?? ""} />
                              <button
                                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700"
                                type="submit"
                              >
                                再送信
                              </button>
                            </form>
                            <form action={revokeInvitationFormAction}>
                              <input name="invitationId" type="hidden" value={vendor.latestInvitationId ?? ""} />
                              <button
                                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-red-700"
                                type="submit"
                              >
                                取り消し
                              </button>
                            </form>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
