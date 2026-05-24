// NOTE: Phase 18 (16-B) 時点では本 helper は未使用。
// 16-B integration test (tests/integration/services/transport-orders.integration.test.ts) は
// drizzle outer transaction で statuses/status_transitions を inline seed する設計を採用。
// 本 helper は postgres.js TransactionSql pattern 用に作成されたが、16-C respondToTransportOrder
// の追加 test fixture から呼び出す想定で残す。16-E で createCompanyWithDefaults service 関数が
// 完成したらそちらに統合し、本 helper は削除する。

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
  // postgres.js TransactionSql is intentionally kept as any in test helpers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  companyId: string,
): Promise<SeededTransportStatuses> {
  // spec §18.1 defines per-company status seeding; Phase 17 reconcile removed
  // these rows from 21_seed_master, so tests seed transport fixtures explicitly.
  const statusRows = (await tx`
    INSERT INTO statuses (
      company_id,
      status_type,
      key,
      name,
      display_order,
      is_initial,
      is_terminal,
      is_active
    )
    VALUES
      (${companyId}::uuid, 'transport', 'requested', 'Requested', 10, true, false, true),
      (${companyId}::uuid, 'transport', 'accepted', 'Accepted', 20, false, false, true),
      (${companyId}::uuid, 'transport', 'rejected', 'Rejected', 30, false, true, true)
    RETURNING key, id
  `) as TransportStatusRow[];

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

  await tx`
    INSERT INTO status_transitions (
      company_id,
      status_type,
      from_status_id,
      to_status_id,
      triggers_notification
    )
    VALUES
      (${companyId}::uuid, 'transport', ${requested}::uuid, ${accepted}::uuid, true),
      (${companyId}::uuid, 'transport', ${requested}::uuid, ${rejected}::uuid, true)
  `;

  return { requested, accepted, rejected };
}
