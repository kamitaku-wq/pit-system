// Phase 64-B: 陸送依頼の移動パターン別 店舗要否検証 (純粋関数)。
// DB の movement_pattern_check (alpha-1-public/12_transport.sql) と同条件を app 層で先行検証し、
// 23514 でなくフレンドリーな日本語エラーで弾く。"use server" ファイルからは純粋関数を export できない
// ため別モジュールに切り出し、unit test 可能にする。

export type MovementType = "one_way" | "round_trip" | "pickup_only" | "three_point";

export const MOVEMENT_TYPES: readonly MovementType[] = [
  "one_way",
  "round_trip",
  "pickup_only",
  "three_point",
];

export function isMovementType(value: string): value is MovementType {
  return (MOVEMENT_TYPES as readonly string[]).includes(value);
}

export class InvalidMovementPatternError extends Error {
  static readonly code = "INVALID_MOVEMENT_PATTERN" as const;
  readonly code = InvalidMovementPatternError.code;

  constructor(message: string) {
    super(message);
    this.name = "InvalidMovementPatternError";
  }
}

// 移動パターン別の店舗要否を検証する。違反時は InvalidMovementPatternError を投げる。
// DB CHECK (12_transport.sql):
//   one_way:     pickup ✓ delivery ✓ return ✗
//   round_trip:  pickup ✓ delivery ✓ return ✓
//   pickup_only: pickup ✓ delivery ✗ return ✗
//   three_point: pickup ✓ delivery ✓ return ✓ かつ 3 店舗すべて異なる
export function validateMovementPattern(
  movementType: MovementType,
  pickupStoreId: string | undefined,
  deliveryStoreId: string | undefined,
  returnStoreId: string | undefined,
): void {
  const hasPickup = Boolean(pickupStoreId);
  const hasDelivery = Boolean(deliveryStoreId);
  const hasReturn = Boolean(returnStoreId);

  switch (movementType) {
    case "one_way":
      if (!hasPickup || !hasDelivery || hasReturn) {
        throw new InvalidMovementPatternError(
          "片道は引取店舗・納車店舗が必須で、返却店舗は指定できません",
        );
      }
      break;
    case "round_trip":
      if (!hasPickup || !hasDelivery || !hasReturn) {
        throw new InvalidMovementPatternError(
          "往復は引取店舗・納車店舗・返却店舗がすべて必須です",
        );
      }
      break;
    case "three_point":
      if (!hasPickup || !hasDelivery || !hasReturn) {
        throw new InvalidMovementPatternError(
          "三点移動は引取店舗・納車店舗・返却店舗がすべて必須です",
        );
      }
      if (
        pickupStoreId === deliveryStoreId ||
        deliveryStoreId === returnStoreId ||
        pickupStoreId === returnStoreId
      ) {
        throw new InvalidMovementPatternError(
          "三点移動は引取・納車・返却店舗がすべて異なる必要があります",
        );
      }
      break;
    case "pickup_only":
      if (!hasPickup || hasDelivery || hasReturn) {
        throw new InvalidMovementPatternError(
          "引取のみは引取店舗が必須で、納車店舗・返却店舗は指定できません",
        );
      }
      break;
  }
}
