// Phase 51: companies INSERT trigger (0013_companies_insert_trigger_status_seed.sql) で
// statuses + status_transitions が自動 seed される前提で SELECT-only に refactor。
// 既存 INSERT 経路は UNIQUE 違反となるため削除。
// interface (SeededTransportStatuses) は互換維持で 14 test file 影響なし。
//
// Phase 50 backfill SQL (0012_) + Phase 51 trigger SQL (0013_) と値が完全一致している前提。
// drift 検知は docs/operations/seed-new-company.md の post-check SQL で実施。
//
// Phase 64-C.0: `completed` status (post/0028_seed_transport_completed_status.sql) を追加。
// SELECT-only のため、本 helper を呼ぶ test は post/0028 適用済みの DB を前提とする。

import { and, eq } from "drizzle-orm";
import { statuses } from "@/lib/db/schema/statuses";

export interface SeededTransportStatuses {
  requested: string;
  accepted: string;
  completed: string;
  rejected: string;
  cancelled: string;
}

type TransportStatusKey = keyof SeededTransportStatuses;
type TransportStatusRow = {
  key: TransportStatusKey;
  id: string;
};

export async function seedTransportStatuses(
  // Drizzle does not export a common interface covering both DB and PgTransaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  companyId: string,
): Promise<SeededTransportStatuses> {
  const statusRows = (await tx
    .select({ key: statuses.key, id: statuses.id })
    .from(statuses)
    .where(
      and(eq(statuses.companyId, companyId), eq(statuses.statusType, "transport")),
    )) as TransportStatusRow[];

  const statusIds: Partial<Record<TransportStatusKey, string>> = {};
  for (const row of statusRows) {
    statusIds[row.key] = row.id;
  }

  const requested = statusIds.requested;
  const accepted = statusIds.accepted;
  const completed = statusIds.completed;
  const rejected = statusIds.rejected;
  const cancelled = statusIds.cancelled;

  if (!requested || !accepted || !completed || !rejected || !cancelled) {
    throw new Error(
      "Failed to seed all transport statuses (trigger missing, post/0028 not applied, or company not yet INSERTed?)",
    );
  }

  return { requested, accepted, completed, rejected, cancelled };
}
