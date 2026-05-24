import { inngest } from './instance';
import { outboxDispatcher } from './functions/outbox-dispatcher';
import { inboxWorker } from './functions/inbox-worker';

export { inngest };

export const inngestFunctions = [
  outboxDispatcher,
  inboxWorker,
];
