import { getDatabase, parseJson } from "@/lib/db/core";
import { normalizeAmbience, type AmbienceState } from "@/lib/ambience/logic";

// What is playing at this table: one bed and one music cue, or silence.
//
// A column on the campaign row rather than a table, for the same reason the
// scene tracker is one: there is at most one of it, and it is worthless
// history. Nobody wants to know what the tavern sounded like last Tuesday.

export function getAmbience(campaignId: string): AmbienceState {
  const row = getDatabase()
    .prepare(`SELECT ambience_json FROM campaigns WHERE id = ?`)
    .get(campaignId) as { ambience_json?: string } | undefined;
  return normalizeAmbience(parseJson(row?.ambience_json ?? "", null));
}

export function setAmbience(campaignId: string, state: AmbienceState) {
  getDatabase()
    .prepare(`UPDATE campaigns SET ambience_json = ? WHERE id = ?`)
    .run(JSON.stringify(state), campaignId);
}
