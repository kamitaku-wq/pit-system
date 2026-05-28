import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Phase 64-A.23 GET-safe invariant guard.
//
// /r/[token]/page.tsx は Server Component で GET render 時に評価される。
// ここで token を consume するパス (verifyAndConsume*, confirmAndConsume*) を
// import すると、Slack/Discord unfurl preview、ブラウザ prefetch、
// メール scanner (Microsoft ATP / Proofpoint) の GET アクセスで token が焼ける。
// RFC 7231 GET safe / idempotent 原則違反 + production-killer。
//
// page.tsx は loadTokenStatusAction (consume なし) のみ呼ぶこと。
// consume は Client Component ConfirmForm の useActionState 経由 POST のみ。

describe("/r/[token] GET-safe invariant (Phase 64-A.23)", () => {
  it("page.tsx does not import any token-consuming function", () => {
    const file = readFileSync(
      path.resolve(process.cwd(), "src/app/r/[token]/page.tsx"),
      "utf8",
    );
    // import 行のみ抽出 (コメントの誤マッチ回避)
    const importLines = file
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line))
      .join("\n");
    expect(importLines).not.toMatch(/verifyAndConsume/);
    expect(importLines).not.toMatch(/confirmAndConsume/);
    // 想定 import が残っていることも確認 (回避的に消されないように)
    expect(importLines).toMatch(/loadTokenStatusAction/);
    expect(importLines).toMatch(/ConfirmForm/);
  });
});
