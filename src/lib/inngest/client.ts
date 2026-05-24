import { inngest } from "./instance";
import { outboxDispatcher } from "./functions/outbox-dispatcher";

export { inngest };

// 全 functions を 1 箇所に集約 (serve route に渡す用)
export const inngestFunctions = [
  outboxDispatcher,
  // Phase D-3 で inboxWorker 追加
];
