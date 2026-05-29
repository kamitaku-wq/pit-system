import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CompleteForm } from "@/components/vendor-portal/complete-form";
import { RespondForm } from "@/components/vendor-portal/respond-form";
import { ScheduleForm } from "@/components/vendor-portal/schedule-form";
import { withAuthenticatedDb } from "@/lib/db/with-auth";
import { companies } from "@/lib/db/schema/companies";
import { statuses } from "@/lib/db/schema/statuses";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { createClient } from "@/lib/supabase/server";

type RequestDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; scheduled?: string; completed?: string }>;
};

const ERROR_MESSAGES: Record<string, string> = {
  not_pending: "他のユーザーが既に応答済みです",
  concurrent: "同時応答が検出されました。再読込してください",
  transition: "ステータス遷移できません",
  invalid_response: "不正なリクエスト",
  invalid_input: "不正なリクエスト",
  seed_missing: "内部エラー: ステータス未設定",
  not_accepted: "この案件は対応可回答後に予定入力できます",
  not_completable: "この案件は完了報告できる状態ではありません",
};

function formatDateTime(value: Date | null): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatMovementType(value: string): string {
  const labels: Record<string, string> = {
    one_way: "片道",
    round_trip: "往復",
    pickup_only: "引取のみ",
    three_point: "三点間",
  };

  return labels[value] ?? value;
}

export default async function RequestDetailPage({ params, searchParams }: RequestDetailPageProps) {
  const [{ id }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const errorCode = resolvedSearchParams.error;
  const actionError = errorCode ? ERROR_MESSAGES[errorCode] : undefined;
  const successMessage = resolvedSearchParams.scheduled
    ? "予定を保存しました"
    : resolvedSearchParams.completed
      ? "完了報告しました"
      : undefined;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/vendor/login");
  }

  const request = await withAuthenticatedDb(user.id, async (tx) => {
    const rows = await tx
      .select({
        invitationId: transportOrderInvitations.id,
        invitationResponse: transportOrderInvitations.response,
        invitedAt: transportOrderInvitations.invitedAt,
        transportOrderId: transportOrders.id,
        orderNumber: transportOrders.orderNumber,
        movementType: transportOrders.movementType,
        canDrive: transportOrders.canDrive,
        towRequired: transportOrders.towRequired,
        requestedPickupAt: transportOrders.requestedPickupAt,
        requestedDeliveryAt: transportOrders.requestedDeliveryAt,
        requestedReturnAt: transportOrders.requestedReturnAt,
        scheduledPickupAt: transportOrders.scheduledPickupAt,
        scheduledDeliveryAt: transportOrders.scheduledDeliveryAt,
        scheduledReturnAt: transportOrders.scheduledReturnAt,
        pickedUpAt: transportOrders.pickedUpAt,
        deliveredAt: transportOrders.deliveredAt,
        returnedAt: transportOrders.returnedAt,
        notes: transportOrders.notes,
        statusLabel: statuses.name,
        statusKey: statuses.key,
        companyName: companies.name,
      })
      .from(transportOrderInvitations)
      .innerJoin(
        transportOrders,
        eq(transportOrders.id, transportOrderInvitations.transportOrderId),
      )
      .innerJoin(statuses, eq(statuses.id, transportOrders.statusId))
      .innerJoin(companies, eq(companies.id, transportOrders.companyId))
      .where(eq(transportOrderInvitations.id, id))
      .limit(1);

    return rows[0];
  });

  if (!request) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-500">依頼詳細</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">{request.orderNumber}</h1>
        </div>
        <Link
          className="inline-flex h-10 items-center rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          href="/vendor/requests"
        >
          一覧へ戻る
        </Link>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold tracking-normal">陸送内容</h2>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-gray-500">依頼会社</dt>
            <dd className="mt-1 text-sm text-gray-900">{request.companyName}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">案件ステータス</dt>
            <dd className="mt-1 text-sm text-gray-900">{request.statusLabel}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">移動種別</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {formatMovementType(request.movementType)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">招待ステータス</dt>
            <dd className="mt-1 text-sm text-gray-900">{request.invitationResponse}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">自走可否</dt>
            <dd className="mt-1 text-sm text-gray-900">{request.canDrive ? "可" : "不可"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">積載要否</dt>
            <dd className="mt-1 text-sm text-gray-900">{request.towRequired ? "必要" : "不要"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">希望引取日時</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {formatDateTime(request.requestedPickupAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">希望納車日時</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {formatDateTime(request.requestedDeliveryAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">希望返却日時</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {formatDateTime(request.requestedReturnAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">招待日時</dt>
            <dd className="mt-1 text-sm text-gray-900">{formatDateTime(request.invitedAt)}</dd>
          </div>
        </dl>
        {request.notes ? (
          <div className="mt-5 border-t border-gray-100 pt-5">
            <dt className="text-xs font-medium text-gray-500">備考</dt>
            <dd className="mt-1 text-sm whitespace-pre-wrap text-gray-900">{request.notes}</dd>
          </div>
        ) : null}
      </section>

      {successMessage ? (
        <p className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
          {successMessage}
        </p>
      ) : null}

      {request.invitationResponse !== "pending" && actionError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {actionError}
        </p>
      ) : null}

      {request.invitationResponse === "pending" ? (
        <RespondForm
          actionError={actionError}
          invitationId={request.invitationId}
          transportOrderId={request.transportOrderId}
        />
      ) : null}

      {request.invitationResponse === "accepted" && request.statusKey === "accepted" ? (
        <>
          <ScheduleForm
            invitationId={request.invitationId}
            scheduledPickupAt={request.scheduledPickupAt}
            scheduledDeliveryAt={request.scheduledDeliveryAt}
            scheduledReturnAt={request.scheduledReturnAt}
          />
          <CompleteForm
            invitationId={request.invitationId}
            pickedUpAt={request.pickedUpAt}
            deliveredAt={request.deliveredAt}
            returnedAt={request.returnedAt}
          />
        </>
      ) : null}

      {request.statusKey === "completed" ? (
        <section className="rounded-lg border border-gray-200 bg-gray-50 p-6">
          <h2 className="text-base font-semibold tracking-normal text-gray-700">完了報告済み</h2>
          <dl className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-gray-500">引取完了</dt>
              <dd className="mt-1 text-sm text-gray-900">{formatDateTime(request.pickedUpAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">搬入完了</dt>
              <dd className="mt-1 text-sm text-gray-900">{formatDateTime(request.deliveredAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">返却完了</dt>
              <dd className="mt-1 text-sm text-gray-900">{formatDateTime(request.returnedAt)}</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}
