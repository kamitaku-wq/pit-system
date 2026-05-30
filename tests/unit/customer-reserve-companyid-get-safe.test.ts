import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Phase 64-A.31b-2: 公開予約 wizard エントリページの GET-safe invariant を静的に固定する。
//
// page.tsx は store 一覧の純 read (listPublicStores) のみを行い、予約の write は client wizard が
// POST /reservations route 経由でのみ起動する。page.tsx が write 系関数を import 可能な状態に
// すら置かないことを import 行のテキスト照合で保証する (実行・mock せず、A.23 の手法を踏襲)。
describe("/r/reserve/[companyId] GET-safe invariant (Phase 64-A.31b-2)", () => {
  const file = readFileSync(
    path.resolve(process.cwd(), "src/app/r/reserve/[companyId]/page.tsx"),
    "utf8",
  );
  const importLines = file
    .split("\n")
    .filter((line) => /^\s*import\b/.test(line) || /from\s+["']/.test(line))
    .join("\n");

  it("page.tsx does not import any write/consume function", () => {
    // 予約 write / token consume / 可用性 gate は GET で呼べてはならない。
    expect(importLines).not.toMatch(/createPublicReservation/);
    expect(importLines).not.toMatch(/createCustomerReservation/);
    expect(importLines).not.toMatch(/checkReservationSlotAvailable/);
    expect(importLines).not.toMatch(/verifyAndConsume/);
    expect(importLines).not.toMatch(/confirmAndConsume/);
  });

  it("page.tsx imports only the read surface + client wizard", () => {
    // 想定 import の存在も確認 (read 関数の回避的削除や wizard 差し替えの検知)。
    expect(importLines).toMatch(/listPublicStores/);
    expect(importLines).toMatch(/ReservationWizard/);
  });
});
