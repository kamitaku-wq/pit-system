import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { seedTransportStatuses } from "../../_helpers/seed-transport-statuses";
import { attachments } from "@/lib/db/schema/attachments";
import { companies } from "@/lib/db/schema/companies";
import { lanes } from "@/lib/db/schema/lanes";
import { reservations } from "@/lib/db/schema/reservations";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { stores } from "@/lib/db/schema/stores";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { users } from "@/lib/db/schema/users";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendorCompanyMemberships } from "@/lib/db/schema/vendor_company_memberships";
import { vendors } from "@/lib/db/schema/vendors";
import {
  AttachmentNotFoundError,
  AttachmentParentNotFoundError,
  AttachmentStorageConflictError,
  getAttachmentById,
  listAttachments,
  MAX_BYTE_SIZE,
  registerAttachment,
  softDeleteAttachment,
} from "@/lib/services/attachments";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

type Fixture = {
  companyId: string;
  otherCompanyId: string;
  storeId: string;
  vehicleId: string;
  serviceTicketId: string;
  reservationId: string;
  transportOrderId: string;
  userId: string;
  // other-company parents (cross-tenant guard test)
  otherServiceTicketId: string;
  otherReservationId: string;
  otherTransportOrderId: string;
};

function requireRow<T>(row: T | undefined, label: string): T {
  if (!row) throw new Error(`Expected ${label} row to be returned`);
  return row;
}

afterAll(async () => {
  await queryClient?.end();
});

async function withRollback(fn: (outerTx: Tx) => Promise<void>): Promise<void> {
  let originalError: unknown;

  await db!
    .transaction(async (outerTx) => {
      try {
        await fn(outerTx);
      } catch (err) {
        originalError = err;
      }
      throw new Error(ROLLBACK);
    })
    .catch((err) => {
      if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
    });

  if (originalError) throw originalError;
}

async function seedTenant(outerTx: Tx, label: string) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__att_${label}_${suffix}__`, code: `att_${label}_${suffix}` })
    .returning({ id: companies.id });
  const company = requireRow(companyRow, "company");

  const [pickupStoreRow, deliveryStoreRow] = await outerTx
    .insert(stores)
    .values([
      { companyId: company.id, code: `p_${suffix}`, name: "Pickup" },
      { companyId: company.id, code: `d_${suffix}`, name: "Delivery" },
    ])
    .returning({ id: stores.id });
  const pickupStore = requireRow(pickupStoreRow, "pickup store");
  const deliveryStore = requireRow(deliveryStoreRow, "delivery store");

  const [vehicleRow] = await outerTx
    .insert(vehicles)
    .values({
      companyId: company.id,
      storeId: pickupStore.id,
      vin: `ATT${suffix.toUpperCase()}0000000`,
    })
    .returning({ id: vehicles.id });
  const vehicle = requireRow(vehicleRow, "vehicle");

  const [serviceTicketRow] = await outerTx
    .insert(serviceTickets)
    .values({
      companyId: company.id,
      vehicleId: vehicle.id,
      storeId: pickupStore.id,
      ticketNo: `att-${suffix}`,
      billingStatus: "unbilled",
    })
    .returning({ id: serviceTickets.id });
  const serviceTicket = requireRow(serviceTicketRow, "service ticket");

  const [vendorRow] = await outerTx
    .insert(vendors)
    .values({ companyId: company.id, name: `Vendor ${suffix}`, isActive: true })
    .returning({ id: vendors.id });
  const vendor = requireRow(vendorRow, "vendor");

  await outerTx.insert(vendorCompanyMemberships).values({
    vendorId: vendor.id,
    companyId: company.id,
    isEnabled: true,
  });

  const userId = crypto.randomUUID();
  // auth.users への先行 INSERT (public.users.id FK 違反防止)
  await outerTx.execute(sql`INSERT INTO auth.users (id) VALUES (${userId})`);
  const [userRow] = await outerTx
    .insert(users)
    .values({
      id: userId,
      companyId: company.id,
      email: `att-${suffix}@example.test`,
      name: `User ${suffix}`,
      isActive: true,
    })
    .returning({ id: users.id });
  const user = requireRow(userRow, "user");

  const [laneRow] = await outerTx
    .insert(lanes)
    .values({
      companyId: company.id,
      storeId: pickupStore.id,
      name: `Lane ${suffix}`,
    })
    .returning({ id: lanes.id });
  const lane = requireRow(laneRow, "lane");

  const [reservationRow] = await outerTx
    .insert(reservations)
    .values({
      companyId: company.id,
      storeId: pickupStore.id,
      laneId: lane.id,
      startAt: new Date("2026-07-01T09:00:00Z"),
      endAt: new Date("2026-07-01T10:00:00Z"),
    })
    .returning({ id: reservations.id });
  const reservation = requireRow(reservationRow, "reservation");

  const statusIds = await seedTransportStatuses(outerTx, company.id);

  const [transportOrderRow] = await outerTx
    .insert(transportOrders)
    .values({
      companyId: company.id,
      vendorId: vendor.id,
      serviceTicketId: serviceTicket.id,
      vehicleId: vehicle.id,
      pickupStoreId: pickupStore.id,
      deliveryStoreId: deliveryStore.id,
      orderNumber: `TO-${suffix}`,
      movementType: "one_way",
      canDrive: true,
      towRequired: false,
      statusId: statusIds.requested,
    })
    .returning({ id: transportOrders.id });
  const transportOrder = requireRow(transportOrderRow, "transport order");

  return {
    companyId: company.id,
    storeId: pickupStore.id,
    vehicleId: vehicle.id,
    serviceTicketId: serviceTicket.id,
    reservationId: reservation.id,
    transportOrderId: transportOrder.id,
    userId: user.id,
  };
}

async function seedFixture(outerTx: Tx): Promise<Fixture> {
  const current = await seedTenant(outerTx, "cur");
  const other = await seedTenant(outerTx, "oth");
  return {
    companyId: current.companyId,
    otherCompanyId: other.companyId,
    storeId: current.storeId,
    vehicleId: current.vehicleId,
    serviceTicketId: current.serviceTicketId,
    reservationId: current.reservationId,
    transportOrderId: current.transportOrderId,
    userId: current.userId,
    otherServiceTicketId: other.serviceTicketId,
    otherReservationId: other.reservationId,
    otherTransportOrderId: other.transportOrderId,
  };
}

describeIntegration("attachments services", () => {
  it("registers an attachment for a service_ticket parent and persists row", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const result = await registerAttachment(
        {
          parentType: "service_ticket",
          parentId: fixture.serviceTicketId,
          storageBucket: "attachments",
          storageKey: `tickets/${fixture.serviceTicketId}/photo.jpg`,
          fileName: "photo.jpg",
          contentType: "image/jpeg",
          byteSize: 12_345,
          checksum: "deadbeef",
          uploadedByUserId: fixture.userId,
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(result.id).toBeDefined();
      expect(result.serviceTicketId).toBe(fixture.serviceTicketId);
      expect(result.reservationId).toBeNull();
      expect(result.transportOrderId).toBeNull();
      expect(result.byteSize).toBe(12_345);

      const rows = await outerTx
        .select()
        .from(attachments)
        .where(eq(attachments.id, result.id));
      expect(rows.length).toBe(1);
      expect(rows[0].storageBucket).toBe("attachments");
      expect(rows[0].fileName).toBe("photo.jpg");
      expect(rows[0].checksum).toBe("deadbeef");
    });
  });

  it("registers attachments for reservation and transport_order parents (with nullable fields)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      const reservationAtt = await registerAttachment(
        {
          parentType: "reservation",
          parentId: fixture.reservationId,
          storageBucket: "attachments",
          storageKey: `reservations/${fixture.reservationId}/diag.pdf`,
          fileName: "diag.pdf",
          contentType: "application/pdf",
          byteSize: 100,
        },
        ctx,
      );
      expect(reservationAtt.reservationId).toBe(fixture.reservationId);
      expect(reservationAtt.serviceTicketId).toBeNull();
      expect(reservationAtt.transportOrderId).toBeNull();
      expect(reservationAtt.contentType).toBe("application/pdf");
      expect(reservationAtt.uploadedByUserId).toBeNull();
      expect(reservationAtt.checksum).toBeNull();

      const transportAtt = await registerAttachment(
        {
          parentType: "transport_order",
          parentId: fixture.transportOrderId,
          storageBucket: "attachments",
          storageKey: `transports/${fixture.transportOrderId}/before.png`,
          fileName: "before.png",
          contentType: "image/png",
          byteSize: 0, // 空ファイル許容 (DB CHECK byte_size >= 0)
        },
        ctx,
      );
      expect(transportAtt.transportOrderId).toBe(fixture.transportOrderId);
      expect(transportAtt.serviceTicketId).toBeNull();
      expect(transportAtt.reservationId).toBeNull();
      expect(transportAtt.byteSize).toBe(0);
    });
  });

  it("rejects cross-tenant parent with AttachmentParentNotFoundError", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      await expect(
        registerAttachment(
          {
            parentType: "service_ticket",
            parentId: fixture.otherServiceTicketId,
            storageBucket: "attachments",
            storageKey: "x/y.jpg",
            fileName: "y.jpg",
            contentType: "image/jpeg",
            byteSize: 1,
          },
          ctx,
        ),
      ).rejects.toBeInstanceOf(AttachmentParentNotFoundError);

      await expect(
        registerAttachment(
          {
            parentType: "reservation",
            parentId: fixture.otherReservationId,
            storageBucket: "attachments",
            storageKey: "x/y2.jpg",
            fileName: "y2.jpg",
            contentType: "image/jpeg",
            byteSize: 1,
          },
          ctx,
        ),
      ).rejects.toBeInstanceOf(AttachmentParentNotFoundError);

      await expect(
        registerAttachment(
          {
            parentType: "transport_order",
            parentId: fixture.otherTransportOrderId,
            storageBucket: "attachments",
            storageKey: "x/y3.jpg",
            fileName: "y3.jpg",
            contentType: "image/jpeg",
            byteSize: 1,
          },
          ctx,
        ),
      ).rejects.toBeInstanceOf(AttachmentParentNotFoundError);
    });
  });

  it("rejects duplicate storage_bucket+storage_key with AttachmentStorageConflictError", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      const input = {
        parentType: "service_ticket" as const,
        parentId: fixture.serviceTicketId,
        storageBucket: "attachments",
        storageKey: "dup/key.jpg",
        fileName: "key.jpg",
        contentType: "image/jpeg" as const,
        byteSize: 100,
      };

      await registerAttachment(input, ctx);

      await expect(registerAttachment(input, ctx)).rejects.toBeInstanceOf(
        AttachmentStorageConflictError,
      );
    });
  });

  it("lists attachments filtered by parent (service_ticket) and excludes other parents", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      await registerAttachment(
        {
          parentType: "service_ticket",
          parentId: fixture.serviceTicketId,
          storageBucket: "attachments",
          storageKey: "st/a.jpg",
          fileName: "a.jpg",
          contentType: "image/jpeg",
          byteSize: 100,
        },
        ctx,
      );
      await registerAttachment(
        {
          parentType: "service_ticket",
          parentId: fixture.serviceTicketId,
          storageBucket: "attachments",
          storageKey: "st/b.jpg",
          fileName: "b.jpg",
          contentType: "image/jpeg",
          byteSize: 200,
        },
        ctx,
      );
      await registerAttachment(
        {
          parentType: "reservation",
          parentId: fixture.reservationId,
          storageBucket: "attachments",
          storageKey: "res/c.jpg",
          fileName: "c.jpg",
          contentType: "image/jpeg",
          byteSize: 300,
        },
        ctx,
      );

      const stOnly = await listAttachments(
        { parentType: "service_ticket", parentId: fixture.serviceTicketId },
        ctx,
      );
      expect(stOnly.rows.length).toBe(2);
      expect(stOnly.total).toBe(2);
      expect(stOnly.rows.every((a) => a.serviceTicketId === fixture.serviceTicketId)).toBe(
        true,
      );

      const resOnly = await listAttachments(
        { parentType: "reservation", parentId: fixture.reservationId },
        ctx,
      );
      expect(resOnly.rows.length).toBe(1);
      expect(resOnly.rows[0]?.reservationId).toBe(fixture.reservationId);

      const all = await listAttachments({}, ctx);
      expect(all.total).toBe(3);
    });
  });

  it("does not leak attachments across tenants in list / getById", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);

      // current tenant の attachment 1 件登録
      const current = await registerAttachment(
        {
          parentType: "service_ticket",
          parentId: fixture.serviceTicketId,
          storageBucket: "attachments",
          storageKey: "cur/a.jpg",
          fileName: "a.jpg",
          contentType: "image/jpeg",
          byteSize: 100,
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      // other tenant の attachment 1 件登録
      const other = await registerAttachment(
        {
          parentType: "service_ticket",
          parentId: fixture.otherServiceTicketId,
          storageBucket: "attachments",
          storageKey: "oth/b.jpg",
          fileName: "b.jpg",
          contentType: "image/jpeg",
          byteSize: 200,
        },
        { db: outerTx, companyId: fixture.otherCompanyId },
      );

      // current から見ると other は不可視
      const fromCurrent = await listAttachments(
        {},
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(fromCurrent.rows.map((a) => a.id)).toEqual([current.id]);
      expect(fromCurrent.total).toBe(1);

      const otherFromCurrent = await getAttachmentById(other.id, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(otherFromCurrent).toBeNull();

      const otherFromOther = await getAttachmentById(other.id, {
        db: outerTx,
        companyId: fixture.otherCompanyId,
      });
      expect(otherFromOther?.id).toBe(other.id);
    });
  });

  it("soft-deletes attachment and rejects double delete with AttachmentNotFoundError", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      const created = await registerAttachment(
        {
          parentType: "service_ticket",
          parentId: fixture.serviceTicketId,
          storageBucket: "attachments",
          storageKey: "soft/x.jpg",
          fileName: "x.jpg",
          contentType: "image/jpeg",
          byteSize: 100,
        },
        ctx,
      );

      const deleted = await softDeleteAttachment(created.id, ctx);
      expect(deleted.deletedAt).not.toBeNull();

      // default list は softDelete を除外
      const visible = await listAttachments({}, ctx);
      expect(visible.rows.find((a) => a.id === created.id)).toBeUndefined();

      // includeDeleted で見える
      const withDeleted = await listAttachments({ includeDeleted: true }, ctx);
      expect(withDeleted.rows.find((a) => a.id === created.id)).toBeDefined();

      // getById は deletedAt 付きでも取得可 (tenant 内なら)
      const got = await getAttachmentById(created.id, ctx);
      expect(got?.deletedAt).not.toBeNull();

      // 二重削除は NotFound
      await expect(softDeleteAttachment(created.id, ctx)).rejects.toBeInstanceOf(
        AttachmentNotFoundError,
      );
    });
  });

  it("rejects cross-tenant softDelete with AttachmentNotFoundError", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);

      const other = await registerAttachment(
        {
          parentType: "service_ticket",
          parentId: fixture.otherServiceTicketId,
          storageBucket: "attachments",
          storageKey: "oth/del.jpg",
          fileName: "del.jpg",
          contentType: "image/jpeg",
          byteSize: 100,
        },
        { db: outerTx, companyId: fixture.otherCompanyId },
      );

      await expect(
        softDeleteAttachment(other.id, {
          db: outerTx,
          companyId: fixture.companyId,
        }),
      ).rejects.toBeInstanceOf(AttachmentNotFoundError);

      // other tenant 側ではまだ削除可能
      const stillRow = await outerTx
        .select()
        .from(attachments)
        .where(
          and(
            eq(attachments.id, other.id),
            eq(attachments.companyId, fixture.otherCompanyId),
          ),
        );
      expect(stillRow.length).toBe(1);
      expect(stillRow[0].deletedAt).toBeNull();
    });
  });

  it("filters list by uploadedByUserId", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      // 別 user を 1 件追加 (auth.users 先行 INSERT)
      const otherUserId = crypto.randomUUID();
      await outerTx.execute(sql`INSERT INTO auth.users (id) VALUES (${otherUserId})`);
      const [otherUserRow] = await outerTx
        .insert(users)
        .values({
          id: otherUserId,
          companyId: fixture.companyId,
          email: `att-u2-${crypto.randomUUID().slice(0, 6)}@example.test`,
          name: "User 2",
          isActive: true,
        })
        .returning({ id: users.id });

      await registerAttachment(
        {
          parentType: "service_ticket",
          parentId: fixture.serviceTicketId,
          storageBucket: "attachments",
          storageKey: "u1/a.jpg",
          fileName: "a.jpg",
          contentType: "image/jpeg",
          byteSize: 100,
          uploadedByUserId: fixture.userId,
        },
        ctx,
      );
      await registerAttachment(
        {
          parentType: "service_ticket",
          parentId: fixture.serviceTicketId,
          storageBucket: "attachments",
          storageKey: "u2/b.jpg",
          fileName: "b.jpg",
          contentType: "image/jpeg",
          byteSize: 200,
          uploadedByUserId: otherUserRow.id,
        },
        ctx,
      );

      const byU1 = await listAttachments(
        { uploadedByUserId: fixture.userId },
        ctx,
      );
      expect(byU1.rows.length).toBe(1);
      expect(byU1.rows[0]?.uploadedByUserId).toBe(fixture.userId);
    });
  });

  it("rejects Zod violations: invalid mime, oversized byteSize, non-uuid parentId, empty fileName", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      const valid = {
        parentType: "service_ticket" as const,
        parentId: fixture.serviceTicketId,
        storageBucket: "attachments",
        storageKey: "z/v.jpg",
        fileName: "v.jpg",
        contentType: "image/jpeg" as const,
        byteSize: 100,
      };

      // invalid mime
      await expect(
        registerAttachment(
          // @ts-expect-error: contentType outside whitelist
          { ...valid, contentType: "application/zip", storageKey: "z/v1.jpg" },
          ctx,
        ),
      ).rejects.toThrow();

      // oversized byteSize
      await expect(
        registerAttachment(
          { ...valid, byteSize: MAX_BYTE_SIZE + 1, storageKey: "z/v2.jpg" },
          ctx,
        ),
      ).rejects.toThrow();

      // non-uuid parentId
      await expect(
        registerAttachment(
          { ...valid, parentId: "not-a-uuid", storageKey: "z/v3.jpg" },
          ctx,
        ),
      ).rejects.toThrow();

      // empty fileName
      await expect(
        registerAttachment(
          { ...valid, fileName: "   ", storageKey: "z/v4.jpg" },
          ctx,
        ),
      ).rejects.toThrow();

      // negative byteSize
      await expect(
        registerAttachment(
          { ...valid, byteSize: -1, storageKey: "z/v5.jpg" },
          ctx,
        ),
      ).rejects.toThrow();
    });
  });
});
