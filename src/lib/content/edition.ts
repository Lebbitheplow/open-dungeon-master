// The one ruleset ODM plays: the 2014 rules (SRD 5.1), nothing from the
// 2024 revision (SRD 5.2). Open5e tags each of its documents with a game
// system, and the documents written for 2024 ("5e-2024") are named here.
// scripts/import-open5e.mjs leaves every row of them out of the content pack
// and stops when Open5e lists a 2024 document this set does not name, so a
// new one cannot slip in. The read-time filters in src/lib/content keep a
// pack built before that (PACK_REVISION 0) from serving them either.
//
// No "@/" imports: the importer loads this file directly.
import { textKey } from "../language/text-logic.ts";

export const EDITION_2024_DOCUMENTS: ReadonlySet<string> = new Set(["srd-2024", "open5e-2024"]);

export const EDITION_2024_GAMESYSTEM = "5e-2024";

export function isEdition2024(documentSlug: string | null | undefined): boolean {
  return EDITION_2024_DOCUMENTS.has(String(documentSlug ?? ""));
}

// The clause that keeps a query of the pack to the documents this engine
// plays, for every reader that writes its own SQL. Built from the constant
// set above, never from input.
export const PLAYED_DOCUMENTS_SQL = `document_slug NOT IN (${[...EDITION_2024_DOCUMENTS].map((slug) => `'${slug}'`).join(", ")})`;

// The content pack's revision, kept in its SQLite user_version header. The
// importer writes it; scripts/fetch-content-pack.mjs replaces a pack below
// it, and the server says so in its log and on the licenses page. Raise it whenever a pack
// built by an older importer would serve the wrong rules.
//   1: no 2024 rows; SRD 5.1 packs, mounts and tack backfilled.
export const PACK_REVISION = 1;

// Spells that exist only in the 2024 rules. A sheet written before they
// were taken out may still list one; it loads, but the engine does not cast
// it and the next edit asks for a 2014 spell in its place. Power Word Heal
// is not here: it is a 2014 spell too, restated in authored-spells.json.
const REVISED_ONLY_SPELLS = [
  "Befuddlement",
  "Divine Smite",
  "Elementalism",
  "Shining Smite",
  "Sorcerous Burst",
  "Starry Wisp",
  "Summon Dragon",
];

const REVISED_ONLY = new Map(REVISED_ONLY_SPELLS.map((name) => [textKey(name), name] as const));

// The 2024-only spell a name is, in its printed form, or null.
export function revisedOnlySpell(name: string): string | null {
  return REVISED_ONLY.get(textKey(name)) ?? null;
}

// What a player or the DM is told about one: the same words wherever a
// 2024-only spell is met.
export function revisedOnlySpellProblem(name: string, kind: "cantrip" | "spell" = "spell"): string | null {
  const printed = revisedOnlySpell(name);
  return printed
    ? `${printed} is from the 2024 rules, which this server does not play; pick a 2014 ${kind} in its place.`
    : null;
}
