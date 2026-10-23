import { isPublishedGearName, listHomebrew, syncWorkshopClasses, type HomebrewEntry } from "@/lib/db/homebrew";
import { featFactsFor, spellFactsFor, subclassIsOffered } from "@/lib/characters/catalog";
import { matchGear } from "@/lib/srd/adventuring-gear";
import { isWorkshopClassId, workshopClassId } from "@/lib/homebrew/class-data";
import { homebrewDataRefs } from "@/lib/homebrew/data-refs";
import { landedSheet, portableClassRef, portableSheet, sheetUses, writeShelfArrivals, PORTABLE_REF } from "@/lib/db/workshop-bundle-shelf";
import type { CharacterBundle } from "@/lib/character-bundle";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import type { WorkshopBundle } from "@/lib/workshop/bundle";
import { textKey } from "@/lib/language/text-logic";

// A character file and the Homebrew it stands on (workshop import audit F07).
//
// The file used to carry the sheet alone: its subclass, spells and feats by
// name, its species, background and workshop class by this server's ids. On
// another account or server the import was refused ("Marsh Knight is not a
// subclass of the Fighter"), or a same-named entry there was silently taken
// for it. Now the file carries the entries the sheet depends on, in a
// Workshop bundle's shape, and the sheet names them by kind and name. On
// import they land on the importer's own shelf through the bundle's own
// arrival rules (an identical entry is reused, a different one of that name
// is kept beside it under the file's name, src/lib/db/workshop-bundle-
// shelf.ts), and the sheet is then judged by the same legality check as
// ever, against the importer's shelf. A table still admits the character
// only on its own authors' terms (src/lib/content/scope.ts).

type FileEntry = NonNullable<CharacterBundle["homebrew"]>[number];

// Whether the books answer to a name before any shelf does: carrying a
// shelf entry of that name would change nothing on the other side.
function published(kind: HomebrewEntry["kind"], name: string, classId = ""): boolean {
  if (kind === "spell") return spellFactsFor(name) !== null;
  if (kind === "feat") return featFactsFor(name) !== null;
  if (kind === "item") return isPublishedGearName(name) || matchGear(name) !== null;
  if (kind === "archetype") return subclassIsOffered(classId, name);
  return false;
}

// The sheet as another server can read it, and what of the owner's shelf it
// depends on: what it holds by id, what it names, and what those name in
// turn (a subclass's spells at every level, an item's spells, a
// background's kit, a subclass's class and that class's other subclasses).
export function characterFileShelf(userId: string, sheet: CreateSheetInput): { sheet: CreateSheetInput; homebrew: FileEntry[] } {
  const shelf = listHomebrew(userId, undefined, { archived: true }).filter((entry) => entry.kind !== "monster");
  const byId = new Map(shelf.map((entry) => [entry.id, entry]));
  const named = (kind: HomebrewEntry["kind"], name: string, classId?: string) =>
    shelf.find(
      (entry) =>
        entry.kind === kind &&
        textKey(entry.name) === textKey(name) &&
        (classId === undefined || String(entry.data.classSlug ?? "").toLowerCase() === classId.toLowerCase()),
    );
  const kept = new Set<HomebrewEntry>();
  const queue: HomebrewEntry[] = [];
  const keep = (entry: HomebrewEntry | undefined) => {
    if (entry && !kept.has(entry)) {
      kept.add(entry);
      queue.push(entry);
    }
  };
  const uses = sheetUses(sheet);
  for (const id of uses.ids) keep(byId.get(id));
  for (const { classId, name } of uses.names.archetype) if (!published("archetype", name, classId)) keep(named("archetype", name, classId));
  for (const name of uses.names.spell) if (!published("spell", name)) keep(named("spell", name));
  for (const name of uses.names.feat) if (!published("feat", name)) keep(named("feat", name));
  for (const name of uses.names.item) if (!published("item", name)) keep(named("item", name));
  while (queue.length) {
    const entry = queue.shift()!;
    const refs = homebrewDataRefs(entry.kind, entry.data);
    for (const spell of refs.spell) if (!published("spell", spell)) keep(named("spell", spell));
    for (const item of refs.item) if (!published("item", item)) keep(named("item", item));
    const parent = entry.kind === "archetype" ? String(entry.data.classSlug ?? "") : "";
    if (isWorkshopClassId(parent)) keep(byId.get(parent.slice("homebrew-".length)));
    if (entry.kind === "class") {
      for (const subclass of shelf.filter((other) => other.kind === "archetype" && String(other.data.classSlug ?? "") === workshopClassId(entry.id))) keep(subclass);
    }
  }
  return {
    sheet: portableSheet(sheet, byId),
    homebrew: shelf
      .filter((entry) => kept.has(entry))
      .map((entry) => ({
        kind: entry.kind as FileEntry["kind"],
        name: entry.name,
        data:
          entry.kind === "archetype" && typeof entry.data.classSlug === "string"
            ? { ...entry.data, classSlug: portableClassRef(entry.data.classSlug, byId) }
            : entry.data,
      })),
  };
}

export type FileArrival = { copied: number; reused: string[]; renamed: string[] };

// A file's Homebrew onto the importer's shelf, and its sheet pointed at the
// entries as they are here. Runs inside the import's transaction: a sheet the
// legality check then refuses takes its arrivals back with it.
export function landCharacterFile(userId: string, file: Pick<CharacterBundle, "name" | "sheet" | "homebrew">): { sheet: CreateSheetInput; arrival: FileArrival } {
  const portable = JSON.stringify(file.sheet).includes(PORTABLE_REF);
  if (!file.homebrew?.length && !portable) {
    // A file from before the field, or a sheet that holds no homebrew.
    return { sheet: file.sheet, arrival: { copied: 0, reused: [], renamed: [] } };
  }
  const landing = writeShelfArrivals(userId, "", {
    manifest: { name: file.name },
    homebrew: file.homebrew ?? [],
    monsters: [],
  } as unknown as WorkshopBundle);
  return { sheet: landedSheet(file.sheet, landing), arrival: { copied: landing.copied, reused: landing.reused, renamed: landing.renamed } };
}

// After a refused import rolled its arrivals back: the workshop classes the
// engines know are read from the shelf again.
export function forgetRefusedArrivals(): void {
  syncWorkshopClasses();
}
