import { getDatabase, nowIso } from "@/lib/db/core";
import { NO_DEPARTURE, parseDeparture, type Departure } from "@/lib/dm/departure-logic";

// The column issue 503 Phases 2 and 3 added to the row behind a lasting
// companion (src/lib/db/companion-npcs.ts): the plan it holds before it
// leaves, and once it has gone how it went and the return it is gathering
// help for (src/lib/dm/departure-logic.ts). Read and written here by row id,
// beside the conscience columns (src/lib/db/companion-conscience.ts).
//
// The plan (`intent`) is a storyteller secret (src/lib/dm/viewer.ts): only
// the AI's prompt and a person running the table read it. Nothing here
// decides who may; every reader that shows it to someone asks.

export function companionDeparture(npcId: string): Departure {
  const row = getDatabase().prepare(`SELECT departure_json FROM npcs WHERE id = ?`).get(npcId) as
    | { departure_json: string }
    | undefined;
  return parseDeparture(row?.departure_json ?? "");
}

export function saveDeparture(npcId: string, departure: Departure) {
  const empty = !departure.intent && !departure.gone && !departure.turned;
  getDatabase()
    .prepare(`UPDATE npcs SET departure_json = ?, updated_at = ? WHERE id = ?`)
    .run(empty ? "" : JSON.stringify(departure), nowIso(), npcId);
}

export function clearDeparture(npcId: string) {
  saveDeparture(npcId, NO_DEPARTURE);
}

// Every row at this table with a departure record, gone or still planning.
export function listDepartures(campaignId: string): Array<{ npcId: string; name: string; departure: Departure }> {
  const rows = getDatabase()
    .prepare(`SELECT id, name, departure_json FROM npcs WHERE campaign_id = ? AND departure_json != ''`)
    .all(campaignId) as Array<{ id: string; name: string; departure_json: string }>;
  return rows.map((row) => ({ npcId: row.id, name: row.name, departure: parseDeparture(row.departure_json) }));
}

// Shadow levelling: every award of experience the party earns while a
// companion is away is counted on its record (src/lib/dm/mutations.ts
// award_xp), and the sheet takes it up when it is instantiated again.
export function shadowExperience(campaignId: string, amount: number) {
  const xp = Math.max(0, Math.round(amount));
  if (!xp) {
    return;
  }
  for (const entry of listDepartures(campaignId)) {
    const gone = entry.departure.gone;
    if (gone) {
      saveDeparture(entry.npcId, { ...entry.departure, gone: { ...gone, xpSince: gone.xpSince + xp } });
    }
  }
}
