// A foe who comes back to a later fight comes back as the last one left
// them (issue #667): hurt, knocked out, still under a condition with time
// left on it, worth only the XP the last fight did not pay. A raider
// knocked unconscious in one fight used to come into the next "Healthy" at
// full hit points, because every enemy row was built fresh. The rules are
// foe-carry-logic.ts; this file reads the rows and the world clock. Must
// not import encounter-tools or encounter-spawn (they import this).

import type { Campaign } from "@/lib/db/campaigns";
import { getClock } from "@/lib/db/clock";
import { getEncounter, getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { latestAppearance, survivorsOfLastFight } from "@/lib/db/foe-history";
import { carriedState, foesAboutLine, namesSurvivor, owedXp } from "@/lib/dm/foe-carry-logic";
import type { AbilityLedger } from "@/lib/dm/monster-abilities";
import { unknownRef, type ToolError } from "@/lib/dm/tool-errors";
import { resolveMonster } from "@/lib/bestiary";
import { textKey } from "@/lib/language/text-logic";
import type { SettingRef } from "@/lib/worlds/preset";
import type { ConditionMetaMap } from "@/lib/schemas/sheet";

// How long after a fight its survivors answer to their names alone, and
// are listed in GAME STATE: a day of world time. Past it a creature has
// rested whole anyway, and an old "Raider 2" should not catch a new one.
export const STILL_ABOUT_MINUTES = 24 * 60;
// GAME STATE lists at most this many, so a rout of goblins costs one line.
const STILL_ABOUT_MAX = 8;

export type Carry = {
  // The creature fled this same fight and comes back into it: its own row
  // takes the field again rather than a second row under the same name.
  rejoin?: string;
  arrives: {
    currentHp: number;
    conditions: string[];
    conditionMeta: ConditionMetaMap;
    xp: number;
    carriedFrom: string;
  };
  knockedOut: boolean;
  line: string;
  // What its legendary pools kept: the resistances left and the uses and
  // slots spent, until a long rest gives them back. Null for a creature
  // with none, or one that has rested.
  legendary: { resistances?: number; abilities?: AbilityLedger } | null;
};

function minutesSince(endedInstant: number | null, now: number): number {
  return endedInstant === null ? 0 : Math.max(0, now - endedInstant);
}

// The survivors of the last fight a name alone may bring back: within a
// day of world time of that fight.
function nameableSurvivors(campaignId: string): EncounterEnemy[] {
  const last = survivorsOfLastFight(campaignId);
  if (!last || last.encounter.endedInstant === null) {
    return [];
  }
  return minutesSince(last.encounter.endedInstant, getClock(campaignId).instant) <= STILL_ABOUT_MINUTES ? last.survivors : [];
}

// A survivor of the last fight a request names exactly ("Raider 2",
// "Snik"), alone: never the monster's own name, so a "Goblin" asked for is
// a fresh goblin (foe-carry-logic.ts namesSurvivor). Two who answer to it
// make it nobody's: the id says which.
export function survivorNamed(
  campaignId: string,
  setting: SettingRef,
  request: { monster: string; name?: string; count?: number },
): EncounterEnemy | null {
  const matches = nameableSurvivors(campaignId).filter((enemy) =>
    namesSurvivor(request, { displayName: enemy.displayName, monsterName: resolveMonster(enemy.slug, setting)?.baseName ?? enemy.slug }, textKey),
  );
  return matches.length === 1 ? matches[0] : null;
}

// The row a `returning` id names, as the creature is now: the id may be any
// row of it, from any earlier fight of this campaign.
export function returningRow(campaignId: string, enemyId: string): EncounterEnemy | null {
  const row = latestAppearance(enemyId.trim());
  return row && row.campaignId === campaignId ? row : null;
}

// The refusal of a `returning` id that names no creature of this campaign,
// listing who is still about.
export function unknownReturning(campaignId: string, ref: string): ToolError {
  const about = nameableSurvivors(campaignId).map((enemy) => ({ id: enemy.id, name: enemy.displayName }));
  return unknownRef("returning", ref, about, "Leave returning out to bring in a fresh creature.");
}

// What each entry brings, in order: a Carry for one coming back (it names
// the row it comes back from), null for one arriving fresh. Refuses a
// creature who died (rules), one already standing in this fight, and the
// same creature asked for twice.
export function arrivalsFor(
  campaign: Campaign,
  entries: Array<{ name: string; returning?: string }>,
  activeEncounterId: string | null,
): { carries: Array<Carry | null> } | ToolError {
  const now = getClock(campaign.id).instant;
  const seen = new Set<string>();
  const carries: Array<Carry | null> = [];
  for (const entry of entries) {
    if (!entry.returning) {
      carries.push(null);
      continue;
    }
    const prev = getEnemy(entry.returning);
    const fight = prev ? getEncounter(prev.encounterId) : null;
    if (!prev || !fight) {
      return unknownReturning(campaign.id, entry.returning);
    }
    if (seen.has(prev.id)) {
      return { error: `${prev.displayName} is asked for twice; name each creature once.`, retry: true };
    }
    seen.add(prev.id);
    const sameFight = fight.id === activeEncounterId;
    if (sameFight && prev.status === "alive") {
      return { error: `${prev.displayName} is already in this fight; leave them out of the call.`, retry: true };
    }
    const carried = carriedState(prev, sameFight ? 0 : minutesSince(fight.endedInstant, now));
    if ("refused" in carried) {
      return { error: carried.refused, refused: "rules" };
    }
    // A creature that left this same fight and comes back to it was paid
    // for on its first row already.
    const xp = sameFight ? 0 : owedXp(prev.xp, fight.outcome);
    const pool = fight.legendary.pools[prev.id];
    const ledger = fight.legendary.abilities?.[prev.id];
    const keep = !carried.rested && (pool || ledger);
    carries.push({
      arrives: { currentHp: carried.currentHp, conditions: carried.conditions, conditionMeta: carried.conditionMeta, xp, carriedFrom: prev.id },
      knockedOut: carried.knockedOut,
      line: carried.line,
      ...(sameFight ? { rejoin: prev.id } : {}),
      legendary: keep
        ? {
            ...(pool ? { resistances: pool.resistances } : {}),
            ...(ledger ? { abilities: { ...(ledger.uses ? { uses: { ...ledger.uses } } : {}), ...(ledger.slots ? { slots: { ...ledger.slots } } : {}) } } : {}),
          }
        : null,
    });
  }
  return { carries };
}

// GAME STATE's line on who is still about after the last fight, for the GM:
// within a day of it, the first few, with the id that brings one back. In a
// fight, the ones not already brought into it.
export function foesAboutBlock(campaign: Campaign, inFight: boolean): string {
  return foesAboutLine(
    nameableSurvivors(campaign.id)
      .slice(0, STILL_ABOUT_MAX)
      .map((enemy) => ({
        enemyId: enemy.id,
        displayName: enemy.displayName,
        status: enemy.status,
        currentHp: enemy.currentHp,
        maxHp: enemy.maxHp,
        conditions: enemy.conditions,
        conditionMeta: enemy.conditionMeta,
      })),
    inFight,
  );
}
