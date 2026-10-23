import { textKey } from "@/lib/language/text-logic";

// The places a character sheet names a Homebrew entry by its NAME, in one
// list, so every reader and writer of those names agrees on them: the
// subclass a class took, the spells on every list, the feats, the items.
// Species, backgrounds and workshop classes are held by id and are not here.
//
// Three callers need the same list. A Homebrew rename carries the sheets
// that held the old name with it (src/lib/db/homebrew-rename.ts); a bundle
// whose entries arrive renamed beside the importer's own points its pregens
// at the arrivals (src/lib/db/workshop-bundle-shelf.ts landedSheet); and an
// export that carries only what is used asks which names a sheet holds.
//
// Pure, and shaped for both a library sheet (CreateSheetInput) and a table's
// sheet (CharacterSheet): a field one of them lacks is skipped.

export type SheetRefKind = "archetype" | "spell" | "feat" | "item";

type Rec = Record<string, unknown>;

const isRec = (value: unknown): value is Rec => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

const SPELL_LISTS = ["prepared", "known", "cantrips", "pending", "spellbook"] as const;

// Every name a sheet holds, by kind. A subclass is read with the class that
// took it, since two classes may each have a subclass of one name.
export function sheetRefNames(sheet: unknown): { archetype: Array<{ classId: string; name: string }>; spell: string[]; feat: string[]; item: string[] } {
  const record = isRec(sheet) ? sheet : {};
  const classes = Array.isArray(record.classes) ? record.classes.filter(isRec) : [];
  const archetype = [
    { classId: String(record.class ?? ""), name: String(record.subclass ?? "") },
    ...classes.map((entry) => ({ classId: String(entry.id ?? ""), name: String(entry.subclass ?? "") })),
  ].filter((entry) => entry.name.trim());
  const casting = isRec(record.spellcasting) ? record.spellcasting : null;
  const lists = casting ? [casting, ...(Array.isArray(casting.casters) ? casting.casters.filter(isRec) : [])] : [];
  const choices = isRec(record.featChoices) ? Object.values(record.featChoices).filter(isRec) : [];
  const equipment = Array.isArray(record.equipment) ? record.equipment.filter(isRec) : [];
  const spell = [
    ...lists.flatMap((list) => SPELL_LISTS.flatMap((field) => strings(list[field]))),
    ...choices.flatMap((picks) => [...strings(picks.spells), ...strings(picks.cantrips)]),
    ...(isRec(record.racialChoices) && typeof record.racialChoices.cantrip === "string" ? [record.racialChoices.cantrip] : []),
    ...equipment.flatMap((item) => (typeof item.spell === "string" ? [item.spell] : [])),
  ].filter((name) => name.trim());
  const asi = Array.isArray(record.asiChoices) ? record.asiChoices.filter(isRec) : [];
  const feat = [...strings(record.feats), ...asi.flatMap((choice) => (choice.mode === "feat" && typeof choice.feat === "string" ? [choice.feat] : []))];
  const item = equipment.flatMap((item) => (typeof item.name === "string" && item.identified !== false ? [item.name] : []));
  return { archetype, spell: [...new Set(spell)], feat: [...new Set(feat)], item: [...new Set(item)] };
}

// The name a reference should read now, or the same name when it is not one
// of the renamed ones. `classId` is given for a subclass.
export type SheetRenamer = (kind: SheetRefKind, name: string, classId?: string) => string;

// The sheet with every reference the renamer changes written under its new
// name, and whether anything changed. A list that holds both the old and the
// new name keeps one. Unidentified gear keeps its name: its name is the
// mystery the party sees (src/lib/schemas/sheet.ts equipmentItemSchema).
export function renameSheetRefs<T>(sheet: T, rename: SheetRenamer): { sheet: T; changed: boolean } {
  if (!isRec(sheet)) {
    return { sheet, changed: false };
  }
  let changed = false;
  const to = (kind: SheetRefKind, name: string, classId?: string) => {
    const next = rename(kind, name, classId);
    if (next !== name) changed = true;
    return next;
  };
  const list = (kind: SheetRefKind, value: unknown) => {
    if (!Array.isArray(value)) return value;
    const seen = new Set<string>();
    return value
      .map((entry) => (typeof entry === "string" ? to(kind, entry) : entry))
      .filter((entry) => {
        if (typeof entry !== "string") return true;
        const key = textKey(entry);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };
  const spellLists = (lists: Rec): Rec => {
    const out: Rec = { ...lists };
    for (const field of SPELL_LISTS) {
      if (field in out) out[field] = list("spell", out[field]);
    }
    return out;
  };
  const record: Rec = { ...sheet };
  const primary = String(record.class ?? "");
  if (typeof record.subclass === "string" && record.subclass.trim()) {
    record.subclass = to("archetype", record.subclass, primary);
  }
  if (Array.isArray(record.classes)) {
    record.classes = record.classes.map((entry) =>
      isRec(entry) && typeof entry.subclass === "string" && entry.subclass.trim()
        ? { ...entry, subclass: to("archetype", entry.subclass, String(entry.id ?? "")) }
        : entry,
    );
  }
  if (isRec(record.spellcasting)) {
    const casting = spellLists(record.spellcasting);
    if (Array.isArray(casting.casters)) {
      casting.casters = casting.casters.map((caster) => (isRec(caster) ? spellLists(caster) : caster));
    }
    record.spellcasting = casting;
  }
  if (typeof record.concentratingOn === "string" && record.concentratingOn) {
    record.concentratingOn = to("spell", record.concentratingOn);
  }
  if (isRec(record.racialChoices) && typeof record.racialChoices.cantrip === "string" && record.racialChoices.cantrip) {
    record.racialChoices = { ...record.racialChoices, cantrip: to("spell", record.racialChoices.cantrip) };
  }
  if (Array.isArray(record.equipment)) {
    record.equipment = record.equipment.map((item) => {
      if (!isRec(item)) return item;
      const next: Rec = { ...item };
      if (typeof next.spell === "string" && next.spell) next.spell = to("spell", next.spell);
      if (typeof next.name === "string" && next.identified !== false) next.name = to("item", next.name);
      return next;
    });
  }
  // A feat is held in four places: the list, the improvement it was taken
  // with, its picks (keyed by its name) and the feature it wrote.
  const renamedFeats = new Map<string, string>();
  const feat = (name: string) => {
    const next = to("feat", name);
    if (next !== name) renamedFeats.set(textKey(name), next);
    return next;
  };
  if (Array.isArray(record.feats)) {
    record.feats = list("feat", (record.feats as unknown[]).map((entry) => (typeof entry === "string" ? feat(entry) : entry)));
  }
  if (Array.isArray(record.asiChoices)) {
    record.asiChoices = record.asiChoices.map((choice) =>
      isRec(choice) && choice.mode === "feat" && typeof choice.feat === "string" ? { ...choice, feat: feat(choice.feat) } : choice,
    );
  }
  if (isRec(record.featChoices)) {
    record.featChoices = Object.fromEntries(
      Object.entries(record.featChoices).map(([key, picks]) => {
        // Keys are already textKey'd, so a rename is told apart by its key.
        const asked = rename("feat", key);
        const renamed = renamedFeats.get(textKey(key)) ?? (textKey(asked) !== textKey(key) ? asked : null);
        const value = isRec(picks)
          ? { ...picks, ...(Array.isArray(picks.spells) ? { spells: list("spell", picks.spells) } : {}), ...(Array.isArray(picks.cantrips) ? { cantrips: list("spell", picks.cantrips) } : {}) }
          : picks;
        if (renamed) changed = true;
        return [renamed ? textKey(renamed) : key, value];
      }),
    );
  }
  if (Array.isArray(record.features) && renamedFeats.size) {
    record.features = record.features.map((feature) =>
      isRec(feature) && feature.source === "feat" && typeof feature.name === "string" && renamedFeats.has(textKey(feature.name))
        ? { ...feature, name: renamedFeats.get(textKey(feature.name)) }
        : feature,
    );
  }
  return changed ? { sheet: record as T, changed } : { sheet, changed: false };
}

// A renamer from a list of renames: `from` -> `to` for one kind, a subclass
// only under its own class when `classId` is given.
export function renamerOf(renames: Array<{ kind: SheetRefKind; from: string; to: string; classId?: string }>): SheetRenamer {
  return (kind, name, classId) => {
    const hit = renames.find(
      (entry) =>
        entry.kind === kind &&
        textKey(entry.from) === textKey(name) &&
        (kind !== "archetype" || !entry.classId || !classId || entry.classId.toLowerCase() === classId.toLowerCase()),
    );
    return hit ? hit.to : name;
  };
}
