import { getContentDb } from "@/lib/content/db";
import { listHomebrew } from "@/lib/db/homebrew";
import type { HomebrewKind } from "@/lib/schemas/homebrew";
import { scaledSpellDice } from "@/lib/srd/spell-scaling";

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
    const clauses = ["name LIKE ?"];
    const params: unknown[] = [likeParam(options.q)];
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
  }));
  return [...rows, ...brews];
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
  const wanted = input.spell.trim().toLowerCase();
  if (!wanted) {
    return null;
  }
  const entry = searchSpells({ q: input.spell.trim(), userId: input.userId, limit: 10 }).find(
    (row) => row.name.trim().toLowerCase() === wanted,
  );
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
