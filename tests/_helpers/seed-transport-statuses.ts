// Phase 19 (16-C) で Drizzle transaction 対応に書き換え。
// Phase 18 既存 integration test の inline seed も本 helper 呼出に統一する想定。
// 16-E で createCompanyWithDefaults service 関数が完成したらそちらに統合し、本 helper は削除する。

import { statuses } from "@/lib/db/schema/statuses";
import { statusTransitions } from "@/lib/db/schema/status_transitions";

export interface SeededTransportStatuses {
  requested: string;
  accepted: string;
  rejected: string;
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
  // spec §18.1 defines per-company status seeding; Phase 17 reconcile removed
  // these rows from 21_seed_master, so tests seed transport fixtures explicitly.
  const statusRows = (await tx
    .insert(statuses)
    .values([
      {
        companyId,
        statusType: "transport",
        key: "requested",
        name: "Requested",
        displayOrder: 10,
        isInitial: true,
        isTerminal: false,
        isActive: true,
      },
      {
        companyId,
        statusType: "transport",
        key: "accepted",
        name: "Accepted",
        displayOrder: 20,
        isInitial: false,
        isTerminal: false,
        isActive: true,
      },
      {
        companyId,
        statusType: "transport",
        key: "rejected",
        name: "Rejected",
        displayOrder: 30,
        isInitial: false,
        isTerminal: true,
        isActive: true,
      },
    ])
    .returning({ key: statuses.key, id: statuses.id })) as TransportStatusRow[];

  const statusIds: Partial<Record<TransportStatusKey, string>> = {};
  for (const row of statusRows) {
    statusIds[row.key] = row.id;
  }

  const requested = statusIds.requested;
  const accepted = statusIds.accepted;
  const rejected = statusIds.rejected;

  if (!requested || !accepted || !rejected) {
    throw new Error("Failed to seed all transport statuses");
  }

  await tx.insert(statusTransitions).values([
    {
      companyId,
      statusType: "transport",
      fromStatusId: requested,
      toStatusId: accepted,
      triggersNotification: true,
    },
    {
      companyId,
      statusType: "transport",
      fromStatusId: requested,
      toStatusId: rejected,
      triggersNotification: true,
    },
  ]);

  return { requested, accepted, rejected };
}
