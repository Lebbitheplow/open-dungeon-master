// When a character died, in the world's time, so a spell that brings back
// the dead can hold to its window (SRD 5.1): Revivify a minute, Raise Dead
// ten days, Resurrection a century, True Resurrection two hundred years.
//
// The moment is written to the sheet's audit trail as it happens (the death
// engine calls noteDeathMoment), with the in-world clock and, in a fight,
// the round: rounds pass without the clock moving, six seconds each.
// A death the trail holds no moment for (one written before this, or set by
// hand) has no window to check, and the spell is allowed.

import { allocateSeq } from "@/lib/db/campaigns";
import { getDatabase, parseJson } from "@/lib/db/core";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getClock } from "@/lib/db/clock";
import { insertSheetAudit } from "@/lib/db/sheet-audit";

const KIND = "death_moment";

type Moment = { instant: number; encounterId: string | null; round: number | null };

export function noteDeathMoment(campaignId: string, characterId: string) {
  const encounter = getActiveEncounter(campaignId);
  const moment: Moment = {
    instant: getClock(campaignId).instant,
    encounterId: encounter?.id ?? null,
    round: encounter?.round ?? null,
  };
  insertSheetAudit({
    campaignId,
    characterId,
    turnId: null,
    kind: KIND,
    delta: moment,
    reason: "the moment of death",
    seq: allocateSeq(campaignId),
  });
}

function lastMoment(characterId: string): Moment | null {
  const row = getDatabase()
    .prepare(`SELECT delta_json FROM sheet_audit WHERE character_id = ? AND kind = ? ORDER BY seq DESC LIMIT 1`)
    .get(characterId, KIND) as { delta_json: string } | undefined;
  const moment = row ? parseJson<Moment | null>(row.delta_json, null) : null;
  return moment && typeof moment.instant === "number" ? moment : null;
}

// In-world minutes since the character died, or null when unknown.
export function minutesSinceDeath(campaignId: string, characterId: string): number | null {
  const moment = lastMoment(characterId);
  if (!moment) {
    return null;
  }
  let minutes = Math.max(0, getClock(campaignId).instant - moment.instant);
  const encounter = getActiveEncounter(campaignId);
  if (moment.encounterId && encounter?.id === moment.encounterId && moment.round !== null) {
    minutes += Math.max(0, encounter.round - moment.round) / 10;
  }
  return minutes;
}

export function describeMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes * 10) / 10} minute${minutes === 1 ? "" : "s"}`;
  }
  if (minutes < 60 * 24) {
    return `${Math.round(minutes / 60)} hours`;
  }
  if (minutes < 60 * 24 * 365) {
    return `${Math.round(minutes / (60 * 24))} days`;
  }
  return `${Math.round(minutes / (60 * 24 * 365))} years`;
}
