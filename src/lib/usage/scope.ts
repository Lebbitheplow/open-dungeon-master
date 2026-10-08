import { AsyncLocalStorage } from "node:async_hooks";

// Who a piece of AI work is for, carried down the async call chain so the
// usage ledger (src/lib/usage/ledger.ts) and the shared-host policy
// (src/lib/shared-host.ts) can read it without every model, image and
// speech call threading a campaign id through its arguments.
//
// Entered once per request by currentUser (the account) and requireMember
// (the campaign), re-entered by the DM and media queues for the jobs they
// run later, so a picture painted a minute after the turn still lands on
// the campaign's row (issue #137).
export type UsageScope = { campaignId?: string; userId?: string };

const storage = new AsyncLocalStorage<UsageScope>();

export function currentUsageScope(): UsageScope {
  return storage.getStore() ?? {};
}

// Adds to the scope for the rest of the current async context: the route
// handler that called it and everything it awaits.
export function enterUsageScope(patch: UsageScope): void {
  storage.enterWith({ ...currentUsageScope(), ...withoutBlanks(patch) });
}

export function runInUsageScope<T>(scope: UsageScope, fn: () => T): T {
  return storage.run({ ...currentUsageScope(), ...withoutBlanks(scope) }, fn);
}

// Captures the scope now, for a job that runs later from a queue whose
// own promise chain started outside any request.
export function bindUsageScope<T>(fn: () => Promise<T>, extra: UsageScope = {}): () => Promise<T> {
  const scope = { ...currentUsageScope(), ...withoutBlanks(extra) };
  return () => storage.run(scope, fn);
}

function withoutBlanks(scope: UsageScope): UsageScope {
  const kept: UsageScope = {};
  if (scope.campaignId) {
    kept.campaignId = scope.campaignId;
  }
  if (scope.userId) {
    kept.userId = scope.userId;
  }
  return kept;
}
