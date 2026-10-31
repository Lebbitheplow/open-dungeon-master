// A foe who comes back after the fight they were in (issue #667): what they
// bring into the next one. A creature hurt or knocked out in one fight used
// to come into the next at full hit points, because every enemy row was
// built fresh from its stat block. Pure, database-free; foe-return.ts reads
// the rows and the world clock and calls these.
//
// SRD 5.1 is the spec:
// - Knocking a Creature Out: a creature knocked out is unconscious and
//   stable. A stable creature regains 1 hit point after 1d4 hours.
// - Resting: a long rest is at least 8 hours, and a creature must have at
//   least 1 hit point at its start to gain its benefits; at its end the
//   creature regains all its hit points, and one level of exhaustion goes.
//   A creature cannot benefit from more than one long rest in 24 hours.
// - Monsters have no hit dice to spend on a short rest (EnemyStats keeps
//   only the maximum), so wounds stay until the long rest.

import type { ConditionMeta, ConditionMetaMap } from "@/lib/dm/condition-logic";
import { ROUNDS_PER_MINUTE } from "@/lib/dm/condition-logic";
import { KNOCKED_OUT } from "@/lib/dm/knockout";
import { regenerationOf, type Regeneration } from "@/lib/dm/regeneration-text";
import { STABLE_WAKE_HOURS_MAX } from "@/lib/dm/vitals-logic";
import { healthState } from "@/lib/bestiary/health";

export const LONG_REST_MINUTES = 8 * 60;
// One long rest in 24 hours (SRD 5.1, Resting).
const DAY_MINUTES = 24 * 60;

// The share of a fight's XP the party was paid when it ended: a fight won
// pays in full, one the foes fled or settled by truce pays half, one the
// party fled pays nothing (the same split finishEncounter pays out).
export function outcomeShare(outcome: string): number {
  if (outcome === "victory") {
    return 1;
  }
  return outcome === "enemies_fled" || outcome === "truce" ? 0.5 : 0;
}

// What a foe who comes back is still worth: the part of its XP the last
// fight did not pay, so beating one raider twice pays for one raider.
export function owedXp(xp: number, previousOutcome: string): number {
  return Math.max(0, Math.round(xp * (1 - outcomeShare(previousOutcome))));
}

export type CarrySource = {
  displayName: string;
  status: string;
  currentHp: number;
  maxHp: number;
  conditions: string[];
  conditionMeta?: ConditionMetaMap;
  stats: { regeneration?: Regeneration; traits?: string[] };
};

export type Carried = {
  currentHp: number;
  conditions: string[];
  conditionMeta: ConditionMetaMap;
  // Still lying knocked out: in the fight, out of it until they come to.
  knockedOut: boolean;
  // A long rest came between the fights: what a day refills (uses, slots,
  // legendary resistances) is whole again.
  rested: boolean;
  // What the GM is told about how they come in.
  line: string;
};

// Knocked out at the end of their fight, whichever status the row was left
// with: a truce once marked a knocked-out foe "fled" (issue #667), and those
// rows are still lying in campaigns.
export function lyingKnockedOut(source: Pick<CarrySource, "status" | "currentHp" | "conditions" | "conditionMeta">): boolean {
  if (source.status === "dead" || source.currentHp > 0) {
    return false;
  }
  return source.conditions.some(
    (entry) => entry.trim().toLowerCase() === "unconscious" && source.conditionMeta?.[entry]?.source === KNOCKED_OUT,
  );
}

// The hours 1d4 gave a knocked-out creature to come to, as the blow wrote
// it (knockout.ts). A creature knocked out before the count was kept waits
// the longest the die allows.
export function wakeHoursOf(meta: ConditionMetaMap | undefined): number {
  const hours = meta?.unconscious?.wakeAfterHours;
  return typeof hours === "number" && hours >= 1 ? Math.min(STABLE_WAKE_HOURS_MAX, Math.round(hours)) : STABLE_WAKE_HOURS_MAX;
}

// How many long rests fit in `minutes` awake: one every 24 hours, the first
// after 8.
export function longRestsIn(minutes: number): number {
  if (minutes < LONG_REST_MINUTES) {
    return 0;
  }
  return 1 + Math.floor((minutes - LONG_REST_MINUTES) / DAY_MINUTES);
}

const EXHAUSTION = /^exhaustion(?:\s+(\d))?$/i;

// One instance of a condition, as time passes outside a fight: a duration
// counts down (ten rounds to the minute) and ends when it runs out; one
// that lasts until a long rest ends with the rest. Anything else is dropped:
// a condition with no lifetime of its own outside the fight (prone on a
// creature that got up, grappled, until someone's next turn) and anything a
// spell laid, because the caster's cleanup finds its conditions by the old
// fight's enemy id and could never end one carried onto a new row.
function carryInstance(instance: ConditionMeta, rounds: number, rests: number): ConditionMeta | null {
  if (instance.spell) {
    return null;
  }
  if (instance.untilLongRest) {
    return rests > 0 ? null : instance;
  }
  if (typeof instance.rounds === "number") {
    const left = instance.rounds - rounds;
    return left > 0 ? { ...instance, rounds: left } : null;
  }
  return null;
}

// The conditions a creature brings out of one fight into the next, after
// `minutes` of world time with `rests` long rests in them. The unconscious
// of a knocked-out creature is the caller's business (carriedState).
export function carryConditions(
  conditions: string[],
  meta: ConditionMetaMap | undefined,
  minutes: number,
  rests: number,
): { conditions: string[]; conditionMeta: ConditionMetaMap } {
  const rounds = Math.max(0, Math.floor(minutes)) * ROUNDS_PER_MINUTE;
  const kept: string[] = [];
  const keptMeta: ConditionMetaMap = {};
  for (const name of conditions) {
    const level = EXHAUSTION.exec(name.trim());
    if (level) {
      // A level of exhaustion goes with each long rest.
      const left = Number(level[1] ?? 1) - rests;
      if (left > 0) {
        kept.push(`exhaustion ${left}`);
      }
      continue;
    }
    const instance = meta?.[name];
    if (!instance) {
      continue;
    }
    // Every source of the condition is aged on its own; it holds while one
    // does, as instancesOf reads it (condition-logic.ts).
    const { others = [], ...head } = instance;
    const left = [head, ...others].flatMap((entry) => {
      const carried = carryInstance(entry, rounds, rests);
      return carried ? [carried] : [];
    });
    if (!left.length) {
      continue;
    }
    const [first, ...rest] = left;
    kept.push(name);
    keptMeta[name] = rest.length ? { ...first, others: rest } : first;
  }
  return { conditions: kept, conditionMeta: keptMeta };
}

// The hit points a creature's own exhaustion lets it hold (level 4 halves
// the maximum), as monster-abilities.ts enemyHpCap reads it.
function hpCap(maxHp: number, conditions: string[]): number {
  let level = 0;
  for (const entry of conditions) {
    const match = EXHAUSTION.exec(entry.trim());
    if (match) {
      level = Math.max(level, Number(match[1] ?? 1));
    }
  }
  return level >= 4 ? Math.floor(maxHp / 2) : maxHp;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// What a creature brings into a fight after `elapsedMinutes` of world time
// since its last one ended. A dead creature brings nothing: it is refused.
export function carriedState(source: CarrySource, elapsedMinutes: number): Carried | { refused: string } {
  if (source.status === "dead") {
    return { refused: `${source.displayName} died in an earlier fight and cannot fight again; leave them out.` };
  }
  const minutes = Math.max(0, Math.floor(elapsedMinutes));
  const regeneration = regenerationOf(source.stats);
  if (lyingKnockedOut(source)) {
    const wakeMinutes = wakeHoursOf(source.conditionMeta) * 60;
    const others = source.conditions.filter((entry) => !["unconscious", "prone"].includes(entry.trim().toLowerCase()));
    if (minutes < wakeMinutes) {
      // Still out: unconscious (and prone with it) and stable, the hours to
      // coming to counted down from the blow.
      const carried = carryConditions(others, source.conditionMeta, minutes, 0);
      const hoursLeft = Math.max(1, Math.ceil((wakeMinutes - minutes) / 60));
      return {
        currentHp: 0,
        conditions: [...carried.conditions, "unconscious", "prone"],
        conditionMeta: { ...carried.conditionMeta, unconscious: { source: KNOCKED_OUT, wakeAfterHours: hoursLeft } },
        knockedOut: true,
        rested: false,
        line: `still knocked out from the last fight: unconscious and stable, they come to with 1 hit point in about ${plural(hoursLeft, "hour")}`,
      };
    }
    // Came to with 1 hit point, and rested from there.
    const awake = minutes - wakeMinutes;
    const rests = longRestsIn(awake);
    const carried = carryConditions(others, source.conditionMeta, minutes, rests);
    const cap = hpCap(source.maxHp, carried.conditions);
    const currentHp = rests > 0 ? cap : 1;
    return {
      currentHp,
      ...carried,
      knockedOut: false,
      rested: rests > 0,
      line: rests > 0 ? "knocked out in the last fight, since come to and rested back to full hit points" : "knocked out in the last fight, since come to with 1 hit point",
    };
  }
  const rests = longRestsIn(minutes);
  const carried = carryConditions(source.conditions, source.conditionMeta, minutes, rests);
  const cap = hpCap(source.maxHp, carried.conditions);
  // A creature that regenerates heals as the rounds pass (a troll's 10 a
  // round is whole within a minute of most fights); a troll left down at 0
  // rises once a round has gone by.
  const regenerated = regeneration ? regeneration.amount * minutes * ROUNDS_PER_MINUTE : 0;
  const wounded = Math.max(source.currentHp, 0) + regenerated;
  const currentHp = rests > 0 ? cap : Math.min(cap, Math.max(1, wounded));
  const whole = currentHp >= cap;
  return {
    currentHp,
    ...carried,
    knockedOut: false,
    rested: rests > 0,
    line: whole
      ? rests > 0
        ? "rested back to full hit points since the last fight"
        : "whole again since the last fight"
      : `${healthState(currentHp, source.maxHp)} as the last fight left them`,
  };
}

// The name rule a human GM's typed line and a model that forgets the id
// both lean on: a request names a survivor of the last fight by the name
// the tracker showed ("Raider 2", "Snik"), alone, and that name is not the
// creature's own monster name (a "Goblin" asked for is a goblin, fresh).
export function namesSurvivor(
  request: { monster: string; name?: string; count?: number },
  survivor: { displayName: string; monsterName: string },
  key: (text: string) => string,
): boolean {
  if ((request.count ?? 1) !== 1) {
    return false;
  }
  const wanted = key(request.name?.trim() || request.monster);
  return wanted === key(survivor.displayName) && wanted !== key(survivor.monsterName);
}

export type SurvivorLine = {
  enemyId: string;
  displayName: string;
  status: string;
  currentHp: number;
  maxHp: number;
  conditions: string[];
  conditionMeta?: ConditionMetaMap;
};

// GAME STATE's line on who is still about after the last fight, for the GM
// alone: their enemyId, so a later fight can bring one back as they are.
export function foesAboutLine(survivors: SurvivorLine[], inFight: boolean): string {
  if (!survivors.length) {
    return "";
  }
  const parts = survivors.map((foe) => {
    const state = lyingKnockedOut(foe)
      ? "knocked out"
      : `${foe.status === "fled" ? "fled" : "left standing"}, ${foe.currentHp >= foe.maxHp ? "unhurt" : healthState(foe.currentHp, foe.maxHp)}`;
    return `${foe.displayName} [enemyId=${foe.enemyId}] ${state}`;
  });
  const tools = inFight ? "add_enemies" : "start_encounter or add_enemies";
  return `Still about after the last fight (GM only): ${parts.join("; ")}. To bring one back as they are, pass returning=<enemyId> to ${tools}; anyone not listed comes in fresh.`;
}
