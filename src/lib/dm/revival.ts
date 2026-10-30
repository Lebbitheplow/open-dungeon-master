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
import { insertSheetAudit, markReverted } from "@/lib/db/sheet-audit";

const KIND = "death_moment";

type Moment = { instant: number; encounterId: string | null; round: number | null };

// `at` is the instant it happened when that was not now: a death save
// rolled while a rest or a journey moved the clock came seconds into that
// stretch, not at its end (death.ts settleDying), so Revivify's minute is
// counted from then.
export function noteDeathMoment(campaignId: string, characterId: string, at?: number) {
  const encounter = getActiveEncounter(campaignId);
  const moment: Moment = {
    instant: at ?? getClock(campaignId).instant,
    encounterId: encounter?.id ?? null,
    round: encounter?.round ?? null,
  };
  // The turn the death came in, when there is one, so the moment is read
  // beside the death state it dates (src/lib/db/sheet-audit.ts).
  insertSheetAudit({
    campaignId,
    characterId,
    kind: KIND,
    delta: moment,
    reason: "the moment of death",
    seq: allocateSeq(campaignId),
  });
}

// The latest death still standing: one undone is not counted (forgetDeath).
function lastMoment(characterId: string): Moment | null {
  const row = getDatabase()
    .prepare(
      `SELECT delta_json FROM sheet_audit WHERE character_id = ? AND kind = ? AND reverted_at IS NULL ORDER BY seq DESC LIMIT 1`,
    )
    .get(characterId, KIND) as { delta_json: string } | undefined;
  const moment = row ? parseJson<Moment | null>(row.delta_json, null) : null;
  return moment && typeof moment.instant === "number" ? moment : null;
}

// A death undone (the audited death state reverted, alone or with its turn)
// never happened: its moment is marked undone with it, so a revival spell
// never times its window from it, and the "Died" line goes from the
// character's story. Both were written just after the death state at
// `afterSeq` (death.ts recordDeath), before any later death of theirs. Left
// in place, a death the table took back still read as the character's
// latest, and the chronicle kept a death that did not happen (issue #622).
// Returns the moment's row, for the event log, or null when none was kept.
export function forgetDeath(campaignId: string, characterId: string, afterSeq: number, undoneBy: string): string | null {
  const db = getDatabase();
  const nextDeath = db
    .prepare(
      `SELECT seq FROM sheet_audit WHERE campaign_id = ? AND character_id = ? AND kind = 'death_state' AND seq > ?
       ORDER BY seq ASC LIMIT 1`,
    )
    .get(campaignId, characterId, afterSeq) as { seq: number } | undefined;
  const before = nextDeath?.seq ?? Number.MAX_SAFE_INTEGER;
  const moment = db
    .prepare(
      `SELECT id FROM sheet_audit WHERE campaign_id = ? AND character_id = ? AND kind = ? AND seq > ? AND seq < ?
         AND reverted_at IS NULL
       ORDER BY seq ASC LIMIT 1`,
    )
    .get(campaignId, characterId, KIND, afterSeq, before) as { id: string } | undefined;
  if (moment) {
    markReverted(moment.id, undoneBy);
  }
  db.prepare(
    `DELETE FROM character_events WHERE id = (
       SELECT id FROM character_events
       WHERE campaign_id = ? AND campaign_character_id = ? AND kind = 'death' AND seq > ? AND seq < ?
       ORDER BY seq ASC LIMIT 1
     )`,
  ).run(campaignId, characterId, afterSeq, before);
  return moment?.id ?? null;
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
