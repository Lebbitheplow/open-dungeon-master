import type { WorkshopBundle } from "@/lib/workshop/bundle";
import { accountOf } from "@/lib/worldforge/account";
import { emptyDoc, parseRef, readDoc, readEntry, refOf, type Entry, type Shelf, type WorldDoc } from "@/lib/worldforge/model";

// A workshop bundle read as the world it is: each row with its World entry
// beside it. Inside a bundle a World ref is the row's place in its list
// ("faction:#2" is the bundle's third faction, src/lib/db/world-forge-
// bundle.ts), so a row and its entry meet by position, and a ref names its
// row's name for the omission report. A bundle with no World reads as rows
// with blank entries, which is what an entry nobody opened is.
//
// Pure, for the compile (./to-pack.ts) and its report (./to-pack-omissions.ts).

export type WorldRow = {
  shelf: Shelf;
  ref: string;
  name: string;
  // The row's own text: a character's line, a place's arrival text, a
  // faction's line, a lore entry's body.
  text: string;
  entry: Entry;
  // Why the row stays out of a pack, or "": a lore entry kept for the DM, or
  // an entry that is not canon (src/lib/worldforge/canon.ts). A pack has no
  // private part and no way to mark a line as unsettled, so neither goes in.
  held: string;
};

export type BundleWorld = {
  doc: WorldDoc;
  rows: Record<Shelf, WorldRow[]>;
  byRef: Map<string, WorldRow>;
  nameOf: (ref: string) => string;
};

export function readBundleWorld(bundle: WorkshopBundle): BundleWorld {
  const doc = bundle.world ? readDoc(bundle.world.doc) : emptyDoc();
  const blank = readEntry({});
  const row = (shelf: Shelf, index: number, name: string, text: string, dmOnly = false): WorldRow => {
    const ref = refOf(shelf, `#${index}`);
    const entry = doc.entries[ref] ?? blank;
    return { shelf, ref, name, text, entry, held: dmOnly ? "DM only" : entry.canon === "canon" ? "" : entry.canon };
  };
  const rows: Record<Shelf, WorldRow[]> = {
    npc: bundle.npcs.map((npc, index) => row("npc", index, npc.name, npc.trait)),
    location: bundle.locations.map((place, index) => row("location", index, place.name, place.layoutDescription)),
    faction: bundle.factions.map((faction, index) => row("faction", index, faction.name, faction.blurb)),
    lore: bundle.lore.map((lore, index) => row("lore", index, lore.title, lore.body, lore.visibility === "dm")),
  };
  const byRef = new Map(Object.values(rows).flat().map((entry) => [entry.ref, entry]));
  const nameOf = (ref: string) => byRef.get(ref)?.name ?? (parseRef(ref) ? "an entry this bundle does not carry" : ref);
  return { doc, rows, byRef, nameOf };
}

// The entry's account (WF-13): a lore entry's body, the article for the
// other shelves when it has one.
export function accountOfRow(row: WorldRow): string {
  return accountOf({ shelf: row.shelf, text: row.text, entry: row.entry }).trim();
}
