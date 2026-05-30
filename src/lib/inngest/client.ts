import { inngest } from './instance';
import { outboxDispatcher } from './functions/outbox-dispatcher';
import { inboxWorker } from './functions/inbox-worker';
import { invitationExpirer } from './functions/invitation-expirer';

export { inngest };

export const inngestFunctions = [
  outboxDispatcher,
  inboxWorker,
  invitationExpirer,
];
