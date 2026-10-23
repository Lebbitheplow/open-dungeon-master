import { getDatabase } from "@/lib/db/core";
import { isWorkshopClassId, workshopClassId } from "@/lib/homebrew/class-data";
import { renameSheetRefs, sheetRefNames, type SheetRenamer } from "@/lib/homebrew/sheet-refs";
import { homebrewDataRefs, monsterStatsSpells, renameHomebrewDataRefs, renameMonsterStatsSpells } from "@/lib/homebrew/data-refs";
import { renamePrepRefs } from "@/lib/db/prep-refs";
import { createHomebrew, isPublishedGearName, listHomebrew, type HomebrewEntry } from "@/lib/db/homebrew";
import { spellFactsFor } from "@/lib/characters/catalog";
import { matchGear } from "@/lib/srd/adventuring-gear";
import { createHomebrewMonster, listHomebrewMonsters, type HomebrewMonster } from "@/lib/bestiary/homebrew-monsters";
import { draftFromData } from "@/lib/bestiary/monster-draft";
import { resolveMonster } from "@/lib/bestiary";
import type { SettingRef } from "@/lib/worlds/preset";
import { normalizeHomebrewData } from "@/lib/homebrew/gear";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import type { WorkshopBundle } from "@/lib/workshop/bundle";
import { textKey } from "@/lib/language/text-logic";

// A workshop bundle's share of its author's shelf (hand-built monsters, and
// items, spells and options), both ways (docs/workshop-rulebook-audit-
// pr169.md F17).
//
// Out: the whole shelf, or only what the workshop uses (`used`): the
// monsters its Cast and its fights name, the entries its pregens hold, and
// the ones its prepared text mentions by name. Either way the export says
// what it took, what it left out or took unused, and which monster names
// the workshop uses that nothing answers to. A pregen's homebrew species,
// background or item is written by its kind and name ("homebrew:@race:
// Sand Elf"), since an id means nothing on another server.
//
// In: an arrival whose name the importer's shelf already has is the same
// entry when its rules are the same, and is kept beside it under the
// bundle's name otherwise ("Goblin Chief [The Sunken Keep]"), with the new
// workshop's Cast, fights and pregens pointed at the arrival, so neither
// adventure's monster changes under it. The report says which.

export type ShelfScope = "all" | "used";

export type ShelfReport = {
  // What went in, by kind and name.
  included: string[];
  // On the shelf and not used by this workshop: taken anyway (scope "all")
  // or left out (scope "used").
  unused: string[];
  // Monster names the workshop's Cast or fights use that answer to nothing.
  missing: string[];
};

export const PORTABLE_REF = "homebrew:@";

const label = (kind: string, name: string) => `${kind === "archetype" ? "subclass" : kind === "race" ? "species" : kind} ${name}`;

// The monster a fight's roster row names ("goblin", or {monster: "goblin"}).
export function rosterMonsters(enemies: unknown[]): string[] {
  return enemies
    .map((row) => (typeof row === "string" ? row : typeof row === "object" && row ? String((row as { monster?: unknown }).monster ?? "") : ""))
    .map((name) => name.trim())
    .filter(Boolean);
}

// A Cast member's stat block as another machine can read it: a published
// slug as it is, one of the DM's own monsters by its name (resolveMonster
// finds a table's own monster by name last).
export function portableStatBlock(ref: string): string {
  if (!ref.startsWith("homebrew:")) {
    return ref;
  }
  const row = getDatabase().prepare(`SELECT name FROM homebrew_entries WHERE id = ?`).get(ref.slice("homebrew:".length)) as { name: string } | undefined;
  return row?.name ?? "";
}

// A workshop class's id ("homebrew-<entry id>", src/lib/homebrew/class-data.ts)
// written by name, as another server can read it; anything else as it is.
export function portableClassRef(classId: string, byId: Map<string, HomebrewEntry>): string {
  if (!isWorkshopClassId(classId)) return classId;
  const entry = byId.get(classId.slice("homebrew-".length));
  return entry ? `${PORTABLE_REF}class:${entry.name}` : classId;
}

// A pregen's sheet with its homebrew ids written by kind and name.
export function portableSheet(sheet: CreateSheetInput, byId: Map<string, HomebrewEntry>): CreateSheetInput {
  const portable = (ref: string | undefined) => {
    if (!ref?.startsWith("homebrew:") || ref.startsWith(PORTABLE_REF)) return ref;
    const entry = byId.get(ref.slice("homebrew:".length));
    return entry ? `${PORTABLE_REF}${entry.kind}:${entry.name}` : ref;
  };
  const record = sheet as unknown as Record<string, unknown>;
  const equipment = Array.isArray(record.equipment)
    ? (record.equipment as Array<Record<string, unknown>>).map((item) => (typeof item.slug === "string" ? { ...item, slug: portable(item.slug) } : item))
    : record.equipment;
  const classes = Array.isArray(record.classes)
    ? (record.classes as Array<Record<string, unknown>>).map((entry) => ({ ...entry, id: portableClassRef(String(entry.id ?? ""), byId) }))
    : undefined;
  return {
    ...sheet,
    class: portableClassRef(sheet.class, byId),
    ...(classes ? { classes } : {}),
    race: portable(sheet.race) ?? sheet.race,
    background: portable(sheet.background) ?? sheet.background,
    ...(equipment ? { equipment } : {}),
  } as CreateSheetInput;
}

// The homebrew ids a pregen holds (species, background, workshop class, an
// item by its slug) and everything it names (src/lib/homebrew/sheet-refs.ts).
export function sheetUses(sheet: CreateSheetInput): { ids: string[]; names: ReturnType<typeof sheetRefNames> } {
  const record = sheet as unknown as Record<string, unknown>;
  const ids = [sheet.race, sheet.background].filter((ref): ref is string => typeof ref === "string" && ref.startsWith("homebrew:"));
  // A workshop class the sheet holds, as the entry it is.
  for (const classId of [sheet.class, ...(Array.isArray(record.classes) ? (record.classes as Array<{ id?: unknown }>).map((entry) => String(entry.id ?? "")) : [])]) {
    if (typeof classId === "string" && isWorkshopClassId(classId)) ids.push(`homebrew:${classId.slice("homebrew-".length)}`);
  }
  const equipment = Array.isArray(record.equipment) ? (record.equipment as Array<Record<string, unknown>>) : [];
  for (const item of equipment) {
    if (typeof item.slug === "string" && item.slug.startsWith("homebrew:")) ids.push(item.slug);
  }
  return { ids: ids.map((ref) => ref.slice("homebrew:".length)), names: sheetRefNames(sheet) };
}

// The shelf a bundle carries, and what it says about it.
//
// "Only what this workshop uses" is a closure, not a scan: what the
// workshop's rows name (its Cast, fights, roll tables, shelves, pregens, World
// links and prose) is kept, then whatever a kept entry names in turn (a
// subclass's spells at every level, not only the ones a pregen holds today;
// an item's spells; a background's kit; a monster's spells; a subclass's
// class, and a kept class's other subclasses), until nothing new is named.
export function shelfForBundle(input: {
  ownerUserId: string;
  setting: SettingRef;
  scope: ShelfScope;
  statBlocks: string[];
  rosters: unknown[][];
  sheets: CreateSheetInput[];
  // The workshop's prepared words (beats, notes, places, lore, rewards, the
  // Cast's personalities, faction blurbs, map notes, house rules): an entry
  // they name is one the workshop uses.
  texts: string[];
  // Homebrew entries a World entry links to (src/lib/worldforge/model.ts
  // Binding), by id: used, however little the prose names them.
  boundIds?: string[];
  // Roll-table rows that are a monster or an item, and the items its shops
  // stock, by name.
  tableRefs?: Array<{ kind: string; name: string }>;
  stock?: string[];
}): { monsters: HomebrewMonster[]; homebrew: HomebrewEntry[]; report: ShelfReport } {
  const monsters = listHomebrewMonsters(input.ownerUserId);
  const homebrew = listHomebrew(input.ownerUserId).filter((entry) => entry.kind !== "monster");
  const tableRefs = input.tableRefs ?? [];
  const refs = [
    ...input.statBlocks.filter(Boolean),
    ...input.rosters.flatMap(rosterMonsters),
    ...tableRefs.filter((ref) => ref.kind === "monster").map((ref) => ref.name),
  ];
  const named = new Set(refs.map(textKey));
  const prose = textKey(input.texts.join("\n"));
  const mentioned = (name: string) => name.trim().length >= 4 && prose.includes(textKey(name));
  const usedMonster = (monster: HomebrewMonster) => named.has(textKey(monster.draft.name)) || named.has(textKey(monster.slug)) || mentioned(monster.draft.name);
  const keepMonsters = input.scope === "used" ? monsters.filter(usedMonster) : monsters;

  // What the rows name, by kind.
  const pregens = input.sheets.map(sheetUses);
  const wanted = {
    spell: new Set([...pregens.flatMap((pregen) => pregen.names.spell), ...keepMonsters.flatMap((monster) => monsterStatsSpells(monster.draft.stats))].map(textKey)),
    item: new Set(
      [...pregens.flatMap((pregen) => pregen.names.item), ...tableRefs.filter((ref) => ref.kind === "item").map((ref) => ref.name), ...(input.stock ?? [])].map(textKey),
    ),
    feat: new Set(pregens.flatMap((pregen) => pregen.names.feat).map(textKey)),
    archetype: new Set(pregens.flatMap((pregen) => pregen.names.archetype.map((entry) => entry.name)).map(textKey)),
  };
  const ids = new Set([...pregens.flatMap((pregen) => pregen.ids), ...(input.boundIds ?? [])]);
  const seeded = (entry: HomebrewEntry) =>
    ids.has(entry.id) || mentioned(entry.name) || (entry.kind in wanted && wanted[entry.kind as keyof typeof wanted].has(textKey(entry.name)));

  const kept = new Set<HomebrewEntry>(input.scope === "used" ? homebrew.filter(seeded) : homebrew);
  // Then what each kept entry names, until nothing new is named.
  const queue = [...kept];
  const keep = (entry: HomebrewEntry | undefined) => {
    if (entry && !kept.has(entry)) {
      kept.add(entry);
      queue.push(entry);
    }
  };
  const byName = (kind: HomebrewEntry["kind"], name: string) => homebrew.find((entry) => entry.kind === kind && textKey(entry.name) === textKey(name));
  while (queue.length) {
    const entry = queue.shift()!;
    const named = homebrewDataRefs(entry.kind, entry.data);
    for (const spell of named.spell) keep(byName("spell", spell));
    for (const item of named.item) keep(byName("item", item));
    // A kept subclass of a workshop class brings its class along, and a kept
    // class its other subclasses: a pregen below the subclass level still
    // has the choice to make on the other side.
    const parent = entry.kind === "archetype" ? String(entry.data.classSlug ?? "") : "";
    if (isWorkshopClassId(parent)) keep(homebrew.find((other) => other.kind === "class" && workshopClassId(other.id) === parent));
    if (entry.kind === "class") {
      for (const subclass of homebrew.filter((other) => other.kind === "archetype" && String(other.data.classSlug ?? "") === workshopClassId(entry.id))) keep(subclass);
    }
  }
  const keepHomebrew = homebrew.filter((entry) => kept.has(entry));

  // What nothing answers to, here or in the books: monsters by the name the
  // rows use, and the spells and items a kept entry, a pregen or a shelf names.
  const missingMonsters = [...new Set(refs)].filter((ref) => !resolveMonster(ref, input.setting, { userIds: [input.ownerUserId] }));
  const shelfHas = (kind: HomebrewEntry["kind"], name: string) => Boolean(byName(kind, name));
  const spellsNamed = new Set<string>();
  for (const entry of keepHomebrew) for (const spell of homebrewDataRefs(entry.kind, entry.data).spell) spellsNamed.add(spell);
  for (const monster of keepMonsters) for (const spell of monsterStatsSpells(monster.draft.stats)) spellsNamed.add(spell);
  const itemsNamed = new Set<string>([...tableRefs.filter((ref) => ref.kind === "item").map((ref) => ref.name), ...(input.stock ?? [])]);
  for (const entry of keepHomebrew) for (const item of homebrewDataRefs(entry.kind, entry.data).item) itemsNamed.add(item);
  const missingSpells = [...spellsNamed].filter((name) => !shelfHas("spell", name) && !spellFactsFor(name, [input.ownerUserId]));
  const missingItems = [...itemsNamed].filter((name) => !shelfHas("item", name) && !isPublishedGearName(name) && !matchGear(name));
  return {
    monsters: keepMonsters,
    homebrew: keepHomebrew,
    report: {
      included: [...keepMonsters.map((monster) => label("monster", monster.draft.name)), ...keepHomebrew.map((entry) => label(entry.kind, entry.name))],
      unused: [...monsters.filter((monster) => !keepMonsters.includes(monster)).map((monster) => label("monster", monster.draft.name)), ...homebrew.filter((entry) => !kept.has(entry)).map((entry) => label(entry.kind, entry.name))],
      // Monsters by the name the rows use, as they always were; the rest
      // say what kind of thing they are.
      missing: [...missingMonsters, ...missingSpells.map((name) => label("spell", name)), ...missingItems.map((name) => label("item", name))],
    },
  };
}

// ---- in ----

export type ShelfArrival = { copied: number; reused: string[]; renamed: string[] };

// The rules an entry carries, the same however its keys were ordered and
// whether or not it was normalized when saved; where it was copied from is
// not a rule.
const stable = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(stable).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value as Record<string, unknown>).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`
      : JSON.stringify(value ?? null);
const comparable = (kind: HomebrewEntry["kind"], name: string, data: Record<string, unknown>) => {
  const normalized = normalizeHomebrewData(kind, data, name);
  const rest = { ...("error" in normalized ? data : normalized.data) };
  delete rest.copiedFrom;
  return stable(rest);
};

// Whether two entries of a kind carry the same rules, however their data was
// ordered or normalized, and wherever either was copied from: what a campaign
// import asks before it brings an entry beside one of the same name.
export function sameRules(kind: HomebrewEntry["kind"], a: { name: string; data: Record<string, unknown> }, b: { name: string; data: Record<string, unknown> }): boolean {
  return comparable(kind, a.name, a.data) === comparable(kind, b.name, b.data);
}

// A name the importer's shelf does not have yet for this kind. A spell's is
// held to 60 letters, the most a subclass's or a monster's spell list keeps
// (src/lib/homebrew/gear.ts, src/lib/bestiary/monster-draft.ts), so the
// entries that name it still name it whole.
export function freeName(taken: Set<string>, name: string, bundleName: string, max = 80): string {
  const base = `${name} [${bundleName}]`.slice(0, max);
  let candidate = base;
  for (let attempt = 2; taken.has(textKey(candidate)); attempt += 1) {
    candidate = `${base.slice(0, max - 6)} ${attempt}`;
  }
  return candidate;
}

const NAME_MAX = (kind: string) => (kind === "spell" ? 60 : 80);

// Kinds land in this order, so an entry that names another lands after it
// and names it as it is called here: spells before the subclasses, items and
// monsters that cast them, items before the backgrounds that hand them out,
// classes before their subclasses.
const ARRIVAL_ORDER: HomebrewEntry["kind"][] = ["spell", "item", "feat", "race", "background", "hazard", "class", "archetype"];

export type ShelfLanding = ShelfArrival & { entryFor: (kind: string, name: string) => string | null; renames: Map<string, string> };

// The shelf a bundle carries, written onto the importer's own: an entry the
// importer already keeps with the same rules is reused, one with other rules
// lands beside it under the bundle's name. Each arrival's own references
// (a subclass's spells, an item's spells, a background's kit, a monster's
// spells) are named as the entries they mean are called here before the two
// are compared, so a subclass whose spell arrived renamed is not mistaken
// for the importer's own, which grants their spell.
export function writeShelfArrivals(userId: string, workshopId: string, bundle: WorkshopBundle): ShelfLanding {
  const bundleName = bundle.manifest.name;
  const reused: string[] = [];
  const renamed: string[] = [];
  let copied = 0;
  // kind:textKey(name in the bundle) -> the name it has here.
  const renames = new Map<string, string>();
  const asHere: SheetRenamer = (kind, name) => renames.get(`${kind}:${textKey(name)}`) ?? name;

  // Where each monster and entry of the bundle landed: "<kind>:<name>" to its id here.
  const ids = new Map<string, string>();
  const owned = listHomebrew(userId);
  const byKey = new Map(owned.map((entry) => [`${entry.kind}:${textKey(entry.name)}`, entry]));
  const names = new Map<string, Set<string>>();
  for (const entry of owned) (names.get(entry.kind) ?? names.set(entry.kind, new Set()).get(entry.kind)!).add(textKey(entry.name));
  const arrivals = [...bundle.homebrew].sort((a, b) => ARRIVAL_ORDER.indexOf(a.kind) - ARRIVAL_ORDER.indexOf(b.kind));
  for (const arrival of arrivals) {
    const parent = String(arrival.data.classSlug ?? "");
    const parentId = arrival.kind === "archetype" && parent.startsWith(`${PORTABLE_REF}class:`) ? ids.get(`class:${textKey(parent.slice(`${PORTABLE_REF}class:`.length))}`) : undefined;
    const withParent = parentId ? { ...arrival.data, classSlug: workshopClassId(parentId) } : arrival.data;
    const entry = { ...arrival, data: renameHomebrewDataRefs(arrival.kind, withParent, asHere).data };
    const normalized = normalizeHomebrewData(entry.kind, entry.data, entry.name);
    if ("error" in normalized) continue;
    const key = `${entry.kind}:${textKey(entry.name)}`;
    const held = byKey.get(key);
    if (held && comparable(entry.kind, held.name, held.data) === comparable(entry.kind, entry.name, normalized.data)) {
      reused.push(label(entry.kind, entry.name));
      ids.set(key, held.id);
      continue;
    }
    const taken = names.get(entry.kind) ?? new Set<string>();
    const name = held ? freeName(taken, entry.name, bundleName, NAME_MAX(entry.kind)) : entry.name;
    if (held) {
      renames.set(key, name);
      renamed.push(`${label(entry.kind, entry.name)} is "${name}" here: your own ${entry.name} has other rules.`);
    }
    const created = createHomebrew(userId, { kind: entry.kind, name, data: normalized.data });
    ids.set(key, created.id);
    taken.add(textKey(name));
    names.set(entry.kind, taken);
    copied += 1;
  }

  // Monsters after the spells they cast.
  const mine = new Map(listHomebrewMonsters(userId).map((monster) => [textKey(monster.draft.name), monster]));
  const monsterNames = new Set(mine.keys());
  for (const monster of bundle.monsters) {
    const stats = renameMonsterStatsSpells(monster.stats, asHere).stats;
    const draft = draftFromData(monster.name, { desc: monster.desc, stats, extraDamagePerRound: monster.extraDamagePerRound });
    const held = mine.get(textKey(monster.name));
    if (held && stable(held.draft.stats) === stable(draft.stats)) {
      reused.push(label("monster", monster.name));
      ids.set(`monster:${textKey(monster.name)}`, held.id);
      continue;
    }
    const name = held ? freeName(monsterNames, monster.name, bundleName) : monster.name;
    if (held) {
      renames.set(`monster:${textKey(monster.name)}`, name);
      renamed.push(`${label("monster", monster.name)} is "${name}" here: your own ${monster.name} has other rules.`);
    }
    ids.set(`monster:${textKey(monster.name)}`, createHomebrewMonster(userId, { ...draft, name }, monster.desc).id);
    monsterNames.add(textKey(name));
    copied += 1;
  }

  // The new workshop's Cast, fights, roll tables and shelves point at the
  // monsters and items as they are called here.
  const prep = (kind: "monster" | "item") =>
    [...renames].filter(([key]) => key.startsWith(`${kind}:`)).map(([key, to]) => [key.slice(kind.length + 1), to] as const);
  renamePrepRefs(workshopId, { monster: new Map(prep("monster")), item: new Map(prep("item")) });

  return {
    copied,
    reused,
    renamed,
    renames,
    // An entry the bundle did not carry (its homebrew left unticked) is the
    // importer's own of that kind and name, when they keep one, rather than
    // a reference nothing on this server can read.
    entryFor: (kind, name) => ids.get(`${kind}:${textKey(name)}`) ?? byKey.get(`${kind}:${textKey(name)}`)?.id ?? null,
  };
}

// A pregen's sheet as it lands: its portable refs back to this server's ids,
// and every renamed subclass, spell, feat or item under its name here
// (src/lib/homebrew/sheet-refs.ts), the multiclass entries and the casters'
// lists included.
export function landedSheet(sheet: CreateSheetInput, arrival: { entryFor: (kind: string, name: string) => string | null; renames: Map<string, string> }): CreateSheetInput {
  const local = (ref: string | undefined) => {
    if (!ref?.startsWith(PORTABLE_REF)) return ref;
    const [kind, ...rest] = ref.slice(PORTABLE_REF.length).split(":");
    const id = arrival.entryFor(kind, rest.join(":"));
    return id ? `homebrew:${id}` : ref;
  };
  // A workshop class written by name, back to its id here.
  const localClass = (ref: string) => {
    if (!ref.startsWith(`${PORTABLE_REF}class:`)) return ref;
    const id = arrival.entryFor("class", ref.slice(`${PORTABLE_REF}class:`.length));
    return id ? workshopClassId(id) : ref;
  };
  const record = sheet as unknown as Record<string, unknown>;
  const equipment = Array.isArray(record.equipment)
    ? (record.equipment as Array<Record<string, unknown>>).map((item) => (typeof item.slug === "string" ? { ...item, slug: local(item.slug) } : item))
    : record.equipment;
  const ids = {
    ...sheet,
    class: localClass(sheet.class),
    ...(Array.isArray(record.classes)
      ? { classes: (record.classes as Array<Record<string, unknown>>).map((entry) => ({ ...entry, id: localClass(String(entry.id ?? "")) })) }
      : {}),
    race: local(sheet.race) ?? sheet.race,
    background: local(sheet.background) ?? sheet.background,
    ...(equipment ? { equipment } : {}),
  } as CreateSheetInput;
  return renameSheetRefs(ids, (kind, name) => arrival.renames.get(`${kind}:${textKey(name)}`) ?? name).sheet;
}
