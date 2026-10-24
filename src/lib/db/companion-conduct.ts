import { getDatabase, nowIso } from "@/lib/db/core";
import { NO_CONDUCT, parseConduct, type Conduct } from "@/lib/dm/party-conduct-logic";

// The column issue 503 Phase 4 added to the row behind a lasting companion
// (src/lib/db/companion-npcs.ts): the share it wants before a fight, the
// fight it last took a blow in, and what it last refused
// (src/lib/dm/party-conduct-logic.ts). Read and written by row id.

export function companionConduct(npcId: string): Conduct {
  const row = getDatabase().prepare(`SELECT conduct_json FROM npcs WHERE id = ?`).get(npcId) as { conduct_json: string } | undefined;
  return parseConduct(row?.conduct_json ?? "");
}

export function saveConduct(npcId: string, conduct: Conduct) {
  const empty = !conduct.demand && !conduct.guardedIn && !conduct.refused;
  getDatabase()
    .prepare(`UPDATE npcs SET conduct_json = ?, updated_at = ? WHERE id = ?`)
    .run(empty ? "" : JSON.stringify(conduct), nowIso(), npcId);
}

export function clearConduct(npcId: string) {
  saveConduct(npcId, NO_CONDUCT);
}
