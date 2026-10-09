import { getDatabase, parseJson } from "@/lib/db/core";
import { createHomebrew, listHomebrew, type HomebrewEntry } from "@/lib/db/homebrew";
import { createHomebrewMonster, listHomebrewMonsters, type HomebrewMonster } from "@/lib/bestiary/homebrew-monsters";
import { draftFromData } from "@/lib/bestiary/monster-draft";
import { resolveMonster } from "@/lib/bestiary";
import type { SettingRef } from "@/lib/worlds/preset";
import { normalizeHomebrewData } from "@/lib/homebrew/gear";
import { allSpellNames } from "@/lib/srd/spell-lists";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import type { WorkshopBundle } from "@/lib/workshop/bundle";

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

const lower = (value: string) => value.trim().toLowerCase();
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
  return { ...sheet, race: portable(sheet.race) ?? sheet.race, background: portable(sheet.background) ?? sheet.background, ...(equipment ? { equipment } : {}) } as CreateSheetInput;
}

function sheetNames(sheet: CreateSheetInput): { ids: string[]; items: string[]; spells: string[]; feats: string[]; subclasses: string[] } {
  const record = sheet as unknown as Record<string, unknown>;
  const ids = [sheet.race, sheet.background].filter((ref): ref is string => typeof ref === "string" && ref.startsWith("homebrew:"));
  const equipment = Array.isArray(record.equipment) ? (record.equipment as Array<Record<string, unknown>>) : [];
  for (const item of equipment) {
    if (typeof item.slug === "string" && item.slug.startsWith("homebrew:")) ids.push(item.slug);
  }
  const casting = record.spellcasting as Parameters<typeof allSpellNames>[0];
  const casters = (casting as { casters?: unknown[] } | null)?.casters ?? [];
  return {
    ids: ids.map((ref) => ref.slice("homebrew:".length)),
    items: equipment.map((item) => String(item.name ?? "")).filter(Boolean),
    spells: [...allSpellNames(casting), ...casters.flatMap((caster) => allSpellNames(caster as Parameters<typeof allSpellNames>[0]))],
    feats: Array.isArray(record.feats) ? (record.feats as unknown[]).map(String) : [],
    subclasses: [record.subclass, ...(Array.isArray(record.classes) ? (record.classes as Array<{ subclass?: unknown }>).map((entry) => entry.subclass) : [])]
      .map((value) => String(value ?? ""))
      .filter(Boolean),
  };
}

// The shelf a bundle carries, and what it says about it.
export function shelfForBundle(input: {
  ownerUserId: string;
  setting: SettingRef;
  scope: ShelfScope;
  statBlocks: string[];
  rosters: unknown[][];
  sheets: CreateSheetInput[];
  // The workshop's prepared words (beats, notes, places, lore): an entry they
  // name is one the workshop uses.
  texts: string[];
}): { monsters: HomebrewMonster[]; homebrew: HomebrewEntry[]; report: ShelfReport } {
  const monsters = listHomebrewMonsters(input.ownerUserId);
  const homebrew = listHomebrew(input.ownerUserId).filter((entry) => entry.kind !== "monster");
  const refs = [...input.statBlocks.filter(Boolean), ...input.rosters.flatMap(rosterMonsters)];
  const named = new Set(refs.map(lower));
  const prose = input.texts.join("\n").toLowerCase();
  const mentioned = (name: string) => name.trim().length >= 4 && prose.includes(name.trim().toLowerCase());
  const usedMonster = (monster: HomebrewMonster) => named.has(lower(monster.draft.name)) || named.has(lower(monster.slug)) || mentioned(monster.draft.name);
  const pregens = input.sheets.map(sheetNames);
  const ids = new Set(pregens.flatMap((names) => names.ids));
  const has = (list: string[], name: string) => list.some((entry) => lower(entry) === lower(name));
  const usedEntry = (entry: HomebrewEntry) =>
    ids.has(entry.id) ||
    mentioned(entry.name) ||
    pregens.some(
      (names) =>
        (entry.kind === "item" && has(names.items, entry.name)) ||
        (entry.kind === "spell" && has(names.spells, entry.name)) ||
        (entry.kind === "feat" && has(names.feats, entry.name)) ||
        (entry.kind === "archetype" && has(names.subclasses, entry.name)),
    );
  const keepMonsters = input.scope === "used" ? monsters.filter(usedMonster) : monsters;
  const keepHomebrew = input.scope === "used" ? homebrew.filter(usedEntry) : homebrew;
  const missing = [...new Set(refs)].filter((ref) => !resolveMonster(ref, input.setting, { userIds: [input.ownerUserId] }));
  return {
    monsters: keepMonsters,
    homebrew: keepHomebrew,
    report: {
      included: [...keepMonsters.map((monster) => label("monster", monster.draft.name)), ...keepHomebrew.map((entry) => label(entry.kind, entry.name))],
      unused: [...monsters.filter((monster) => !usedMonster(monster)).map((monster) => label("monster", monster.draft.name)), ...homebrew.filter((entry) => !usedEntry(entry)).map((entry) => label(entry.kind, entry.name))],
      missing,
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

// A name the importer's shelf does not have yet for this kind.
function freeName(taken: Set<string>, name: string, bundleName: string): string {
  const base = `${name} [${bundleName}]`.slice(0, 80);
  let candidate = base;
  for (let attempt = 2; taken.has(lower(candidate)); attempt += 1) {
    candidate = `${base.slice(0, 74)} ${attempt}`;
  }
  return candidate;
}

export function writeShelfArrivals(userId: string, workshopId: string, bundle: WorkshopBundle): ShelfArrival & { entryFor: (kind: string, name: string) => string | null; renames: Map<string, string> } {
  const bundleName = bundle.manifest.name;
  const reused: string[] = [];
  const renamed: string[] = [];
  let copied = 0;
  // kind:lower(name in the bundle) -> the name it has here.
  const renames = new Map<string, string>();

  const mine = new Map(listHomebrewMonsters(userId).map((monster) => [lower(monster.draft.name), monster]));
  const monsterNames = new Set(mine.keys());
  for (const monster of bundle.monsters) {
    const draft = draftFromData(monster.name, { desc: monster.desc, stats: monster.stats, extraDamagePerRound: monster.extraDamagePerRound });
    const held = mine.get(lower(monster.name));
    if (held && stable(held.draft.stats) === stable(draft.stats)) {
      reused.push(label("monster", monster.name));
      continue;
    }
    const name = held ? freeName(monsterNames, monster.name, bundleName) : monster.name;
    if (held) {
      renames.set(`monster:${lower(monster.name)}`, name);
      renamed.push(`${label("monster", monster.name)} is "${name}" here: your own ${monster.name} has other rules.`);
    }
    createHomebrewMonster(userId, { ...draft, name }, monster.desc);
    monsterNames.add(lower(name));
    copied += 1;
  }

  const owned = listHomebrew(userId);
  const byKey = new Map(owned.map((entry) => [`${entry.kind}:${lower(entry.name)}`, entry]));
  const names = new Map<string, Set<string>>();
  for (const entry of owned) (names.get(entry.kind) ?? names.set(entry.kind, new Set()).get(entry.kind)!).add(lower(entry.name));
  const ids = new Map<string, string>();
  for (const entry of bundle.homebrew) {
    const normalized = normalizeHomebrewData(entry.kind, entry.data, entry.name);
    if ("error" in normalized) continue;
    const key = `${entry.kind}:${lower(entry.name)}`;
    const held = byKey.get(key);
    if (held && comparable(entry.kind, held.name, held.data) === comparable(entry.kind, entry.name, normalized.data)) {
      reused.push(label(entry.kind, entry.name));
      ids.set(key, held.id);
      continue;
    }
    const taken = names.get(entry.kind) ?? new Set<string>();
    const name = held ? freeName(taken, entry.name, bundleName) : entry.name;
    if (held) {
      renames.set(key, name);
      renamed.push(`${label(entry.kind, entry.name)} is "${name}" here: your own ${entry.name} has other rules.`);
    }
    const created = createHomebrew(userId, { kind: entry.kind, name, data: normalized.data });
    ids.set(key, created.id);
    taken.add(lower(name));
    names.set(entry.kind, taken);
    copied += 1;
  }

  // The new workshop's Cast and fights point at the monsters as they are
  // called here.
  const db = getDatabase();
  for (const [key, name] of renames) {
    if (!key.startsWith("monster:")) continue;
    const old = key.slice("monster:".length);
    db.prepare(`UPDATE npcs SET stat_block = ? WHERE campaign_id = ? AND lower(stat_block) = ?`).run(name, workshopId, old);
    const rows = db.prepare(`SELECT id, enemies_json FROM encounter_templates WHERE campaign_id = ?`).all(workshopId) as Array<{ id: string; enemies_json: string }>;
    for (const row of rows) {
      const enemies = parseJson<unknown[]>(row.enemies_json, []);
      let changed = false;
      const next = enemies.map((enemy) => {
        if (typeof enemy === "string" && lower(enemy) === old) {
          changed = true;
          return name;
        }
        if (enemy && typeof enemy === "object" && lower(String((enemy as { monster?: unknown }).monster ?? "")) === old) {
          changed = true;
          return { ...(enemy as Record<string, unknown>), monster: name };
        }
        return enemy;
      });
      if (changed) db.prepare(`UPDATE encounter_templates SET enemies_json = ? WHERE id = ?`).run(JSON.stringify(next), row.id);
    }
  }

  return {
    copied,
    reused,
    renamed,
    renames,
    entryFor: (kind, name) => ids.get(`${kind}:${lower(name)}`) ?? null,
  };
}

// A pregen's sheet as it lands: its portable refs back to this server's ids,
// and any renamed item, spell, feat or subclass under its name here.
export function landedSheet(sheet: CreateSheetInput, arrival: { entryFor: (kind: string, name: string) => string | null; renames: Map<string, string> }): CreateSheetInput {
  const local = (ref: string | undefined) => {
    if (!ref?.startsWith(PORTABLE_REF)) return ref;
    const [kind, ...rest] = ref.slice(PORTABLE_REF.length).split(":");
    const id = arrival.entryFor(kind, rest.join(":"));
    return id ? `homebrew:${id}` : ref;
  };
  const rename = (kind: string, name: string) => arrival.renames.get(`${kind}:${lower(name)}`) ?? name;
  const record = sheet as unknown as Record<string, unknown>;
  const equipment = Array.isArray(record.equipment)
    ? (record.equipment as Array<Record<string, unknown>>).map((item) => ({
        ...item,
        ...(typeof item.slug === "string" ? { slug: local(item.slug) } : {}),
        ...(typeof item.name === "string" ? { name: rename("item", item.name) } : {}),
      }))
    : record.equipment;
  return {
    ...sheet,
    race: local(sheet.race) ?? sheet.race,
    background: local(sheet.background) ?? sheet.background,
    ...(equipment ? { equipment } : {}),
    ...(Array.isArray(record.feats) ? { feats: (record.feats as string[]).map((feat) => rename("feat", feat)) } : {}),
  } as CreateSheetInput;
}
