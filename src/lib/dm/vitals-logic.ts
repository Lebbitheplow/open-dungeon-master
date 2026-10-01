// Pure rules for the body of a character: what falling to 0 hit points and
// rising from it write on the sheet, what a level of exhaustion costs, and
// how a creature is stabilized. Database-free like death-logic.ts and
// condition-logic.ts, so the handlers that write (death.ts, pc-damage.ts,
// stabilize.ts, rest-tools.ts) all decide from one place.
import {
  effectiveMaxHp,
  removeConditions,
  ROUNDS_PER_MINUTE,
  type ConditionMetaMap,
} from "@/lib/dm/condition-logic";
import type { DeathTrack } from "@/lib/dm/death-logic";

export const UNCONSCIOUS = "unconscious";
export const PRONE = "prone";
// Written by the suffocation hazard on a creature that ran out of air, and
// cleared (clear_condition) when it can breathe again. While it stands,
// nothing heals or stabilizes the creature (SRD 5.1, Suffocating).
export const SUFFOCATING = "suffocating";
// The source word on the unconscious of a stabilized creature, whose rounds
// count down to the hit point it regains.
export const STABLE_SOURCE = "stable";

type Held = { conditions: string[]; conditionMeta?: ConditionMetaMap };

const holds = (conditions: string[], name: string) =>
  conditions.some((entry) => entry.toLowerCase() === name);

// A creature at 0 hit points is unconscious, and an unconscious creature
// falls prone. Both are written once; an unconscious that was already there
// for another reason (a Sleep spell) keeps its own duration.
export function downConditions(held: Held): { conditions: string[]; conditionMeta: ConditionMetaMap } {
  const conditions = [...held.conditions];
  for (const name of [UNCONSCIOUS, PRONE]) {
    if (!holds(conditions, name)) {
      conditions.push(name);
    }
  }
  return { conditions, conditionMeta: { ...(held.conditionMeta ?? {}) } };
}

// The conditions a creature is under for whoever attacks or targets it: the
// stored list, and unconscious and prone for a living creature at 0 hit
// points whose sheet does not say so (one that dropped before the engine
// wrote them, or was set to 0 by a correction).
export function conditionsOf(sheet: {
  conditions: string[];
  currentHp: number;
  deathSaves?: { dead: boolean } | null;
}): string[] {
  if (sheet.currentHp > 0 || sheet.deathSaves?.dead) {
    return sheet.conditions;
  }
  return downConditions({ conditions: sheet.conditions }).conditions;
}

// Hit points are back: the creature wakes and is still on the ground.
// Standing up is its own to do.
export function wakeConditions(held: Held): { conditions: string[]; conditionMeta: ConditionMetaMap } {
  const cleared = removeConditions(held.conditions, held.conditionMeta, [UNCONSCIOUS]);
  return { conditions: cleared.conditions, conditionMeta: cleared.meta };
}

// A stable creature regains 1 hit point after 1d4 hours (SRD 5.1,
// Stabilizing a Creature). The wait rides on its unconscious condition as a
// duration, so the same two clocks that run every other duration run it.
export function stableTimer(held: Held, hours: number): ConditionMetaMap {
  const rounds = Math.max(1, Math.round(hours)) * 60 * ROUNDS_PER_MINUTE;
  return {
    ...(held.conditionMeta ?? {}),
    [UNCONSCIOUS]: { rounds, source: STABLE_SOURCE },
  };
}

// Damage broke the stabilization: the wait is off.
export function withoutStableTimer(meta: ConditionMetaMap | undefined): ConditionMetaMap {
  const next: ConditionMetaMap = { ...(meta ?? {}) };
  if (next[UNCONSCIOUS]?.source === STABLE_SOURCE) {
    delete next[UNCONSCIOUS];
  }
  return next;
}

// The most in-world hours 1d4 can ask for. A stable creature with no timer
// of its own (stabilized before timers were kept) wakes once this much time
// has passed in one stretch.
export const STABLE_WAKE_HOURS_MAX = 4;

export type ExhaustionPatch = {
  exhaustion: number;
  currentHp?: number;
  deathSaves?: DeathTrack;
};

// One step on the exhaustion track, with what the new level does to the
// body. Level 4 halves the maximum, so hit points above the half are lost;
// level 6 is death, and the dead hold no hit points. The maximum is the real
// one: a caller that hands in the whole sheet has its Amulet of Health's hit
// points counted (effectiveMaxHp reads level, abilities and equipment), so a
// level of exhaustion never clips them to the number stored on the sheet.
export function exhaustionPatch(
  sheet: Parameters<typeof effectiveMaxHp>[0] & { currentHp: number; exhaustion: number },
  level: number,
): ExhaustionPatch {
  const exhaustion = Math.max(0, Math.min(6, Math.round(level)));
  if (exhaustion >= 6) {
    return {
      exhaustion,
      currentHp: 0,
      deathSaves: { successes: 0, failures: 3, stable: false, dead: true },
    };
  }
  const ceiling = effectiveMaxHp({ ...sheet, exhaustion });
  return {
    exhaustion,
    ...(sheet.currentHp > ceiling ? { currentHp: ceiling } : {}),
  };
}

// "exhaustion", "exhausted", "exhaustion 2": every word for the track.
export function namesExhaustion(condition: string): boolean {
  return /^exhaust/.test(condition.trim().toLowerCase());
}

export type StabilizeMethod = "check" | "kit" | "spell";

// How the healer is going about it, from whatever the caller wrote.
export function stabilizeMethod(raw: string | undefined): StabilizeMethod {
  const text = (raw ?? "").toLowerCase();
  if (/kit/.test(text)) {
    return "kit";
  }
  if (/spare|spell|cantrip/.test(text)) {
    return "spell";
  }
  return "check";
}

export const STABILIZE_DC = 10;
