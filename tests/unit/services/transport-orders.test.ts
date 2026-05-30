import { describe, expect, it } from "vitest";
import { CreateTransportOrderInput, RespondToTransportOrderInput } from "@/lib/services/transport-orders";

const companyId = "11111111-1111-4111-8111-111111111111";
const vendorId = "22222222-2222-4222-8222-222222222222";
const serviceTicketId = "33333333-3333-4333-8333-333333333333";
const vehicleId = "44444444-4444-4444-8444-444444444444";
const pickupStoreId = "55555555-5555-4555-8555-555555555555";
const deliveryStoreId = "66666666-6666-4666-8666-666666666666";
const returnStoreId = "77777777-7777-4777-8777-777777777777";

const validInput = {
  companyId,
  vendorId,
  serviceTicketId,
  vehicleId,
  orderNumber: "TO-001",
  movementType: "one_way",
  pickupStoreId,
  deliveryStoreId,
  returnStoreId,
};

const expectZodError = (parse: () => unknown): void => {
  try {
    parse();
    throw new Error("Expected ZodError");
  } catch (error) {
    expect(error).toHaveProperty("name", "ZodError");
  }
};

describe("CreateTransportOrderInput", () => {
  it("valid one_way input parses successfully", () => {
    expect(CreateTransportOrderInput.parse(validInput)).toMatchObject(validInput);
  });
  it("non-uuid companyId throws ZodError", () => {
    expectZodError(() => CreateTransportOrderInput.parse({ ...validInput, companyId: "invalid" }));
  });
  it("empty string orderNumber throws ZodError", () => {
    expectZodError(() => CreateTransportOrderInput.parse({ ...validInput, orderNumber: "" }));
  });
  it("orderNumber longer than 255 chars throws ZodError", () => {
    expectZodError(() => CreateTransportOrderInput.parse({ ...validInput, orderNumber: "x".repeat(256) }));
  });
  it("unknown movementType 'spacecraft' throws ZodError", () => {
    expectZodError(() => CreateTransportOrderInput.parse({ ...validInput, movementType: "spacecraft" }));
  });
  it("omitting canDrive and towRequired applies defaults", () => {
    const parsed = CreateTransportOrderInput.parse(validInput);

    expect(parsed.canDrive).toBe(true);
    expect(parsed.towRequired).toBe(false);
  });
  it("strict mode: extra unknown field randomField:1 throws ZodError", () => {
    expectZodError(() => CreateTransportOrderInput.parse({ ...validInput, randomField: 1 }));
  });
});

describe('respondToTransportOrder input validation', () => {
  const validUuid = '00000000-0000-4000-8000-000000000001';

  it('accepts response=accepted without reason', () => {
    const result = RespondToTransportOrderInput.parse({ invitationId: validUuid, response: 'accepted' });
    expect(result.response).toBe('accepted');
  });

  it('accepts response=rejected with reason', () => {
    const result = RespondToTransportOrderInput.parse({ invitationId: validUuid, response: 'rejected', reason: 'reason text' });
    expect(result.reason).toBe('reason text');
  });

  it('rejects non-uuid invitationId', () => {
    const result = RespondToTransportOrderInput.safeParse({ invitationId: 'not-a-uuid', response: 'accepted' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid response value', () => {
    const result = RespondToTransportOrderInput.safeParse({ invitationId: validUuid, response: 'pending' });
    expect(result.success).toBe(false);
  });

  it('rejects reason longer than 500 chars', () => {
    const result = RespondToTransportOrderInput.safeParse({ invitationId: validUuid, response: 'rejected', reason: 'a'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('rejects extra fields (strict mode)', () => {
    const result = RespondToTransportOrderInput.safeParse({ invitationId: validUuid, response: 'accepted', extra: 'foo' });
    expect(result.success).toBe(false);
  });
});
