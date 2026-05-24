import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";

type RequestListItemProps = {
  invitationId: string;
  transportOrderId: string;
  title: string;
  pickupAt: Date | string | null;
  dropAt: Date | string | null;
  statusLabel: string;
  invitedAt: Date | string;
  expiresAt: Date | string | null;
};

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tokyo",
});

function formatDateTime(value: Date | string | null): string {
  if (!value) {
    return "未定";
  }

  return dateTimeFormatter.format(value instanceof Date ? value : new Date(value));
}

export function RequestListItem({
  invitationId,
  transportOrderId,
  title,
  pickupAt,
  dropAt,
  statusLabel,
  invitedAt,
  expiresAt,
}: RequestListItemProps) {
  return (
    <Link className="block" href={`/vendor/requests/${invitationId}`}>
      <Card className="transition-colors hover:border-gray-300 hover:bg-gray-50">
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{title}</p>
              <p className="mt-1 text-xs text-gray-500">依頼ID: {transportOrderId}</p>
            </div>
            <span className="shrink-0 rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
              {statusLabel}
            </span>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-medium text-gray-500">引取希望</dt>
              <dd className="mt-1 text-gray-900">{formatDateTime(pickupAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">納車希望</dt>
              <dd className="mt-1 text-gray-900">{formatDateTime(dropAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">招待日時</dt>
              <dd className="mt-1 text-gray-900">{formatDateTime(invitedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">有効期限</dt>
              <dd className="mt-1 text-gray-900">{formatDateTime(expiresAt)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </Link>
  );
}
