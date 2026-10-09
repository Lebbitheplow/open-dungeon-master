import { getDatabase, parseJson } from "@/lib/db/core";
import { listRaces } from "@/lib/content";
import { packRaceOptions, srdRaceFor } from "@/lib/content/race-options";
import type { SpeciesRules } from "@/lib/srd/race-id";

// The server's reader for src/lib/srd/race-id.ts speciesRulesFor: the size,
// the heavy-armor clause and the trait names of a species the bundled list
// does not carry, read from its pack row (with its parent) or its workshop
// entry. A workshop species is keyed by its entry id ("homebrew:<uuid>"),
// which no other author shares, so no owner is needed to find it.
//
// Kept for a minute: the rules ask on every derivation, and a DM's edit to
// their species reaches the table within that.

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; rules: SpeciesRules | null }>();

function workshopRow(id: string) {
  const row = getDatabase()
    .prepare(`SELECT id, name, data_json FROM homebrew_entries WHERE id = ? AND kind = 'race'`)
    .get(id.slice("homebrew:".length)) as { id: string; name: string; data_json: string } | undefined;
  return row
    ? { slug: id, name: row.name, documentSlug: "homebrew", document: "Homebrew", data: parseJson<Record<string, unknown>>(row.data_json, {}) }
    : null;
}

function read(raceId: string): SpeciesRules | null {
  if (raceId.startsWith("homebrew:")) {
    const row = workshopRow(raceId);
    const option = row ? packRaceOptions([row], [raceId])[0] : undefined;
    return option ? { size: option.size, heavyArmorSpeed: option.heavyArmorSpeed, traitNames: option.traitNames } : null;
  }
  const rows = listRaces({ limit: 500 }).map((row) => ({
    slug: row.slug,
    name: row.name,
    documentSlug: row.documentSlug,
    document: row.document,
    data: row.data,
  }));
  const option = rows.length ? packRaceOptions(rows, [raceId]).find((entry) => entry.id === raceId) : undefined;
  return option ? { size: option.size, heavyArmorSpeed: option.heavyArmorSpeed, traitNames: option.traitNames } : null;
}

export function serverSpeciesRules(raceId: string): SpeciesRules | null {
  const id = raceId.trim();
  // The bundled races answer from their own tables.
  if (!id || srdRaceFor(id)) {
    return null;
  }
  const held = cache.get(id);
  if (held && Date.now() - held.at < TTL_MS) {
    return held.rules;
  }
  const rules = read(id);
  cache.set(id, { at: Date.now(), rules });
  return rules;
}

// The rules of every species at a table the bundled list does not carry,
// for the campaign snapshot: the browser reads sizes and the rest from it.
export function speciesAtTable(races: string[]): Record<string, SpeciesRules> {
  const out: Record<string, SpeciesRules> = {};
  for (const race of new Set(races)) {
    const rules = serverSpeciesRules(race);
    if (rules) {
      out[race.trim()] = rules;
    }
  }
  return out;
}

// A workshop species was saved: its next read is fresh.
export function forgetSpeciesRules(raceId?: string): void {
  if (raceId) {
    cache.delete(raceId);
  } else {
    cache.clear();
  }
}
