// Phase 64-A.29: reservation status は companies INSERT trigger
// (0023_seed_reservation_statuses.sql) で自動 seed される前提で SELECT-only。
// 値は 0023_*.sql と完全一致している前提 ('confirmed' 1 件、is_initial=true)。

import { and, eq } from "drizzle-orm";
import { statuses } from "@/lib/db/schema/statuses";

export interface SeededReservationStatuses {
  confirmed: string;
}

type ReservationStatusKey = keyof SeededReservationStatuses;
type ReservationStatusRow = {
  key: ReservationStatusKey;
  id: string;
};

export async function seedReservationStatuses(
  // Drizzle does not export a common interface covering both DB and PgTransaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  companyId: string,
): Promise<SeededReservationStatuses> {
  const statusRows = (await tx
    .select({ key: statuses.key, id: statuses.id })
    .from(statuses)
    .where(
      and(eq(statuses.companyId, companyId), eq(statuses.statusType, "reservation")),
    )) as ReservationStatusRow[];

  const statusIds: Partial<Record<ReservationStatusKey, string>> = {};
  for (const row of statusRows) {
    statusIds[row.key] = row.id;
  }

  const confirmed = statusIds.confirmed;
  if (!confirmed) {
    throw new Error(
      "Failed to seed reservation statuses (trigger missing or company not yet INSERTed?)",
    );
  }

  return { confirmed };
}
