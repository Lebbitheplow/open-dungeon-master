// A Dominate spell decides the side its creature fights on (issue 503,
// src/lib/dm/combat-sides-logic.ts dominatorOf): whichever route starts or
// ends one (a cast, clear_condition, the caster's broken concentration, the
// caster falling, an expiry, an undo, a seed), every client redraws the
// sides from the server's word. The rows are written here, below the
// publisher, so the publisher registers itself (combat-sides.ts) and is
// called once the write's own handler has finished.

import { dominatorOf } from "@/lib/dm/combat-sides-logic";

type Held = { conditions: readonly string[]; conditionMeta?: unknown };
type Meta = Parameters<typeof dominatorOf>[1];

let publish: ((campaignId: string) => void) | null = null;

export function onDominationShift(listener: (campaignId: string) => void) {
  publish = listener;
}

export function noteDominationShift(campaignId: string, before: Held | null, after: Held | null) {
  const was = before ? dominatorOf(before.conditions, before.conditionMeta as Meta) : null;
  const now = after ? dominatorOf(after.conditions, after.conditionMeta as Meta) : null;
  const listener = publish;
  if (was !== now && listener) {
    queueMicrotask(() => {
      // A broadcast that cannot go (a script that closed its database the
      // moment it finished) must not take the process down: the next
      // update of the fight carries the sides.
      try {
        listener(campaignId);
      } catch {
        // Nothing to undo: the rows are written.
      }
    });
  }
}
