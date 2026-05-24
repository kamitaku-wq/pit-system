import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { RequestListItem } from "@/components/vendor-portal/request-list-item";
import { Card, CardContent } from "@/components/ui/card";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { statuses } from "@/lib/db/schema/statuses";
import { withAuthenticatedDb } from "@/lib/db/with-auth";
import { createClient } from "@/lib/supabase/server";

export default async function VendorRequestsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/vendor/login");
  }

  const requests = await withAuthenticatedDb(user.id, async (tx) =>
    tx
      .select({
        invitationId: transportOrderInvitations.id,
        transportOrderId: transportOrders.id,
        title: transportOrders.orderNumber,
        pickupAt: transportOrders.requestedPickupAt,
        dropAt: transportOrders.requestedDeliveryAt,
        statusLabel: statuses.name,
        invitedAt: transportOrderInvitations.invitedAt,
        expiresAt: transportOrderInvitations.expiresAt,
      })
      .from(transportOrderInvitations)
      .innerJoin(
        transportOrders,
        eq(transportOrderInvitations.transportOrderId, transportOrders.id),
      )
      .innerJoin(statuses, eq(transportOrders.statusId, statuses.id))
      .where(eq(transportOrderInvitations.response, "pending"))
      .orderBy(desc(transportOrderInvitations.invitedAt))
      .limit(50),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-normal">依頼一覧</h2>
        <p className="text-sm text-gray-600">回答待ちの陸送依頼を確認できます。</p>
      </div>

      {requests.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-gray-600">現在 pending の依頼はありません</p>
          </CardContent>
        </Card>
      ) : (
        <section className="flex flex-col gap-3" aria-label="回答待ち依頼">
          {requests.map((request) => (
            <RequestListItem
              expiresAt={request.expiresAt}
              invitationId={request.invitationId}
              invitedAt={request.invitedAt}
              key={request.invitationId}
              pickupAt={request.pickupAt}
              dropAt={request.dropAt}
              statusLabel={request.statusLabel}
              title={request.title}
              transportOrderId={request.transportOrderId}
            />
          ))}
        </section>
      )}
    </div>
  );
}
