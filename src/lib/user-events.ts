import { sseChunk } from "@/lib/events";

// Account-wide streams: one entry per signed-in user with the notification
// bell mounted. Kept apart from the per-campaign bus in src/lib/events.ts
// because these events follow a person, not a table, and nothing here is
// replayable: a ping only says "your inbox changed", and the bell refetches.
//
// On globalThis for the same reason as the campaign bus: dev HMR would
// silently drop subscribers from a module-scoped map.

type Subscriber = (chunk: string) => void;

declare global {
  var __odmUserEventBus: Map<string, Set<Subscriber>> | undefined;
}

function bus() {
  return (globalThis.__odmUserEventBus ??= new Map<string, Set<Subscriber>>());
}

export function subscribeUser(userId: string, subscriber: Subscriber): () => void {
  let subscribers = bus().get(userId);
  if (!subscribers) {
    subscribers = new Set();
    bus().set(userId, subscribers);
  }
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      bus().delete(userId);
    }
  };
}

// Contentless on purpose: nothing private rides the long-lived connection.
// The bell pulls its own inbox over the authenticated fetch it already has.
export function pingUsers(userIds: string[]) {
  const chunk = sseChunk("notice", {});
  for (const userId of userIds) {
    const subscribers = bus().get(userId);
    if (!subscribers) {
      continue;
    }
    for (const subscriber of subscribers) {
      try {
        subscriber(chunk);
      } catch {
        subscribers.delete(subscriber);
      }
    }
  }
}
