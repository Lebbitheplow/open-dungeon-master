import { getContentDb } from "@/lib/content/db";
import { listHomebrew } from "@/lib/db/homebrew";
import { normalizeSpellMech } from "@/lib/homebrew/gear";
import type { HomebrewKind } from "@/lib/schemas/homebrew";
import { servedSpellRows } from "@/lib/content/spell-overrides";
import { EDITION_2024_DOCUMENTS } from "@/lib/content/edition";
import { backgroundMechanics } from "@/lib/content/mechanics";
import { authoredFeatBySlug, withAuthoredFeats } from "@/lib/content/authored-feats";
import {
  authoredSpell,
  bundledSpellFacts,
  factsFromRow,
  type SpellFacts,
} from "@/lib/srd/spell-facts";
import { addDice, scaledSpellDice } from "@/lib/srd/spell-scaling";
import {
  authoredSpellRow,
  parseSpellMech,
  spellMechFor,
  type SpellMech,
} from "@/lib/srd/spell-mechanics";

// Unified content entry: Open5e rows and homebrew rows share this shape so
// pickers render one list. `data` is the raw normalized payload (Open5e API
// row or homebrew data blob).
export type ContentEntry = {
  slug: string;
  name: string;
  source: "open5e" | "homebrew";
  documentSlug: string;
  data: Record<string, unknown>;
};

export type SpellEntry = ContentEntry & {
  level: number;
  school: string;
  classes: string[];
  ritual: boolean;
  concentration: boolean;
  // Other names this spell is printed under, lowercased. The SRD renames the
  // wizard-named PHB spells, so "Acid Arrow" also answers to "Melf's Acid
  // Arrow". Callers that need an exact name match must use spellNameMatches.
  aliases: string[];
};

export type ItemEntry = ContentEntry & {
  kind: "weapon" | "armor" | "gear" | "magic_item";
  rarity: string;
  cost: string;
  category: string;
  // Pounds. 0 means the source did not say, not that the item is weightless;
  // itemWeightLb in src/lib/srd/encumbrance.ts fills the gaps it can and
  // reports the rest as unweighed.
  weight: number;
};

type SearchOptions = {
  q?: string;
  limit?: number;
  offset?: number;
  userId?: string;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(limit?: number) {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

function likeParam(q?: string) {
  return `%${(q ?? "").trim().replace(/[%_]/g, "")}%`;
}

function parseData(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function homebrewEntries(userId: string | undefined, kind: HomebrewKind, q?: string): ContentEntry[] {
  if (!userId) {
    return [];
  }
  const needle = (q ?? "").trim().toLowerCase();
  return listHomebrew(userId, kind)
    .filter((entry) => !needle || entry.name.toLowerCase().includes(needle))
    .map((entry) => ({
      slug: `homebrew:${entry.id}`,
      name: entry.name,
      source: "homebrew" as const,
      documentSlug: "homebrew",
      data: entry.data,
    }));
}

type SpellRow = {
  slug: string;
  name: string;
  document_slug: string;
  level: number;
  school: string;
  classes_csv: string;
  ritual: number;
  concentration: number;
  aliases_csv: string;
  data_json: string;
};

declare global {
  var __odmServedSpells: { db: unknown; rows: SpellEntry[] } | undefined;
}

// Every spell the pack holds, as this engine serves it: one row a name, the
// SRD's before any reprint, corrected where the pack is wrong
// (src/lib/content/spell-overrides.ts). The pack is read-only, so the list is
// built once for the life of the process.
export function allPackSpells(): SpellEntry[] {
  const db = getContentDb();
  if (!db) {
    return [];
  }
  if (globalThis.__odmServedSpells?.db === db) {
    return globalThis.__odmServedSpells.rows;
  }
  const found = db.prepare(`SELECT * FROM spells`).all() as SpellRow[];
  const rows = servedSpellRows(
    found.map((row) => ({
      slug: row.slug,
      name: row.name,
      documentSlug: row.document_slug,
      level: row.level,
      school: row.school,
      classes: row.classes_csv ? row.classes_csv.split(",") : [],
      ritual: row.ritual === 1,
      concentration: row.concentration === 1,
      aliases: row.aliases_csv ? row.aliases_csv.split("|") : [],
      data: parseData(row.data_json),
    })),
  ).map((row) => ({ ...row, source: "open5e" as const }));
  globalThis.__odmServedSpells = { db, rows };
  return rows;
}

// Whose homebrew a search reads. `userIds` is for play, where the spells that
// count are the ones whoever runs the table wrote (src/lib/dm/spell-authors.ts);
// `userId` is one person looking at their own work.
type SpellAuthors = { userId?: string; userIds?: string[] };

function authorsOf(options: SpellAuthors): string[] {
  const ids = options.userIds ?? (options.userId ? [options.userId] : []);
  return [...new Set(ids.filter(Boolean))];
}

// A name somebody published: in the pack, or on the bundled checklist when
// there is no pack to ask.
function isPublishedSpellName(name: string): boolean {
  const wanted = name.trim().toLowerCase();
  if (!wanted) {
    return false;
  }
  if (bundledSpellFacts(wanted)) {
    return true;
  }
  return allPackSpells().some(
    (entry) =>
      entry.name.trim().toLowerCase() === wanted ||
      entry.aliases.some((alias) => alias.trim().toLowerCase() === wanted),
  );
}

export function searchSpells(
  options: SearchOptions & SpellAuthors & { classSlug?: string; level?: number } = {},
): SpellEntry[] {
  const needle = (options.q ?? "").trim().replace(/[%_]/g, "").toLowerCase();
  const classSlug = (options.classSlug ?? "").trim().toLowerCase();
  const offset = Math.max(0, options.offset ?? 0);
  const rows = allPackSpells()
    .filter(
      (row) =>
        (!needle ||
          row.name.toLowerCase().includes(needle) ||
          row.aliases.some((alias) => alias.toLowerCase().includes(needle))) &&
        (!classSlug || row.classes.some((entry) => entry.includes(classSlug))) &&
        (options.level === undefined || row.level <= options.level),
    )
    .slice(offset, offset + clampLimit(options.limit));
  // A published name is the published spell's: a homebrew row that takes the
  // name of one is not offered in its place, so nobody rewrites Revivify into
  // a 1st level spell by writing their own.
  const brews = authorsOf(options)
    .flatMap((userId) => homebrewEntries(userId, "spell", options.q))
    .filter((entry) => !isPublishedSpellName(entry.name))
    .map((entry) => ({
      ...entry,
      level: Number(entry.data.level ?? 0),
      school: String(entry.data.school ?? ""),
      classes: Array.isArray(entry.data.classes) ? (entry.data.classes as string[]) : [],
      ritual: entry.data.ritual === true,
      concentration: entry.data.concentration === true,
      aliases: [] as string[],
    }));
  // The DM's own work leads: a homebrew goblin boss should not sit after
  // twenty-five catalogue goblins.
  return [...brews, ...rows];
}

// Does this row answer to `name`? Every caller that wants one specific spell
// out of a search must go through this rather than comparing `entry.name`,
// or a book name silently fails to match its SRD-titled row.
export function spellNameMatches(entry: SpellEntry, name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return (
    entry.name.trim().toLowerCase() === wanted ||
    entry.aliases.some((alias) => alias.trim().toLowerCase() === wanted)
  );
}

// The one spell a name refers to, alias-aware. The second argument is whose
// homebrew may answer for a name nobody published: one user, or in play the
// people who run the table.
export function findSpellByName(name: string, authors?: string | string[]): SpellEntry | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }
  const userIds = Array.isArray(authors) ? authors : authors ? [authors] : [];
  return (
    searchSpells({ q: trimmed, userIds, limit: MAX_LIMIT }).find((entry) =>
      spellNameMatches(entry, trimmed),
    ) ?? null
  );
}

// What a cast needs to know of a spell (src/lib/srd/spell-facts.ts): from the
// pack's row when the pack answers, from the bundled data when it does not,
// and from the table's homebrew for a name nobody published.
export function spellFactsFor(name: string, authors?: string | string[]): SpellFacts | null {
  const entry = findSpellByName(name, authors);
  if (entry) {
    return factsFromRow({
      name: entry.name,
      level: entry.level,
      ritual: entry.ritual,
      concentration: entry.concentration,
      classes: entry.classes,
      aliases: entry.aliases,
      homebrew: entry.source === "homebrew",
      data: entry.data,
    });
  }
  return bundledSpellFacts(name);
}

export function searchItems(
  options: SearchOptions & { kind?: ItemEntry["kind"] } = {},
): ItemEntry[] {
  const db = getContentDb();
  const rows: ItemEntry[] = [];
  if (db) {
    const clauses = ["name LIKE ?"];
    const params: unknown[] = [likeParam(options.q)];
    if (options.kind) {
      clauses.push("kind = ?");
      params.push(options.kind);
    }
    params.push(clampLimit(options.limit), options.offset ?? 0);
    const found = db
      .prepare(
        `SELECT * FROM items WHERE ${clauses.join(" AND ")} ORDER BY name LIMIT ? OFFSET ?`,
      )
      .all(...params) as Array<{
      slug: string;
      name: string;
      document_slug: string;
      kind: ItemEntry["kind"];
      rarity: string;
      cost: string;
      category: string;
      weight: number;
      data_json: string;
    }>;
    rows.push(
      ...found.map((row) => ({
        slug: row.slug,
        name: row.name,
        source: "open5e" as const,
        documentSlug: row.document_slug,
        kind: row.kind,
        rarity: row.rarity,
        cost: row.cost,
        category: row.category,
        weight: row.weight ?? 0,
        data: parseData(row.data_json),
      })),
    );
  }
  const brews = homebrewEntries(options.userId, "item", options.q).map((entry) => ({
    ...entry,
    kind: (entry.data.itemKind as ItemEntry["kind"]) ?? "gear",
    rarity: String(entry.data.rarity ?? ""),
    cost: String(entry.data.cost ?? ""),
    category: "homebrew",
    weight: Number(entry.data.weight ?? 0) || 0,
  }));
  const merged = [...brews, ...rows];
  return options.kind ? merged.filter((item) => item.kind === options.kind) : merged;
}

function searchSimpleTable(
  table: "feats" | "conditions" | "backgrounds" | "races" | "classes" | "archetypes",
  options: SearchOptions & { extraWhere?: string; extraParams?: unknown[] } = {},
): ContentEntry[] {
  const db = getContentDb();
  if (!db) {
    return [];
  }
  const clauses = ["name LIKE ?"];
  const params: unknown[] = [likeParam(options.q)];
  // The rules rows a 2014 character is offered leave the 2024 documents out
  // (src/lib/content/edition.ts). Conditions are rules text read by name and
  // keep every row.
  if (table !== "conditions" && EDITION_2024_DOCUMENTS.size) {
    clauses.push(`document_slug NOT IN (${[...EDITION_2024_DOCUMENTS].map(() => "?").join(", ")})`);
    params.push(...EDITION_2024_DOCUMENTS);
  }
  if (options.extraWhere) {
    clauses.push(options.extraWhere);
    params.push(...(options.extraParams ?? []));
  }
  params.push(clampLimit(options.limit), options.offset ?? 0);
  const rows = db
    .prepare(
      `SELECT slug, name, document_slug, data_json FROM ${table} WHERE ${clauses.join(" AND ")} ORDER BY name LIMIT ? OFFSET ?`,
    )
    .all(...params) as Array<{
    slug: string;
    name: string;
    document_slug: string;
    data_json: string;
  }>;
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    source: "open5e" as const,
    documentSlug: row.document_slug,
    data: parseData(row.data_json),
  }));
}

export function searchFeats(options: SearchOptions = {}): ContentEntry[] {
  const served = searchSimpleTable("feats", options);
  // Every name the pack serves for this search, on any page, so ODM's own
  // feats fill only what the pack lacks (src/lib/content/authored-feats.ts).
  const editions = [...EDITION_2024_DOCUMENTS];
  const notIn = editions.length ? ` AND document_slug NOT IN (${editions.map(() => "?").join(", ")})` : "";
  const packRows = options.offset
    ? []
    : (getContentDb()
        ?.prepare(`SELECT name FROM feats WHERE name LIKE ?${notIn}`)
        .all(likeParam(options.q), ...editions) as Array<{ name: string }> | undefined) ?? [];
  const packNames = packRows.map((row) => row.name);
  return [
    ...homebrewEntries(options.userId, "feat", options.q),
    ...withAuthoredFeats(served, { ...options, packNames }),
  ];
}

export function listConditions(options: SearchOptions = {}): ContentEntry[] {
  return searchSimpleTable("conditions", { ...options, limit: options.limit ?? MAX_LIMIT });
}

// Every background gives two skill proficiencies. A pack row whose text
// grants none (Tal'Dorei's Fate-Touched arrives with no skill line at all)
// would leave a character two skills short, so it is not offered.
function givesTwoSkills(entry: ContentEntry): boolean {
  const grants = backgroundMechanics(entry.data);
  return grants.skills.length + (grants.skillChoice?.count ?? 0) === 2;
}

export function listBackgrounds(options: SearchOptions = {}): ContentEntry[] {
  return [
    ...searchSimpleTable("backgrounds", { ...options, limit: options.limit ?? MAX_LIMIT }).filter(givesTwoSkills),
    ...homebrewEntries(options.userId, "background", options.q),
  ];
}

// A subrace row says which race it belongs to (data.parent_slug), so the
// builder can fold the parent's speed, languages and ability bumps into it.
function subraceParents(): Map<string, string> {
  const db = getContentDb();
  if (!db) {
    return new Map();
  }
  const rows = db
    .prepare("SELECT slug, parent_slug FROM races WHERE is_subrace = 1 AND parent_slug <> ''")
    .all() as Array<{ slug: string; parent_slug: string }>;
  return new Map(rows.map((row) => [row.slug, row.parent_slug]));
}

export function listRaces(options: SearchOptions & { includeSubraces?: boolean } = {}): ContentEntry[] {
  const parents = options.includeSubraces === false ? new Map<string, string>() : subraceParents();
  return [
    ...searchSimpleTable("races", {
      ...options,
      limit: options.limit ?? MAX_LIMIT,
      ...(options.includeSubraces === false
        ? { extraWhere: "is_subrace = 0", extraParams: [] }
        : {}),
    }).map((entry) => {
      const parent = parents.get(entry.slug);
      return parent ? { ...entry, data: { ...entry.data, parent_slug: parent } } : entry;
    }),
    ...homebrewEntries(options.userId, "race", options.q),
  ];
}

export function listClasses(options: SearchOptions = {}): ContentEntry[] {
  return searchSimpleTable("classes", { ...options, limit: options.limit ?? MAX_LIMIT });
}

export function listArchetypes(classSlug: string, options: SearchOptions = {}): ContentEntry[] {
  return [
    ...searchSimpleTable("archetypes", {
      ...options,
      limit: options.limit ?? MAX_LIMIT,
      extraWhere: "class_slug = ?",
      extraParams: [classSlug],
    }),
    ...homebrewEntries(options.userId, "archetype", options.q).filter(
      (entry) => !entry.data.classSlug || entry.data.classSlug === classSlug,
    ),
  ];
}

export function searchMonsters(
  options: SearchOptions & { maxCr?: number } = {},
): ContentEntry[] {
  const db = getContentDb();
  const open5e = db
    ? (db
        .prepare(
          `SELECT slug, name, document_slug, data_json FROM monsters WHERE name LIKE ? ${
            options.maxCr !== undefined ? "AND cr <= ?" : ""
          } ORDER BY name LIMIT ? OFFSET ?`,
        )
        .all(
          ...[
            likeParam(options.q),
            ...(options.maxCr !== undefined ? [options.maxCr] : []),
            clampLimit(options.limit),
            options.offset ?? 0,
          ],
        ) as Array<{ slug: string; name: string; document_slug: string; data_json: string }>)
    : [];
  return [
    ...open5e.map((row) => ({
      slug: row.slug,
      name: row.name,
      source: "open5e" as const,
      documentSlug: row.document_slug,
      data: parseData(row.data_json),
    })),
    ...homebrewEntries(options.userId, "monster", options.q),
  ];
}

export type ContentDocument = {
  slug: string;
  title: string;
  license: string;
  author: string;
  url: string;
};

export function listDocuments(): ContentDocument[] {
  const db = getContentDb();
  if (!db) {
    return [];
  }
  const rows = db
    .prepare(`SELECT slug, title, license, author, url FROM documents ORDER BY title`)
    .all() as ContentDocument[];
  return rows;
}

// Detail lookup by slug across a kind; homebrew slugs are "homebrew:<id>".
export function getEntryDetail(
  kind: "spells" | "feats" | "conditions" | "backgrounds" | "races" | "classes" | "archetypes" | "items" | "monsters",
  slug: string,
): ContentEntry | null {
  const db = getContentDb();
  if (slug.startsWith("homebrew:")) {
    return null;
  }
  const row = db
    ?.prepare(`SELECT slug, name, document_slug, data_json FROM ${kind} WHERE slug = ?`)
    .get(slug) as { slug: string; name: string; document_slug: string; data_json: string } | undefined;
  // A feat ODM wrote answers for its name where the pack has none, or has
  // only the 2024 row a 2014 character is never offered (Alert).
  if (kind === "feats" && (!row || EDITION_2024_DOCUMENTS.has(row.document_slug))) {
    const authored = authoredFeatBySlug(slug);
    if (authored) {
      return authored;
    }
  }
  if (!row) {
    return null;
  }
  return {
    slug: row.slug,
    name: row.name,
    source: "open5e",
    documentSlug: row.document_slug,
    data: parseData(row.data_json),
  };
}

// The dice a named spell actually rolls for this caster, derived from the
// spell's own row rather than taken on trust from the model: an authored
// dice row first (src/lib/srd/spell-mechanics.ts), then the text
// (src/lib/srd/spell-scaling.ts). Null when the spell is unknown or deals
// nothing a die can state, in which case the caller keeps the model's dice.
export function spellDamageFor(input: {
  spell: string;
  userId?: string;
  userIds?: string[];
  casterLevel: number;
  slotLevel?: number;
  // Magic Missile: how many of the darts are meant, all of them when absent.
  darts?: number;
}): { dice: string; note: string; spellLevel: number } | null {
  const entry = findSpellByName(input.spell, input.userIds ?? input.userId);
  const authored = entry ? null : authoredSpell(input.spell);
  const spellLevel = entry?.level ?? authored?.level ?? bundledSpellFacts(input.spell)?.level ?? null;
  if (spellLevel === null) {
    return null;
  }
  const mech = spellMechFor([entry?.name ?? input.spell, ...(entry?.aliases ?? []), input.spell]);
  const slotLevel = Math.max(spellLevel, Math.floor(input.slotLevel ?? spellLevel));
  if (mech?.hitPointPool) {
    // A pool of hit points is not damage.
    return null;
  }
  if (mech?.darts) {
    const held = mech.darts.count + mech.darts.perSlotLevel * (slotLevel - spellLevel);
    const thrown = Math.max(1, Math.min(held, Math.floor(input.darts ?? held)));
    const [die, flat] = mech.darts.each.split("+");
    const sides = die.split("d")[1];
    return {
      dice: `${thrown}d${sides}${flat ? `+${Number(flat) * thrown}` : ""}`,
      note: `${thrown} of ${held} darts of ${mech.darts.each}`,
      spellLevel,
    };
  }
  if (mech?.dice) {
    const above = Math.max(0, slotLevel - mech.dice.baseLevel);
    const dice = mech.dice.perSlotLevel
      ? addDice(mech.dice.base, mech.dice.perSlotLevel, above)
      : mech.dice.base;
    return {
      dice,
      note: above ? `upcast to level ${slotLevel}: ${dice}` : `${dice} at its base level`,
      spellLevel,
    };
  }
  if (mech?.resolution === "utility" || mech?.resolution === "summon") {
    return null;
  }
  const desc = String(entry?.data.desc ?? authored?.desc ?? "");
  if (!desc) {
    return null;
  }
  const scaled = scaledSpellDice({
    spellLevel,
    desc,
    higherLevel: String(entry?.data.higher_level ?? authored?.higher_level ?? ""),
    casterLevel: input.casterLevel,
    slotLevel: input.slotLevel,
  });
  return scaled ? { ...scaled, spellLevel } : null;
}

// The structured mechanics a spell resolves with: authored `mech` rows and
// the SRD overrides first, prose parsing second, null for spells no pack
// knows (homebrew keeps the model-supplied fallback). The cast tools treat a
// non-null answer as authoritative over the model's arguments.
export type ResolvedSpellMech = {
  mech: SpellMech;
  name: string;
  spellLevel: number;
  concentration: boolean;
};

export function spellMechanicsFor(input: {
  spell: string;
  userId?: string;
  userIds?: string[];
}): ResolvedSpellMech | null {
  const entry = findSpellByName(input.spell, input.userIds ?? input.userId);
  if (entry) {
    // A homebrew spell may carry its own block (src/lib/homebrew/gear.ts),
    // which beats parsing its prose; the prose is still parsed for damage.
    const mech =
      (entry.source === "homebrew" ? normalizeSpellMech(entry.data.mech) : null) ??
      spellMechFor([entry.name, ...entry.aliases, input.spell]) ??
      parseSpellMech({
        desc: String(entry.data.desc ?? ""),
        higherLevel: String(entry.data.higher_level ?? ""),
      });
    return mech
      ? { mech, name: entry.name, spellLevel: entry.level, concentration: entry.concentration }
      : null;
  }
  // No content database (or an unbundled name): the authored layer and the
  // checklist still answer, the level and the concentration flag included.
  const authored = authoredSpellRow(input.spell);
  const bundled = bundledSpellFacts(input.spell);
  const mech =
    spellMechFor([input.spell, bundled?.name ?? input.spell]) ??
    (authored ? parseSpellMech({ desc: authored.desc }) : null);
  if (!mech) {
    return null;
  }
  return {
    mech,
    name: authored?.name ?? bundled?.name ?? input.spell,
    spellLevel: authored?.level ?? bundled?.level ?? 1,
    concentration: authored?.concentration ?? bundled?.concentration ?? false,
  };
}

// ---- item weights ----

// Name -> pounds, built once from the whole items table (about 2,000 rows,
// a few hundred kilobytes) because the optional encumbrance rule asks for a
// weight on every line of every pack on every sheet read. Rows the source
// left blank carry 0 and are skipped, so an unknown weight stays unknown
// rather than becoming a confident zero.
let weightIndex: Map<string, number> | null = null;

function itemWeightIndex(): Map<string, number> {
  if (weightIndex) {
    return weightIndex;
  }
  const index = new Map<string, number>();
  const db = getContentDb();
  if (db) {
    const rows = db.prepare(`SELECT name, weight FROM items WHERE weight > 0`).all() as Array<{
      name: string;
      weight: number;
    }>;
    for (const row of rows) {
      const key = itemWeightKey(row.name);
      // First writer wins: the v1 weapon and armor tables are imported
      // before the v2 gear list, and their rows are the SRD ones.
      if (key && !index.has(key)) {
        index.set(key, row.weight);
      }
    }
  }
  weightIndex = index;
  return index;
}

// The lookup key for an item name: lowercased, punctuation flattened, and a
// trailing count dropped so "Arrows (20)" finds "Arrows". A magic bonus goes
// too, so "+1 Longsword" weighs what a longsword weighs.
function itemWeightKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(\s*\d+\s*\)\s*$/, " ")
    .replace(/[+-]\d+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Pounds per unit for a free-text item name, or null when the content pack
// has nothing. Callers fall back to the SRD armor table
// (src/lib/srd/encumbrance.ts) before giving up.
export function itemWeightByName(name: string): number | null {
  const key = itemWeightKey(name ?? "");
  if (!key) {
    return null;
  }
  const index = itemWeightIndex();
  return index.get(key) ?? index.get(key.replace(/s$/, "")) ?? null;
}
