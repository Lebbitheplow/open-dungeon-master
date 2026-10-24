import { getDatabase, nowIso } from "@/lib/db/core";
import { parseAgenda, type Agenda } from "@/lib/dm/agenda-logic";

// The column issue 503 Phase 8 added to the row behind a lasting companion
// (src/lib/db/companion-npcs.ts): its hidden agenda (src/lib/dm/
// agenda-logic.ts), a storyteller secret. Nothing here decides who may read
// it; every reader that shows it to someone asks.

export function companionAgenda(npcId: string): Agenda | null {
  const row = getDatabase().prepare(`SELECT agenda_json FROM npcs WHERE id = ?`).get(npcId) as { agenda_json: string } | undefined;
  return parseAgenda(row?.agenda_json ?? "");
}

export function saveAgenda(npcId: string, agenda: Agenda | null) {
  getDatabase()
    .prepare(`UPDATE npcs SET agenda_json = ?, updated_at = ? WHERE id = ?`)
    .run(agenda ? JSON.stringify(agenda) : "", nowIso(), npcId);
}
