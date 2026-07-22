import { getContentDb } from "@/lib/content/db";
import { listHomebrew } from "@/lib/db/homebrew";
import type { HomebrewKind } from "@/lib/schemas/homebrew";
import { scaledSpellDice } from "@/lib/srd/spell-scaling";
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

export function searchSpells(
  options: SearchOptions & { classSlug?: string; level?: number } = {},
): SpellEntry[] {
  const db = getContentDb();
  const rows: SpellEntry[] = [];
  if (db) {
    // Alias matching is what makes a book name find an SRD-titled row.
    const clauses = ["(name LIKE ? OR aliases_csv LIKE ?)"];
    const params: unknown[] = [likeParam(options.q), likeParam((options.q ?? "").toLowerCase())];
    if (options.classSlug) {
      clauses.push("classes_csv LIKE ?");
      params.push(`%${options.classSlug.toLowerCase()}%`);
    }
    if (options.level !== undefined) {
      clauses.push("level <= ?");
      params.push(options.level);
    }
    params.push(clampLimit(options.limit), options.offset ?? 0);
    const found = db
      .prepare(
        `SELECT * FROM spells WHERE ${clauses.join(" AND ")} ORDER BY level, name LIMIT ? OFFSET ?`,
      )
      .all(...params) as Array<{
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
    }>;
    rows.push(
      ...found.map((row) => ({
        slug: row.slug,
        name: row.name,
        source: "open5e" as const,
        documentSlug: row.document_slug,
        level: row.level,
        school: row.school,
        classes: row.classes_csv ? row.classes_csv.split(",") : [],
        ritual: row.ritual === 1,
        concentration: row.concentration === 1,
        aliases: row.aliases_csv ? row.aliases_csv.split("|") : [],
        data: parseData(row.data_json),
      })),
    );
  }
  const brews = homebrewEntries(options.userId, "spell", options.q).map((entry) => ({
    ...entry,
    level: Number(entry.data.level ?? 0),
    school: String(entry.data.school ?? ""),
    classes: Array.isArray(entry.data.classes) ? (entry.data.classes as string[]) : [],
    ritual: entry.data.ritual === true,
    concentration: entry.data.concentration === true,
    aliases: [] as string[],
  }));
  return [...rows, ...brews];
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

// The one spell a name refers to, alias-aware.
export function findSpellByName(name: string, userId?: string): SpellEntry | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }
  return (
    searchSpells({ q: trimmed, userId, limit: 20 }).find((entry) =>
      spellNameMatches(entry, trimmed),
    ) ?? null
  );
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
  }));
  const merged = [...rows, ...brews];
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
  return [...searchSimpleTable("feats", options), ...homebrewEntries(options.userId, "feat", options.q)];
}

export function listConditions(options: SearchOptions = {}): ContentEntry[] {
  return searchSimpleTable("conditions", { ...options, limit: options.limit ?? MAX_LIMIT });
}

export function listBackgrounds(options: SearchOptions = {}): ContentEntry[] {
  return [
    ...searchSimpleTable("backgrounds", { ...options, limit: options.limit ?? MAX_LIMIT }),
    ...homebrewEntries(options.userId, "background", options.q),
  ];
}

export function listRaces(options: SearchOptions & { includeSubraces?: boolean } = {}): ContentEntry[] {
  return [
    ...searchSimpleTable("races", {
      ...options,
      limit: options.limit ?? MAX_LIMIT,
      ...(options.includeSubraces === false
        ? { extraWhere: "is_subrace = 0", extraParams: [] }
        : {}),
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
  if (!db || slug.startsWith("homebrew:")) {
    return null;
  }
  const row = db
    .prepare(`SELECT slug, name, document_slug, data_json FROM ${kind} WHERE slug = ?`)
    .get(slug) as { slug: string; name: string; document_slug: string; data_json: string } | undefined;
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
// content pack's own text rather than taken on trust from the model
// (src/lib/srd/spell-scaling.ts). Null when the spell is unknown or its
// wording does not parse, in which case the caller keeps the model's dice.
export function spellDamageFor(input: {
  spell: string;
  userId: string;
  casterLevel: number;
  slotLevel?: number;
}): { dice: string; note: string; spellLevel: number } | null {
  const entry = findSpellByName(input.spell, input.userId);
  if (!entry) {
    return null;
  }
  const scaled = scaledSpellDice({
    spellLevel: entry.level,
    desc: String(entry.data.desc ?? ""),
    higherLevel: String(entry.data.higher_level ?? ""),
    casterLevel: input.casterLevel,
    slotLevel: input.slotLevel,
  });
  return scaled ? { ...scaled, spellLevel: entry.level } : null;
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
}): ResolvedSpellMech | null {
  const entry = findSpellByName(input.spell, input.userId);
  if (entry) {
    const mech =
      spellMechFor([entry.name, ...entry.aliases, input.spell]) ??
      parseSpellMech({
        desc: String(entry.data.desc ?? ""),
        higherLevel: String(entry.data.higher_level ?? ""),
      });
    return mech
      ? { mech, name: entry.name, spellLevel: entry.level, concentration: entry.concentration }
      : null;
  }
  // No content database (or an unbundled name): the authored layer still
  // answers on its own.
  const authored = authoredSpellRow(input.spell);
  const mech = spellMechFor([input.spell]) ?? (authored ? parseSpellMech({ desc: authored.desc }) : null);
  if (!mech) {
    return null;
  }
  return {
    mech,
    name: authored?.name ?? input.spell,
    spellLevel: authored?.level ?? 1,
    concentration: authored?.concentration ?? false,
  };
}
