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
