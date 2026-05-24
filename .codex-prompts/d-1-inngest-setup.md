# Phase D-1: Inngest client + serve route (Codex 委任)

## ゴール

Inngest worker フレームワークを Next.js (App Router) に統合する最小ボイラープレート。

## ファイル構成

### 1. `package.json` 依存追加

Inngest を install。**pnpm 実行は Claude が後で行う**ため、本タスクでは package.json への追加のみ。

```json
"inngest": "^3.27.0"
```

ただし `package.json` の dependencies に existing entries を保ちつつ、`inngest` 行を辞書順に挿入。

### 2. `src/lib/inngest/client.ts` 新規作成

```typescript
import { Inngest } from "inngest";

// Inngest client (singleton)
// 環境変数:
//   - INNGEST_SIGNING_KEY (本番: 必須 / dev: optional)
//   - INNGEST_EVENT_KEY (本番: 必須 / dev: optional)
// dev mode (INNGEST_SIGNING_KEY 未設定) は `npx inngest-cli@latest dev` ローカル CLI を使う
export const inngest = new Inngest({
  id: "pit-system",
  name: "Pit System",
});

// 全 functions を 1 箇所に集約 (serve route に渡す用)
export const inngestFunctions = [
  // Phase D-2 で outboxDispatcher 追加
  // Phase D-3 で inboxWorker 追加
];
```

### 3. `src/app/api/inngest/route.ts` 新規作成

```typescript
import { serve } from "inngest/next";
import { inngest, inngestFunctions } from "@/lib/inngest/client";

// Next.js App Router serve handler
// /api/inngest GET / POST / PUT で Inngest CLI / cloud と同期
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});

// Node.js runtime (default) を明示 (Edge は postgres direct を扱えない)
export const runtime = "nodejs";
```

### 4. `.env.local` (既存) への追記ガイド (実際の書き換えはしない、コメントだけ)

実際の env 書き込みは avoid。プロンプト末尾に「ユーザーが手動で追加すべき env vars」を記載するだけ。

## 完了条件

- `pnpm typecheck` 緑 (※ pnpm 実行はしないが、コードが TS strict mode 通過)
- `src/lib/inngest/client.ts` 約 18 行
- `src/app/api/inngest/route.ts` 約 12 行
- package.json への inngest 依存追加
- 2 files 新規 + 1 file 更新

## 禁止事項

- pnpm install / pnpm add を実行しない (User がやる)
- .env.local を編集しない
- 既存ファイル (apply-raw-sql.ts 等) は触らない
- functions 配列は空のまま (D-2/D-3 で追加)

## User action item (プロンプト末尾の guidance)

```
# 次のステップ (User 作業):
# 1. pnpm add inngest
# 2. (本番) INNGEST_SIGNING_KEY + INNGEST_EVENT_KEY を .env.local に追記
# 3. (dev) npx inngest-cli@latest dev で localhost に Inngest CLI 起動
# 4. http://localhost:8288 で functions confirm
```
