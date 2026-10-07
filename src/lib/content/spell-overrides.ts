// What ODM corrects in the content pack's spell rows as it reads them.
//
// The pack (data/content/open5e.sqlite) is built from Open5e and is never
// edited by hand. It carries the SRD's spells beside third party documents
// that reprint the same names with other levels and other text, a handful of
// 2024 rows in another shape, and class lists that leave the paladin off and
// fold subclass grants in. This engine plays SRD 5.1 (2014), so:
//
//   - a name answers to ONE row: the SRD's, then ODM's own authored spell,
//     then any other document's. A third party Haste never shadows the SRD's;
//   - the 2024 rows are not offered at all. The two spells that existed only
//     there (Hex, Chromatic Orb) are ODM's own 2014 restatements in
//     src/lib/srd/authored-spells.json;
//   - ODM's authored spells are read from the bundled file, so a correction
//     to it does not wait for the pack to be rebuilt;
//   - a school is one of the eight;
//   - a class list is the checklist's (src/lib/srd/manifest/spells.json),
//     where the checklist carries the spell;
//   - the few fields the SRD row gets wrong are patched by name below.
//
// Pure: rows in, rows out.

import { authoredSpells, type AuthoredSpell } from "@/lib/srd/spell-facts";
import { checklistSpell } from "@/lib/srd/spell-lists";

export type RawSpellRow = {
  slug: string;
  name: string;
  documentSlug: string;
  level: number;
  school: string;
  classes: string[];
  ritual: boolean;
  concentration: boolean;
  aliases: string[];
  data: Record<string, unknown>;
};

export const SCHOOLS = [
  "abjuration", "conjuration", "divination", "enchantment",
  "evocation", "illusion", "necromancy", "transmutation",
] as const;

// Other books' words for a school.
const SCHOOL_NAMES: Record<string, string> = {
  transformation: "transmutation",
  alteration: "transmutation",
  enchantment_charm: "enchantment",
  invocation: "evocation",
};

// Documents this engine does not play.
const EXCLUDED_DOCUMENTS = new Set(["srd-2024"]);

// Rules this engine does not play: Level Up's expertise die (a d4 added to a
// check) and its maneuver DC have no 2014 reading, so a third-party row
// written on them is not served. Where the SRD prints the same name
// (Guidance, Resistance) its row serves anyway; a name only such a row
// carries (Level Up's Friends, Ceremony) is not offered (issue #116).
const FOREIGN_MECHANICS = /\bexpertise (?:die|dice)\b|\bmaneuver dc\b/i;

function playsHere(row: RawSpellRow): boolean {
  if (documentRank(row.documentSlug) < 2) {
    return true;
  }
  const text = `${String(row.data.desc ?? "")} ${String(row.data.higher_level ?? "")}`;
  return !FOREIGN_MECHANICS.test(text);
}

export const AUTHORED_DOCUMENT = "odm-expanded";
export const SRD_DOCUMENT = "wotc-srd";

function documentRank(documentSlug: string): number {
  if (documentSlug === SRD_DOCUMENT) {
    return 0;
  }
  return documentSlug === AUTHORED_DOCUMENT ? 1 : 2;
}

// Fields an SRD row prints wrong or leaves out, by lowercased name.
const FIELD_FIXES: Record<string, Record<string, unknown>> = {
  // SRD 5.1: "V, S, M (a piece of cork)".
  "water walk": { material: "A piece of cork." },
};

const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export function normalizeSchool(school: string): string {
  const lowered = key(school).replace(/[^a-z]+/g, "_");
  if ((SCHOOLS as readonly string[]).includes(lowered)) {
    return lowered;
  }
  return SCHOOL_NAMES[lowered] ?? "evocation";
}

function authoredRow(spell: AuthoredSpell): RawSpellRow {
  return {
    slug: `odm-${key(spell.name).replace(/[^a-z0-9]+/g, "-")}`,
    name: spell.name,
    documentSlug: AUTHORED_DOCUMENT,
    level: spell.level,
    school: spell.school,
    classes: spell.classes,
    ritual: Boolean(spell.ritual),
    concentration: Boolean(spell.concentration),
    aliases: [],
    data: {
      ...(spell as unknown as Record<string, unknown>),
      level_int: spell.level,
      dnd_class: spell.classes.join(", "),
      higher_level: spell.higher_level ?? "",
      // The pack's rows name the material in a field of its own; the
      // authored file keeps it in the component line's brackets.
      material: /\(([^)]+)\)/.exec(spell.components)?.[1] ?? "",
    },
  };
}

function corrected(row: RawSpellRow): RawSpellRow {
  const listed = checklistSpell(row.name);
  const published = row.documentSlug === SRD_DOCUMENT || row.documentSlug === AUTHORED_DOCUMENT;
  const fixes = row.documentSlug === SRD_DOCUMENT ? FIELD_FIXES[key(row.name)] : undefined;
  return {
    ...row,
    school: normalizeSchool(row.school),
    // The checklist speaks for the spells it names; a third party row of a
    // name it does not carry keeps its own list.
    classes: published && listed ? listed.classes : row.classes.map((entry) => key(entry)),
    data: fixes ? { ...row.data, ...fixes } : row.data,
  };
}

// The pack's rows as this engine serves them: one row a name, corrected,
// ordered by level and then name as the pickers have always listed them.
export function servedSpellRows(packRows: RawSpellRow[]): RawSpellRow[] {
  const authored = new Map(authoredSpells().map((spell) => [key(spell.name), spell] as const));
  const best = new Map<string, RawSpellRow>();
  const offer = (row: RawSpellRow) => {
    const held = best.get(key(row.name));
    if (!held || documentRank(row.documentSlug) < documentRank(held.documentSlug)) {
      best.set(key(row.name), row);
    }
  };
  for (const row of packRows) {
    if (EXCLUDED_DOCUMENTS.has(row.documentSlug) || !playsHere(row)) {
      continue;
    }
    if (row.documentSlug === AUTHORED_DOCUMENT) {
      const fresh = authored.get(key(row.name));
      // A spell ODM has since withdrawn from its file is withdrawn here too.
      if (fresh) {
        offer({ ...authoredRow(fresh), slug: row.slug, aliases: row.aliases });
      }
      continue;
    }
    offer(row);
  }
  // Authored since the pack was built.
  for (const spell of authored.values()) {
    offer(authoredRow(spell));
  }
  // A row whose name is another published row's alias ("Melf's Acid Arrow"
  // beside "Acid Arrow") is the same spell under its book name.
  const aliasOwners = new Map<string, RawSpellRow>();
  for (const row of best.values()) {
    if (documentRank(row.documentSlug) < 2) {
      for (const alias of row.aliases) {
        aliasOwners.set(key(alias), row);
      }
    }
  }
  return [...best.values()]
    .filter((row) => {
      const owner = aliasOwners.get(key(row.name));
      return !owner || owner === row || documentRank(row.documentSlug) < 2;
    })
    .map(corrected)
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}
