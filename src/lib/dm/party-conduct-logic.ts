// A lasting companion inside the party (issue 503 Phase 4), the pure half:
// what its standing with each character changes about what it does for
// them, before anyone leaves. Small and bounded, like the persuasion
// modifier; each is a server outcome the AI narrates, with the reason in the
// tool result.
//   - aid: one wary of a character, or worse, spends no spell slot and no
//     potion on them unless they are dying;
//   - orders: under a player's command, it refuses an order that would walk
//     it out of a foe's reach (an opportunity attack) when it is wary of that
//     player's character, or worse;
//   - its share: a mercenary wary of the party, or worse, wants its share
//     before a fight and neither attacks nor casts in it until paid;
//   - protection: a devoted one takes a blow meant for that friend, once a
//     fight, with its reaction (use_reaction, "Take the Blow").
//
// Pure, with relative imports only, so scripts/test-party-conduct.mjs loads
// it directly.

import { friendshipTier, tierIndex, TIER_LABEL } from "./relationship-logic.ts";
import type { CompanionValue } from "./companion-values-logic.ts";

// Wary of them, or worse.
export function waryOrWorse(approval: number | null): boolean {
  return approval !== null && tierIndex(friendshipTier(approval)) <= tierIndex("wary");
}

export function devotedTo(approval: number | null): boolean {
  return approval !== null && friendshipTier(approval) === "devoted";
}

// How the companion stands with them, as a clause after its name.
function standing(approval: number): string {
  const tier = friendshipTier(approval);
  return tier === "disliked" ? "dislikes them" : tier === "hostile" ? "is hostile to them" : `is ${TIER_LABEL[tier]}`;
}

// ---- aid ----

export type Spend = "slot" | "potion";

export type AidCase = {
  companion: string;
  target: string;
  // The companion's standing with the target; null when they have none.
  approval: number | null;
  // At 0 hit points and neither stable nor dead: they would otherwise die.
  dying: boolean;
  spend: Spend;
};

// The refusal, or null when the companion spends it.
export function aidRefusal(input: AidCase): string | null {
  if (input.dying || !waryOrWorse(input.approval)) {
    return null;
  }
  const what = input.spend === "slot" ? "a spell slot" : "a potion";
  return `${input.companion} will not spend ${what} on ${input.target}: ${input.companion} ${standing(input.approval!)} (${input.approval}). Only if ${input.target} were dying. Nothing was spent.`;
}

// What the Bonds row and the table line say was refused.
export function aidRefusedWords(input: Pick<AidCase, "target" | "spend">): string {
  return `${input.spend === "slot" ? "a spell" : "a potion"} for ${input.target}`;
}

// ---- orders ----

export function riskyOrderRefusal(input: { companion: string; commander: string; approval: number | null; provokers: readonly string[] }): string | null {
  if (!input.provokers.length || !waryOrWorse(input.approval)) {
    return null;
  }
  return `${input.companion} will not walk out of ${input.provokers.join(" and ")}'s reach on ${input.commander}'s word: ${input.companion} ${standing(input.approval!)}. Take a path that leaves no foe's reach, or Disengage first. Nothing moved.`;
}

// ---- the mercenary's share ----

// A hireling's share of a fight's risk: ten gold a level.
export const SHARE_PER_LEVEL = 10;

export function shareOwed(input: { values: readonly Pick<CompanionValue, "value">[]; worstApproval: number | null; level: number }): number | null {
  if (!input.values.some((held) => held.value === "mercenary") || !waryOrWorse(input.worstApproval)) {
    return null;
  }
  return SHARE_PER_LEVEL * Math.max(1, Math.min(20, Math.round(input.level)));
}

export type Demand = { amount: number; goldBefore: number; encounterId: string };

export function demandMet(demand: Demand, gold: number): boolean {
  return gold >= demand.goldBefore + demand.amount;
}

export function demandRefusal(companion: string, demand: Demand, gold: number): string {
  const owed = Math.max(0, demand.goldBefore + demand.amount - gold);
  return `${companion} will not fight until paid their share: ${owed} gp still owed (modify_gold: delta -${owed} on a party member, +${owed} on ${companion}). Nothing was spent.`;
}

// ---- protection ----

export const GUARD_REACTION = "Take the Blow";

export function guardRefusal(input: { companion: string; ally: string; approval: number | null; usedThisFight: boolean }): string | null {
  if (!devotedTo(input.approval)) {
    return `${input.companion} is not devoted to ${input.ally}${input.approval === null ? "" : ` (${TIER_LABEL[friendshipTier(input.approval)]})`}: only a devoted companion takes a blow meant for a friend. Nothing was spent.`;
  }
  if (input.usedThisFight) {
    return `${input.companion} has already taken a blow for a friend this fight: once a fight. Nothing was spent.`;
  }
  return null;
}

// ---- the record ----

export type Conduct = {
  // The share asked before this fight, until it is paid.
  demand: Demand | null;
  // The fight it last took a blow in.
  guardedIn: string;
  // The last thing it refused, and when (clock minutes), for the Bonds row.
  refused: { what: string; at: number } | null;
};

export const NO_CONDUCT: Conduct = { demand: null, guardedIn: "", refused: null };

// A refusal shows on the Bonds row for a day of the campaign's clock.
export const REFUSAL_SHOWN_MINUTES = 24 * 60;

const num = (value: unknown) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);

export function parseConduct(raw: string): Conduct {
  if (!raw) {
    return NO_CONDUCT;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Conduct>;
    const demand = parsed.demand && typeof parsed.demand === "object"
      ? { amount: Math.max(0, num(parsed.demand.amount)), goldBefore: Math.max(0, num(parsed.demand.goldBefore)), encounterId: String(parsed.demand.encounterId ?? "").slice(0, 80) }
      : null;
    const refused = parsed.refused && typeof parsed.refused === "object" && typeof parsed.refused.what === "string"
      ? { what: parsed.refused.what.slice(0, 120), at: Math.max(0, num(parsed.refused.at)) }
      : null;
    return { demand: demand && demand.amount > 0 ? demand : null, guardedIn: typeof parsed.guardedIn === "string" ? parsed.guardedIn.slice(0, 80) : "", refused };
  } catch {
    return NO_CONDUCT;
  }
}
