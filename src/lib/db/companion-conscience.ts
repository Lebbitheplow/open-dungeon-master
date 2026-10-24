import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { normalizeValues, parseValues, type CompanionValue } from "@/lib/dm/companion-values-logic";
import { parseConscience, type Conscience } from "@/lib/dm/conscience-logic";

// The three columns issue 503 added to the row behind a lasting companion
// (src/lib/db/companion-npcs.ts): what it holds to, where it stands on the
// conscience ladder, and the sheet it left with. Read and written here by
// row id, so the NPC record everyone else reads (src/lib/db/npcs.ts) stays
// as it was; an ordinary NPC simply has all three empty.

type Row = { values_json: string; conscience_json: string; companion_snapshot_json: string };

function row(npcId: string): Row | null {
  return (
    (getDatabase()
      .prepare(`SELECT values_json, conscience_json, companion_snapshot_json FROM npcs WHERE id = ?`)
      .get(npcId) as Row | undefined) ?? null
  );
}

export function companionValues(npcId: string): CompanionValue[] {
  return parseValues(row(npcId)?.values_json ?? "");
}

export function setCompanionValues(npcId: string, values: readonly unknown[]): CompanionValue[] {
  const normalized = normalizeValues(values);
  getDatabase()
    .prepare(`UPDATE npcs SET values_json = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(normalized), nowIso(), npcId);
  return normalized;
}

// Values are written once, when the row first stands behind a companion: a
// person does not change what they hold because they rejoined.
export function seedCompanionValues(npcId: string, values: readonly CompanionValue[]) {
  getDatabase()
    .prepare(`UPDATE npcs SET values_json = ? WHERE id = ? AND values_json = ''`)
    .run(JSON.stringify(values), npcId);
}

export function companionConscience(npcId: string): Conscience {
  return parseConscience(row(npcId)?.conscience_json ?? "");
}

export function saveConscience(npcId: string, conscience: Conscience) {
  getDatabase()
    .prepare(`UPDATE npcs SET conscience_json = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(conscience), nowIso(), npcId);
}

// The sheet a lasting companion left with (#503 Phase 0.4): the whole
// stored sheet as it stood, with the level and experience it had, so the
// same person can come back (src/lib/dm/companion-return.ts) and a later
// phase can fight as them.
export type DepartedSheet = {
  level: number;
  xp: number;
  sheet: Record<string, unknown>;
  at: string;
};

export function departedSheet(npcId: string): DepartedSheet | null {
  const raw = row(npcId)?.companion_snapshot_json ?? "";
  if (!raw) {
    return null;
  }
  const parsed = parseJson<Partial<DepartedSheet> | null>(raw, null);
  if (!parsed || !parsed.sheet || typeof parsed.sheet !== "object") {
    return null;
  }
  return {
    level: Math.max(1, Math.min(20, Math.round(Number(parsed.level) || 1))),
    xp: Math.max(0, Math.round(Number(parsed.xp) || 0)),
    sheet: parsed.sheet,
    at: typeof parsed.at === "string" ? parsed.at : "",
  };
}

export function saveDepartedSheet(npcId: string, snapshot: DepartedSheet | null) {
  getDatabase()
    .prepare(`UPDATE npcs SET companion_snapshot_json = ?, updated_at = ? WHERE id = ?`)
    .run(snapshot ? JSON.stringify(snapshot) : "", nowIso(), npcId);
}
