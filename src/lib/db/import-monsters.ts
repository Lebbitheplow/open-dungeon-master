import { getDatabase, parseJson } from "@/lib/db/core";
import { resolveMonster } from "@/lib/bestiary";
import { createHomebrewMonster, listHomebrewMonsters, type HomebrewMonster } from "@/lib/bestiary/homebrew-monsters";
import { draftFromData } from "@/lib/bestiary/monster-draft";
import { getCampaignById } from "@/lib/db/campaigns";
import { createHomebrew, getAuthorsHomebrew, isPublishedGearName, listHomebrew, tableAuthors, type HomebrewEntry } from "@/lib/db/homebrew";
import { getWorldDoc, hasWorldDoc, saveWorldDoc } from "@/lib/db/world-forge";
import { freeName, rosterMonsters, sameRules } from "@/lib/db/workshop-bundle-shelf";
import { renamePrepRefs, type PrepRows } from "@/lib/db/prep-refs";
import { homebrewDataRefs, monsterStatsSpells, renameHomebrewDataRefs, renameMonsterStatsSpells } from "@/lib/homebrew/data-refs";
import { spellFactsFor } from "@/lib/characters/catalog";
import { matchGear } from "@/lib/srd/adventuring-gear";
import { normalizeStock } from "@/lib/db/shops";
import { textKey } from "@/lib/language/text-logic";

// Hand-built monsters across a campaign import between different authors
// (audit finding WF-07). A Cast member's stat block and a fight's roster
// name a monster as "homebrew:<id>", and a hand-built monster is its
// author's: at a table whose authors (src/lib/db/homebrew.ts tableAuthors)
// do not include that author, the reference answered to nothing and the
// NPC or the fight lost its rules. Now the monster travels: copied into the
// target table owner's bestiary, or the owner's identical one reused, and
// the copied rows pointed at it. The import is the authority: whoever may
// import from the source may see what its rows fight as.
//
// The same holds for a monster or an item the copied rows name by NAME (a
// workshop that came from a bundle names its monsters so; a roll-table row,
// a map pin and a shop's shelf always do): where the source's authors keep
// the entry that answers to the name and the target's answer with nothing,
// or with another of that name, it travels too, and the copied rows (only
// those) are pointed at it (workshop import audit, follow-up to F04). An
// item or a monster brings the homebrew spells it casts.

const HOMEBREW = "homebrew:";
// A stat block's rules, the same whatever order their keys were saved in.
const stable = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(stable).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`
      : JSON.stringify(value) ?? "";

const homebrewRef = (ref: unknown): ref is string => typeof ref === "string" && ref.trim().startsWith(HOMEBREW) && !ref.trim().startsWith(`${HOMEBREW}@`);

const rosterOf = (json: unknown): string[] => rosterMonsters(parseJson<unknown[]>(typeof json === "string" ? json : "[]", []));

// The hand-built monster refs a campaign's NPCs and fights name.
export function monsterRefsOf(campaignId: string, kinds: { npcs: boolean; encounters: boolean }, only?: { npcs: string[]; encounters: string[] }): string[] {
  const db = getDatabase();
  const refs: string[] = [];
  if (kinds.npcs) {
    const rows = db.prepare(`SELECT id, stat_block FROM npcs WHERE campaign_id = ?`).all(campaignId) as Array<{ id: string; stat_block: unknown }>;
    for (const row of rows) if ((!only || only.npcs.includes(row.id)) && homebrewRef(row.stat_block)) refs.push(row.stat_block.trim());
  }
  if (kinds.encounters) {
    const rows = db.prepare(`SELECT id, enemies_json FROM encounter_templates WHERE campaign_id = ?`).all(campaignId) as Array<{ id: string; enemies_json: unknown }>;
    for (const row of rows) if (!only || only.encounters.includes(row.id)) refs.push(...rosterOf(row.enemies_json).filter(homebrewRef).map((ref) => ref.trim()));
  }
  return [...new Set(refs)];
}

// Of those, the ones the target table cannot use, with the monster each
// names at the source.
export function foreignMonsters(sourceId: string, campaignId: string, refs: string[]): Array<{ ref: string; entry: HomebrewEntry }> {
  const target = getCampaignById(campaignId);
  if (!target) return [];
  const authors = { userIds: tableAuthors(campaignId) };
  const sourceAuthors = tableAuthors(sourceId);
  const out: Array<{ ref: string; entry: HomebrewEntry }> = [];
  for (const ref of new Set(refs)) {
    if (resolveMonster(ref, target.gameSettings, authors)) continue;
    const entry = getAuthorsHomebrew(sourceAuthors, ref.slice(HOMEBREW.length));
    if (entry && entry.kind === "monster") out.push({ ref, entry });
  }
  return out;
}

// The author's own records a campaign's World entries link to, of one kind
// (src/lib/worldforge/model.ts Binding).
export function boundRefsOf(campaignId: string, kind: "monster" | "item"): string[] {
  if (!hasWorldDoc(campaignId)) return [];
  const refs = Object.values(getWorldDoc(campaignId).entries)
    .flatMap((entry) => entry.bindings)
    .filter((binding) => binding.kind === kind && homebrewRef(binding.ref))
    .map((binding) => binding.ref.trim());
  return [...new Set(refs)];
}

// A World entry's links, of one kind, moved to the records that arrived.
function relink(campaignId: string, kind: "monster" | "item", moved: Map<string, string>) {
  if (!moved.size || !hasWorldDoc(campaignId)) return;
  const doc = getWorldDoc(campaignId);
  let changed = false;
  for (const entry of Object.values(doc.entries)) {
    entry.bindings = entry.bindings.map((binding) => {
      const to = binding.kind === kind ? moved.get(binding.ref.trim()) : undefined;
      if (!to) return binding;
      changed = true;
      return { ...binding, ref: to };
    });
  }
  if (changed) saveWorldDoc(campaignId, doc);
}


// ---- by name ----

const parsedRows = <T,>(sql: string, ...args: unknown[]) => getDatabase().prepare(sql).all(...args) as T[];

// The names (not "homebrew:<id>" refs) a campaign's rows give a monster: Cast
// stat blocks, roster rows, roll-table rows and map pins, of the rows given.
export function monsterNamesOf(campaignId: string, only: PrepRows): string[] {
  const names: string[] = [];
  const keep = (value: unknown) => {
    if (typeof value === "string" && value.trim() && !value.trim().startsWith(HOMEBREW)) names.push(value.trim());
  };
  for (const row of parsedRows<{ id: string; stat_block: string }>(`SELECT id, stat_block FROM npcs WHERE campaign_id = ?`, campaignId)) {
    if ((only.npcs ?? []).includes(row.id)) keep(row.stat_block);
  }
  for (const row of parsedRows<{ id: string; enemies_json: string }>(`SELECT id, enemies_json FROM encounter_templates WHERE campaign_id = ?`, campaignId)) {
    if ((only.encounters ?? []).includes(row.id)) rosterOf(row.enemies_json).forEach(keep);
  }
  for (const row of parsedRows<{ id: string; entries_json: string }>(`SELECT id, entries_json FROM roll_tables WHERE campaign_id = ?`, campaignId)) {
    if (!(only.tables ?? []).includes(row.id)) continue;
    for (const entry of parseJson<Array<{ ref?: { kind?: unknown; name?: unknown } }>>(row.entries_json, [])) if (entry?.ref?.kind === "monster") keep(entry.ref.name);
  }
  for (const row of parsedRows<{ id: string; labels_json: string }>(`SELECT id, labels_json FROM prepared_maps WHERE campaign_id = ?`, campaignId)) {
    if (!(only.maps ?? []).includes(row.id)) continue;
    for (const label of parseJson<Array<{ ref?: { kind?: unknown; id?: unknown } }>>(row.labels_json, [])) if (label?.ref?.kind === "monster") keep(label.ref.id);
  }
  return [...new Set(names)];
}

// Of those, the ones the source's authors answer with a monster of their own
// that the target's answer with nothing or with other rules.
export function foreignMonstersByName(sourceId: string, campaignId: string, names: string[]): Array<{ ref: string; entry: HomebrewEntry }> {
  const source = getCampaignById(sourceId);
  const target = getCampaignById(campaignId);
  if (!source || !target) return [];
  const sourceAuthors = tableAuthors(sourceId);
  const targetAuthors = tableAuthors(campaignId);
  const out: Array<{ ref: string; entry: HomebrewEntry }> = [];
  for (const name of new Set(names)) {
    const there = resolveMonster(name, source.gameSettings, { userIds: sourceAuthors });
    if (!there?.slug.startsWith(HOMEBREW)) continue;
    const entry = getAuthorsHomebrew(sourceAuthors, there.slug.slice(HOMEBREW.length));
    if (!entry || entry.kind !== "monster") continue;
    const here = resolveMonster(name, target.gameSettings, { userIds: targetAuthors });
    if (here && stable(here.stats) === stable(there.stats)) continue;
    out.push({ ref: name, entry });
  }
  return out;
}

// The item names a campaign's shops stock and its roll-table rows give, of
// the rows given.
export function itemNamesOf(campaignId: string, only: PrepRows): string[] {
  const names: string[] = [];
  for (const row of parsedRows<{ id: string; stock_json: string; prepared_stock_json: string | null }>(`SELECT id, stock_json, prepared_stock_json FROM shops WHERE campaign_id = ?`, campaignId)) {
    if (!(only.shops ?? []).includes(row.id)) continue;
    for (const line of [...normalizeStock(parseJson(row.stock_json, [])), ...normalizeStock(parseJson(row.prepared_stock_json || "[]", []))]) names.push(line.itemName);
  }
  for (const row of parsedRows<{ id: string; entries_json: string }>(`SELECT id, entries_json FROM roll_tables WHERE campaign_id = ?`, campaignId)) {
    if (!(only.tables ?? []).includes(row.id)) continue;
    for (const entry of parseJson<Array<{ ref?: { kind?: unknown; name?: unknown } }>>(row.entries_json, [])) {
      if (entry?.ref?.kind === "item" && typeof entry.ref.name === "string") names.push(entry.ref.name);
    }
  }
  return [...new Set(names.filter((name) => name.trim()))];
}

// The first of these authors' entries of a kind by name, live before forgotten.
function authorsEntryNamed(userIds: string[], kind: HomebrewEntry["kind"], name: string): HomebrewEntry | null {
  for (const userId of userIds) {
    const found = listHomebrew(userId, kind, { archived: true }).find((entry) => textKey(entry.name) === textKey(name));
    if (found) return found;
  }
  return null;
}

// Items the source's authors keep under a name its rows use, which the books
// do not publish and the target's authors keep under other rules or not at all.
export function foreignItemsByName(sourceId: string, campaignId: string, names: string[]): Array<{ ref: string; entry: HomebrewEntry }> {
  const sourceAuthors = tableAuthors(sourceId);
  const targetAuthors = tableAuthors(campaignId);
  const out: Array<{ ref: string; entry: HomebrewEntry }> = [];
  for (const name of new Set(names)) {
    if (isPublishedGearName(name) || matchGear(name)) continue;
    const entry = authorsEntryNamed(sourceAuthors, "item", name);
    if (!entry) continue;
    const held = authorsEntryNamed(targetAuthors, "item", name);
    if (held && sameRules("item", held, entry)) continue;
    out.push({ ref: name, entry });
  }
  return out;
}

// The homebrew spells some entries cast that the target's authors do not keep
// with the same rules, brought into the owner's Homebrew; the names they
// arrived under where those differ.
function bringSpells(sourceAuthors: string[], targetAuthors: string[], owner: string, spellNames: string[], sourceTitle: string, report: { brought: string[]; reused: string[] }): Map<string, string> {
  const renames = new Map<string, string>();
  const mine = new Map(listHomebrew(owner, "spell").map((entry) => [textKey(entry.name), entry]));
  for (const name of new Set(spellNames)) {
    // A spell the books publish answers to its name whatever a shelf holds.
    if (spellFactsFor(name) !== null) continue;
    const entry = authorsEntryNamed(sourceAuthors, "spell", name);
    if (!entry) continue;
    const held = authorsEntryNamed(targetAuthors, "spell", name);
    if (held && sameRules("spell", held, entry)) continue;
    const clash = mine.get(textKey(entry.name));
    const landed = clash ? freeName(new Set(mine.keys()), entry.name, sourceTitle, 60) : entry.name;
    if (clash) renames.set(textKey(entry.name), landed);
    const made = createHomebrew(owner, { kind: "spell", name: landed, data: { desc: "", ...entry.data } as Parameters<typeof createHomebrew>[1]["data"] });
    mine.set(textKey(landed), made);
    report.brought.push(landed);
  }
  return renames;
}

const spellRenamer = (renames: Map<string, string>) => (kind: string, name: string) => (kind === "spell" ? (renames.get(textKey(name)) ?? name) : name);

// After the copy: the monsters the copied rows need, by "homebrew:<id>" and
// by name, and the ones the copied World entries link to (`world`), brought
// into the target owner's bestiary (with the homebrew spells they cast), and
// the copied rows and links pointed at them.
export function bringMonsters(
  sourceId: string,
  campaignId: string,
  copied: { npcs: string[]; encounters: string[]; tables?: string[]; maps?: string[] },
  world = false,
): { brought: string[]; reused: string[]; spells: string[] } {
  const target = getCampaignById(campaignId);
  const source = getCampaignById(sourceId);
  if (!target || !source) return { brought: [], reused: [], spells: [] };
  const refs = [
    ...(copied.npcs.length || copied.encounters.length ? monsterRefsOf(campaignId, { npcs: true, encounters: true }, copied) : []),
    ...(world ? boundRefsOf(campaignId, "monster") : []),
  ];
  const foreign = [...foreignMonsters(sourceId, campaignId, refs), ...foreignMonstersByName(sourceId, campaignId, monsterNamesOf(campaignId, copied))];
  if (!foreign.length) return { brought: [], reused: [], spells: [] };

  const owner = target.ownerUserId;
  const spellReport = { brought: [] as string[], reused: [] as string[] };
  const spellsAs = bringSpells(tableAuthors(sourceId), tableAuthors(campaignId), owner, foreign.flatMap(({ entry }) => monsterStatsSpells(entry.data.stats)), source.title, spellReport);
  const mine = new Map<string, HomebrewMonster>(listHomebrewMonsters(owner).map((monster) => [textKey(monster.draft.name), monster]));
  // A ref as the copied rows hold it -> what they hold now: the slug for a
  // "homebrew:<id>" ref, the name it is called here for a name.
  const moved = new Map<string, string>();
  const brought: string[] = [];
  const reused: string[] = [];
  for (const { ref, entry } of foreign) {
    const data = { ...entry.data, stats: renameMonsterStatsSpells(entry.data.stats, spellRenamer(spellsAs)).stats };
    const draft = draftFromData(entry.name, data);
    const desc = typeof (entry.data as { desc?: unknown }).desc === "string" ? String((entry.data as { desc?: unknown }).desc) : "";
    const byName = !homebrewRef(ref);
    const held = mine.get(textKey(entry.name));
    if (held && stable(held.draft.stats) === stable(draft.stats)) {
      moved.set(textKey(ref), byName ? held.draft.name : held.slug);
      if (!reused.includes(entry.name)) reused.push(entry.name);
      continue;
    }
    // A monster of that name with other rules is the owner's own: this one
    // arrives beside it under the source's name, as a bundle's does.
    let name = entry.name;
    if (held) {
      const base = `${entry.name} [${source.title}]`.slice(0, 80);
      name = base;
      for (let attempt = 2; mine.has(textKey(name)); attempt += 1) name = `${base.slice(0, 74)} ${attempt}`;
    }
    const made = createHomebrewMonster(owner, { ...draft, name }, desc);
    mine.set(textKey(name), made);
    moved.set(textKey(ref), byName ? name : made.slug);
    brought.push(name);
  }

  // Only the rows this import wrote: the target's own rows that name a
  // monster of that name meant their own.
  renamePrepRefs(campaignId, { monster: moved }, { npcs: copied.npcs, encounters: copied.encounters, tables: copied.tables ?? [], maps: copied.maps ?? [] });
  if (world) {
    relink(campaignId, "monster", new Map(foreign.filter(({ ref }) => homebrewRef(ref)).map(({ ref }) => [ref.trim(), moved.get(textKey(ref)) ?? ref])));
  }
  return { brought, reused, spells: spellReport.brought };
}

// Hand-built items a World entry links to that the target table's authors
// do not have, with the item each names at the source.
export function foreignItems(sourceId: string, campaignId: string, refs: string[]): Array<{ ref: string; entry: HomebrewEntry }> {
  const targetAuthors = tableAuthors(campaignId);
  const sourceAuthors = tableAuthors(sourceId);
  const out: Array<{ ref: string; entry: HomebrewEntry }> = [];
  for (const ref of new Set(refs)) {
    const id = ref.slice(HOMEBREW.length);
    if (getAuthorsHomebrew(targetAuthors, id)?.kind === "item") continue;
    const entry = getAuthorsHomebrew(sourceAuthors, id);
    if (entry && entry.kind === "item") out.push({ ref, entry });
  }
  return out;
}

// After the copy: the items the copied World entries link to (`world`), and
// the ones the copied shops stock and roll-table rows name, brought into the
// target owner's Homebrew the way monsters are (an identical one reused, one
// of the same name with other rules kept beside it, the homebrew spells they
// cast with them), and the links and copied rows pointed at them. Shops and
// inventories then find them as this table's.
export function bringItems(
  sourceId: string,
  campaignId: string,
  copied: { shops?: string[]; tables?: string[] } = {},
  world = true,
): { brought: string[]; reused: string[]; spells: string[] } {
  const target = getCampaignById(campaignId);
  const source = getCampaignById(sourceId);
  if (!target || !source) return { brought: [], reused: [], spells: [] };
  const foreign = [
    ...(world ? foreignItems(sourceId, campaignId, boundRefsOf(campaignId, "item")) : []),
    ...foreignItemsByName(sourceId, campaignId, itemNamesOf(campaignId, { shops: copied.shops ?? [], tables: copied.tables ?? [] })),
  ];
  if (!foreign.length) return { brought: [], reused: [], spells: [] };
  const owner = target.ownerUserId;
  const spellReport = { brought: [] as string[], reused: [] as string[] };
  const spellsAs = bringSpells(tableAuthors(sourceId), tableAuthors(campaignId), owner, foreign.flatMap(({ entry }) => homebrewDataRefs("item", entry.data).spell), source.title, spellReport);
  const mine = new Map<string, HomebrewEntry>(listHomebrew(owner, "item").map((item) => [textKey(item.name), item]));
  const moved = new Map<string, string>();
  const brought: string[] = [];
  const reused: string[] = [];
  for (const { ref, entry } of foreign) {
    const data = renameHomebrewDataRefs("item", entry.data, spellRenamer(spellsAs)).data;
    const byName = !homebrewRef(ref);
    const held = mine.get(textKey(entry.name));
    if (held && sameRules("item", held, { name: entry.name, data })) {
      moved.set(textKey(ref), byName ? held.name : `${HOMEBREW}${held.id}`);
      if (!reused.includes(entry.name)) reused.push(entry.name);
      continue;
    }
    let name = entry.name;
    if (held) {
      const base = `${entry.name} [${source.title}]`.slice(0, 80);
      name = base;
      for (let attempt = 2; mine.has(textKey(name)); attempt += 1) name = `${base.slice(0, 74)} ${attempt}`;
    }
    const made = createHomebrew(owner, { kind: "item", name, data: { desc: "", ...data } as Parameters<typeof createHomebrew>[1]["data"] });
    mine.set(textKey(name), made);
    moved.set(textKey(ref), byName ? name : `${HOMEBREW}${made.id}`);
    brought.push(name);
  }
  renamePrepRefs(campaignId, { item: new Map([...moved].filter(([key]) => !key.startsWith("homebrew "))) }, { shops: copied.shops ?? [], tables: copied.tables ?? [] });
  if (world) {
    relink(campaignId, "item", new Map(foreign.filter(({ ref }) => homebrewRef(ref)).map(({ ref }) => [ref.trim(), moved.get(textKey(ref)) ?? ref])));
  }
  return { brought, reused, spells: spellReport.brought };
}

// For the preview: the names of the monsters and items an import would bring
// in, by "homebrew:<id>" and by name, from the source rows that travel.
export function arrivingShelf(
  sourceId: string,
  campaignId: string,
  kinds: { world: boolean; npcs: boolean; encounters: boolean },
  rows: PrepRows,
): { foreignMonsters: string[]; foreignItems: string[] } {
  const monsters = [
    ...foreignMonsters(sourceId, campaignId, [
      ...monsterRefsOf(sourceId, { npcs: kinds.npcs, encounters: kinds.encounters }),
      // And the ones a World entry links to (WF-17), when the world travels.
      ...(kinds.world ? boundRefsOf(sourceId, "monster") : []),
    ]),
    ...foreignMonstersByName(sourceId, campaignId, monsterNamesOf(sourceId, rows)),
  ];
  const items = [
    ...(kinds.world ? foreignItems(sourceId, campaignId, boundRefsOf(sourceId, "item")) : []),
    ...foreignItemsByName(sourceId, campaignId, itemNamesOf(sourceId, rows)),
  ];
  return {
    foreignMonsters: [...new Set(monsters.map((monster) => monster.entry.name))],
    foreignItems: [...new Set(items.map((item) => item.entry.name))],
  };
}
