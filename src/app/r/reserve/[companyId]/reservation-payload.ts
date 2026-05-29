// Phase 64-A.31b-2: 顧客公開予約 wizard の入力 → POST body 組み立てを担う純ロジック。
// ---------------------------------------------------------------------------
//
// React 非依存・サーバ非依存の純モジュール (client wizard と単体テストの両方が import する)。
// ここに切り出す最大の理由は **gate→create 同一 laneId / 同一 startAt-endAt invariant**
// (Phase 64-A.31b-1 seal) を 1 箇所に集約し、非 flaky な単体テストで固定するため。
//
// invariant (最重要・後続で壊さない):
//   picker (GET /slots) が返した {startAt, endAt, laneId} を **一切再計算せず verbatim** で
//   POST body に乗せる。集約値で gate して別 lane / 別時刻で create が最大の罠 (A.31b-1 §invariants)。
//   特に endAt を menu.durationMinutes から再導出してはならない (gate と create で食い違う)。

// picker / menus route が返す形状の鏡 (client は API route 経由で fetch するため値 import しない)。
export type PublicMenu = {
  id: string;
  name: string;
  durationMinutes: number;
  priceMinor: number;
};

// GET /slots の返り値 1 件。startAt/endAt は route が toISOString() した ISO 文字列。
export type PublicSlot = {
  startAt: string;
  endAt: string;
  laneId: string;
};

// 顧客入力フォーム (全項目を空文字許容の controlled string で保持)。
export type CustomerForm = {
  fullName: string;
  fullNameKana: string;
  email: string;
  phone: string;
  postalCode: string;
  address: string;
};

// 車両入力フォーム (全項目任意・空文字許容。modelYear は number input の文字列値)。
export type VehicleForm = {
  registrationNumber: string;
  vin: string;
  maker: string;
  model: string;
  modelYear: string;
  color: string;
};

// POST /reservations の body 形状 (route の bodySchema 入力の鏡)。
// optional 項目は undefined を入れておけば JSON.stringify が落とす (空文字を送ると
// email の .email() 等が invalid_body を返すため、空は必ず省略する)。
// A.32b: 公開フローでは email 必須 (本人確認 + 予約の宛先) かつ 6 桁 code を同送する。
export type ReservationPayload = {
  storeId: string;
  workMenuId: string;
  laneId: string;
  startAt: string;
  endAt: string;
  customer: {
    fullName: string;
    fullNameKana?: string;
    email?: string;
    phone?: string;
    postalCode?: string;
    address?: string;
  };
  vehicle: {
    registrationNumber?: string;
    vin?: string;
    maker?: string;
    model?: string;
    modelYear?: number;
    color?: string;
  };
  // email 6 桁本人確認コード。route が createVerifiedPublicReservation の verify gate に渡す (A.32b)。
  code: string;
  notes?: string;
};

export const emptyCustomerForm: CustomerForm = {
  fullName: "",
  fullNameKana: "",
  email: "",
  phone: "",
  postalCode: "",
  address: "",
};

export const emptyVehicleForm: VehicleForm = {
  registrationNumber: "",
  vin: "",
  maker: "",
  model: "",
  modelYear: "",
  color: "",
};

// trim して空なら undefined (送信時 JSON.stringify が落とす)。空文字を route に送らないための要。
function trimOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// number input の文字列 → 整数 or undefined。空・非整数は省略 (範囲検証は route 側に委譲)。
function parseModelYear(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isInteger(n) ? n : undefined;
}

export function cleanCustomer(form: CustomerForm): ReservationPayload["customer"] {
  return {
    fullName: form.fullName.trim(),
    fullNameKana: trimOrUndefined(form.fullNameKana),
    email: trimOrUndefined(form.email),
    phone: trimOrUndefined(form.phone),
    postalCode: trimOrUndefined(form.postalCode),
    address: trimOrUndefined(form.address),
  };
}

export function cleanVehicle(form: VehicleForm): ReservationPayload["vehicle"] {
  return {
    registrationNumber: trimOrUndefined(form.registrationNumber),
    vin: trimOrUndefined(form.vin),
    maker: trimOrUndefined(form.maker),
    model: trimOrUndefined(form.model),
    modelYear: parseModelYear(form.modelYear),
    color: trimOrUndefined(form.color),
  };
}

// wizard の選択状態 → POST body。laneId/startAt/endAt は slot から **verbatim** に取り、
// 再計算を一切しない (gate→create 同一パラメータ invariant の実体)。code は step7 で入力された
// 6 桁本人確認コードを trim して同送する (A.32b)。
export function buildReservationPayload(input: {
  store: { id: string };
  menu: { id: string };
  slot: PublicSlot;
  customer: CustomerForm;
  vehicle: VehicleForm;
  notes: string;
  code: string;
}): ReservationPayload {
  return {
    storeId: input.store.id,
    workMenuId: input.menu.id,
    laneId: input.slot.laneId,
    startAt: input.slot.startAt,
    endAt: input.slot.endAt,
    customer: cleanCustomer(input.customer),
    vehicle: cleanVehicle(input.vehicle),
    code: input.code.trim(),
    notes: trimOrUndefined(input.notes),
  };
}

// route の reason コード → 日本語表示文言。catch-all で未知 reason も握り潰さず汎用文を返す。
export function reasonToMessage(reason: string): string {
  switch (reason) {
    case "company_not_found":
    case "store_not_found":
    case "work_menu_not_found":
    case "lane_not_found":
      return "選択した内容が無効になりました。お手数ですが最初からやり直してください。";
    case "duration_mismatch":
    case "too_soon":
    case "too_far":
    case "closed":
    case "outside_business_hours":
    case "slot_unavailable":
      return "選択した時間枠はご予約いただけません。別の空き枠をお選びください。";
    case "status_not_seeded":
      return "現在ご予約を受け付けられません。お手数ですが店舗にお問い合わせください。";
    case "verification_failed":
      // not_found/invalid_code/expired/locked を畳んだ統一文言 (oracle 緩和)。再入力 or 再送で回復。
      return "認証コードが正しくないか、有効期限が切れています。コードを再入力するか、再送してください。";
    case "invalid_body":
      return "入力内容に誤りがあります。内容をご確認ください。";
    default:
      return "予約処理中にエラーが発生しました。時間をおいて再度お試しください。";
  }
}

// reason が「空き枠の選び直し (step3) で回復しうる」ものか。slot_unavailable 等の availability 系。
export function reasonIsSlotRecoverable(reason: string): boolean {
  switch (reason) {
    case "duration_mismatch":
    case "too_soon":
    case "too_far":
    case "closed":
    case "outside_business_hours":
    case "slot_unavailable":
      return true;
    default:
      return false;
  }
}

// reason が「選択した店舗/メニュー/lane が無効化された」= 最初 (step1) からやり直すべきものか。
export function reasonRequiresRestart(reason: string): boolean {
  switch (reason) {
    case "company_not_found":
    case "store_not_found":
    case "work_menu_not_found":
    case "lane_not_found":
      return true;
    default:
      return false;
  }
}
