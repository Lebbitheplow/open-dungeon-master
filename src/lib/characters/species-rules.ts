import { getDatabase, parseJson } from "@/lib/db/core";
import { listRaces } from "@/lib/content";
import { packRaceOptions, srdRaceFor } from "@/lib/content/race-options";
import { libraryLabels } from "@/lib/db/homebrew";
import type { SpeciesRules } from "@/lib/srd/race-id";

// The server's reader for src/lib/srd/race-id.ts speciesRulesFor: the size,
// the heavy-armor clause and the trait names of a species the bundled list
// does not carry, read from its pack row (with its parent) or its workshop
// entry. A workshop species is keyed by its entry id ("homebrew:<uuid>"),
// which no other author shares, so no owner is needed to find it.
//
// Kept for a minute: the rules ask on every derivation, and a DM's edit to
// their species reaches the table within that. The row's name rides along
// (serverSpeciesName), read in the same pass.

const TTL_MS = 60_000;
type Read = { rules: SpeciesRules | null; name: string | null };
const cache = new Map<string, { at: number } & Read>();

function workshopRow(id: string) {
  const row = getDatabase()
    .prepare(`SELECT id, name, data_json FROM homebrew_entries WHERE id = ? AND kind = 'race'`)
    .get(id.slice("homebrew:".length)) as { id: string; name: string; data_json: string } | undefined;
  return row
    ? { slug: id, name: row.name, documentSlug: "homebrew", document: "Homebrew", data: parseJson<Record<string, unknown>>(row.data_json, {}) }
    : null;
}

function optionFor(raceId: string) {
  if (raceId.startsWith("homebrew:")) {
    const row = workshopRow(raceId);
    return row ? packRaceOptions([row], [raceId])[0] : undefined;
  }
  const rows = listRaces({ limit: 500 }).map((row) => ({
    slug: row.slug,
    name: row.name,
    documentSlug: row.documentSlug,
    document: row.document,
    data: row.data,
  }));
  return rows.length ? packRaceOptions(rows, [raceId]).find((entry) => entry.id === raceId) : undefined;
}

function read(raceId: string): Read {
  const held = cache.get(raceId);
  if (held && Date.now() - held.at < TTL_MS) {
    return held;
  }
  const option = optionFor(raceId);
  const fresh: Read = option
    ? { rules: { size: option.size, heavyArmorSpeed: option.heavyArmorSpeed, traitNames: option.traitNames }, name: option.name || null }
    : { rules: null, name: null };
  cache.set(raceId, { at: Date.now(), ...fresh });
  return fresh;
}

export function serverSpeciesRules(raceId: string): SpeciesRules | null {
  const id = raceId.trim();
  // The bundled races answer from their own tables.
  if (!id || srdRaceFor(id)) {
    return null;
  }
  return read(id).rules;
}

// A content-pack species by the name the builder offered it under
// ("Minotaur (Bhain Kwai)", not "bhain-kwai"): the raceLabel a sheet and a
// library character carry, so the cards, the sheet dialog, the GM and the
// portrait painter all read what the player picked. Null for a bundled id
// ("hill_dwarf" reads as its own words) and for a workshop species, whose
// name comes from its author's shelf (src/lib/db/homebrew.ts homebrewLabel).
export function serverSpeciesName(raceId: string): string | null {
  const id = raceId.trim();
  if (!id || id.startsWith("homebrew:") || srdRaceFor(id)?.id === id) {
    return null;
  }
  return read(id).name;
}

// libraryLabels with a content-pack species named as well; kept here, not in
// homebrew.ts, because the content reader this needs already reads homebrew.
export function libraryWords(character: Parameters<typeof libraryLabels>[0]): ReturnType<typeof libraryLabels> {
  const labels = libraryLabels(character);
  const packName = labels.raceLabel ? null : serverSpeciesName(character.race);
  return packName ? { ...labels, raceLabel: packName } : labels;
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
