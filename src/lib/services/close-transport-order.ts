import { sql } from "drizzle-orm";

export interface CloseTransportOrderResult {
  closed: boolean;
  newStatusId?: string;
  historyId?: string;
}

export async function closeTransportOrderOnAllRejected(
  // Drizzle does not export a common interface covering both DB and PgTransaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  transportOrderId: string,
): Promise<CloseTransportOrderResult> {
  const result = await tx.execute(sql`
    SELECT transport_order_id, closed, new_status_id, history_id
    FROM public.close_transport_order(${transportOrderId}::uuid)
  `);

  // drizzle-orm execute return shape varies by driver:
  // postgres.js driver: array directly; node-postgres: { rows: [...] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (result as any).rows ?? result;
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) {
    throw new Error("close_transport_order returned no rows");
  }

  return {
    closed: Boolean(row.closed),
    newStatusId: row.new_status_id ?? row.newStatusId ?? undefined,
    historyId: row.history_id ?? row.historyId ?? undefined,
  };
}
