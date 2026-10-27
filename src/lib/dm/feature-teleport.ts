// A teleport a class feature's spend paid for, waiting for move_token.
//
// use_resource and an authored spend (src/lib/dm/resource-tools.ts,
// src/lib/dm/authored-spend-effects.ts) write one when the feature moves its
// user, or a creature they touch, without walking. move_token's teleport
// takes it back when it names the feature as its spell and the spender as
// casterCharacterId (src/lib/dm/token-rules.ts payForTeleport): the move costs
// no spell slot, and goes no farther than the feature allows. Without it the
// model had no way to make the move: a feature is no spell to cast, and a
// forced move is refused on the character's own turn.
//
// Held in memory, per sheet, for a few minutes, as a scroll's cast is
// (src/lib/srd/item-cast-credit.ts): long enough for the DM's reply to make
// the move it just paid for. A restart forgets them; the move is then
// refused as an unpaid teleport, and nothing was moved for free.

import { textKey } from "@/lib/language/text-logic";

const WINDOW_MS = 5 * 60 * 1000;

type Credit = { key: string; feet: number; at: number };

const credits = new Map<string, Credit[]>();

function live(sheetId: string, now: number): Credit[] {
  const kept = (credits.get(sheetId) ?? []).filter((credit) => now - credit.at <= WINDOW_MS);
  if (kept.length) {
    credits.set(sheetId, kept);
  } else {
    credits.delete(sheetId);
  }
  return kept;
}

// This character just spent `feature`, which teleports up to `feet`.
export function creditFeatureTeleport(sheetId: string, feature: string, feet: number, now = Date.now()): void {
  const key = textKey(feature);
  credits.set(sheetId, [...live(sheetId, now).filter((credit) => credit.key !== key), { key, feet, at: now }]);
}

// The range of the waiting teleport this feature paid for, or null.
export function featureTeleportFeet(sheetId: string, feature: string, now = Date.now()): number | null {
  const key = textKey(feature);
  return live(sheetId, now).find((credit) => credit.key === key)?.feet ?? null;
}

// Takes the waiting teleport: true when the feature paid for this move.
export function takeFeatureTeleport(sheetId: string, feature: string, now = Date.now()): boolean {
  const key = textKey(feature);
  const kept = live(sheetId, now);
  const index = kept.findIndex((credit) => credit.key === key);
  if (index < 0) {
    return false;
  }
  kept.splice(index, 1);
  return true;
}
