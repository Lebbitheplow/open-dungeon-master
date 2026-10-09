import { getEntryDetail, spellMechanicsFor } from "@/lib/content";
import { packRaceOptions } from "@/lib/content/race-options";
import { armorInside, magicItemBonus, matchArmor, SRD_ARMOR, type SrdArmor } from "@/lib/srd/armor";
import { checkRidersOf } from "@/lib/srd/item-check-riders";
import { itemSpellsOf } from "@/lib/srd/item-spells";
import { gearBaseName, gearDefFor } from "@/lib/srd/magic-gear";
import { matchMagicItem } from "@/lib/srd/magic-items";
import { matchWeapon, SRD_WEAPONS, type SrdWeapon } from "@/lib/srd/weapons";
import type { SpellMech } from "@/lib/srd/spell-mech-types";
import { subclassFeatureDescription, subclassLevelFor, subclassTableFor } from "@/lib/srd/features";
import { subclassLevelsFromProse, type SubclassFeatureRow } from "@/lib/srd/subclass-tables";
import { engineFeatNamed } from "@/lib/srd/feat-effects";
import { packFeatText } from "@/lib/srd/feat-text";
import { mergedBackgroundOptions, srdBackgroundOptions, srdRaceOptions, type RaceOption } from "@/lib/characters/options";
import { subclassNamesFor } from "@/lib/srd/features";
import { bundledRaceTraitText, rulebookPageIdFor } from "@/lib/rulebook/catalog-rows";
import type { RulebookPage } from "@/lib/rulebook/types";

// What the engine runs for a published row, handed to the workshop's "start
// from" pickers (src/app/workshop/homebrew/CatalogStart.tsx) beside the row
// itself, so a copy begins with the mechanics and not just the words. A
// renamed copy otherwise lost everything the engine keys by the published
// name: Web's escape check (the authored and overridden spell blocks), a
// Flame Tongue's fire and its longsword (magic-gear.ts), a Ring of
// Protection's +1 (magic-items.ts), a Wand of Fireballs' charges and spell
// (item-spells.ts), a Stone of Good Luck's +1 to checks.
//
// Asked for with ?mechanics=1 on /api/content/<kind>; the builder's own
// searches never pay for it.

type Row = { name: string; source: string; kind?: string; data: Record<string, unknown> };

export function spellMechanicsOf(row: Row): SpellMech | null {
  if (row.source === "homebrew") {
    return null;
  }
  return spellMechanicsFor({ spell: row.name })?.mech ?? null;
}

const exactWeapon = (name: string): SrdWeapon | null =>
  SRD_WEAPONS.find((weapon) => weapon.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
const exactArmor = (name: string): SrdArmor | null =>
  SRD_ARMOR.find((armor) => armor.name.toLowerCase() === name.trim().toLowerCase()) ?? null;

// The fields a homebrew item's data blob takes (src/lib/homebrew/item-data.ts)
// for a published item, or null for one the engine reads nothing from.
export function itemMechanicsOf(row: Row): Record<string, unknown> | null {
  if (row.source === "homebrew") {
    return null;
  }
  const name = row.name;
  const worn = matchMagicItem(name);
  const named = matchWeapon(name);
  const def = gearDefFor(name, undefined, named?.name ?? matchArmor(name)?.name ?? null);
  const checks = checkRidersOf(name);
  const spells = itemSpellsOf(name);
  const magic = Boolean(worn || def || checks || spells.length || row.kind === "magic_item");
  const out: Record<string, unknown> = {};
  // The mundane block a magic weapon or suit is built on, or the item itself.
  // A name that ends in a weapon or a suit swings or is worn as that one
  // ("Anointing Mace", "Animated Chain Mail"), as the engine reads it.
  const weapon = def?.base?.kind === "weapon" ? (named ?? exactWeapon(gearBaseName(def, "weapon") ?? "")) : def?.base ? null : named;
  const inside = matchArmor(name) ?? armorInside(name);
  const armor =
    def?.base?.kind === "armor"
      ? (inside ?? exactArmor(gearBaseName(def, "armor") ?? ""))
      : def?.base || weapon
        ? null
        : magic && !def?.armor
          ? matchArmor(name)
          : inside;
  out.itemKind = magic ? "magic_item" : weapon ? "weapon" : armor ? "armor" : "gear";
  if (weapon) {
    out.weapon = weapon;
  }
  if (armor) {
    out.armor = armor;
    out.weight = armor.weightLb;
  }
  if (magic) {
    out.requiresAttunement = Boolean(worn?.requiresAttunement ?? def?.requiresAttunement ?? checks?.requiresAttunement);
    out.effects = worn?.effects ?? [];
    if (worn?.attunedBy) {
      out.attunedBy = worn.attunedBy;
    }
    if (worn?.carried || checks?.carried) {
      out.carried = true;
    }
  }
  // "+1" in a name is a bonus the engine reads off the name (armor.ts
  // magicItemBonus); a renamed copy carries it as a rider instead.
  const nameBonus = magicItemBonus(name);
  const weaponRiders = { ...(def?.weapon ?? {}), ...(weapon && nameBonus > (def?.weapon?.bonus ?? 0) ? { bonus: nameBonus } : {}) };
  const armorRiders = { ...(def?.armor ?? {}), ...(armor && nameBonus > (def?.armor?.bonus ?? 0) ? { bonus: nameBonus } : {}) };
  if (Object.keys(weaponRiders).length) {
    out.weaponRiders = weaponRiders;
  }
  if (Object.keys(armorRiders).length) {
    out.armorRiders = armorRiders;
  }
  if (def?.charges) {
    out.charges = def.charges;
  }
  if (def?.cursed) {
    out.cursed = true;
  }
  if (checks && (checks.bonus || checks.skillBonus || checks.advantage)) {
    out.checks = {
      ...(checks.bonus ? { bonus: checks.bonus } : {}),
      ...(checks.skillBonus ? { skillBonus: checks.skillBonus } : {}),
      ...(checks.advantage ? { advantage: checks.advantage } : {}),
    };
  }
  if (spells.length) {
    out.spells = spells;
  }
  return out.itemKind === "gear" && !magic ? null : out;
}

// A published subclass as a workshop subclass's data: its features by level,
// each with its rules text, and its always-prepared spells. The bundled
// table's names win (they are what the engines key their effects by); the
// pack row's prose gives the words where the table has none.
export function archetypeMechanicsOf(row: Row, classId: string): Record<string, unknown> | null {
  if (row.source === "homebrew" || !classId) {
    return null;
  }
  const prose = subclassLevelsFromProse(String(row.data.desc ?? ""), subclassLevelFor(classId) ?? 3);
  const words = new Map<string, string>();
  for (const rows of Object.values(prose)) {
    for (const entry of rows) {
      words.set(entry.n.trim().toLowerCase(), entry.d);
    }
  }
  const bundled = subclassTableFor(classId, row.name);
  if (!bundled) {
    return Object.keys(prose).length ? { classSlug: classId, levels: prose } : null;
  }
  const levels: Record<string, SubclassFeatureRow[]> = {};
  for (const [level, names] of Object.entries(bundled.levels)) {
    levels[level] = names.map((name) => ({
      n: name,
      d: subclassFeatureDescription(classId, bundled.name, name) ?? words.get(name.trim().toLowerCase()) ?? "",
    }));
  }
  return { classSlug: classId, levels, ...(bundled.spells ? { spells: bundled.spells } : {}) };
}

// A trait paragraph per name, out of a race's markdown: "**_Keen Senses._**
// You have proficiency..." and "***Brave.*** You have advantage..." both.
const TRAIT_LINE = /^(?:\*\*\*|\*\*_)(.+?)(?:\*\*\*|_\*\*)\s*(.*)$/;

function traitParagraphs(markdown: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  for (const line of String(markdown ?? "").split("\n")) {
    const head = TRAIT_LINE.exec(line.trim());
    if (head) {
      current = head[1].replace(/\.$/, "").trim();
      out.set(current, head[2].trim());
    } else if (current && line.trim()) {
      out.set(current, `${out.get(current)} ${line.trim()}`.trim());
    }
  }
  return out;
}

const ABILITY_NAME: Record<string, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};

// A published race as a workshop species's data: what the builder offers
// for it, the parent race's traits and scores included for a subrace, and
// the structured grants the bundled tables give the SRD's (raceMechanics).
// `parentOf` finds the parent row (the content pack's, unless a test hands
// it the SRD fixture).
type RaceRowIn = Row & { slug?: string; documentSlug?: string };
export function raceMechanicsOf(
  row: RaceRowIn,
  parentOf: (slug: string) => RaceRowIn | null = (slug) => getEntryDetail("races", slug) as RaceRowIn | null,
): Record<string, unknown> | null {
  if (row.source === "homebrew" || !row.slug) {
    return null;
  }
  const parentSlug = String(row.data.parent_slug ?? "");
  const parent = parentSlug && parentSlug !== row.slug ? parentOf(parentSlug) : null;
  const rows = [
    { slug: row.slug, name: row.name, documentSlug: row.documentSlug ?? "wotc-srd", data: row.data },
    ...(parent ? [{ slug: parent.slug ?? parentSlug, name: parent.name, documentSlug: parent.documentSlug ?? "wotc-srd", data: parent.data }] : []),
  ];
  const option = packRaceOptions(rows, [row.slug]).find((entry) => entry.slug === row.slug);
  if (!option) {
    return null;
  }
  const paragraphs = new Map([...traitParagraphs(String(parent?.data.traits ?? "")), ...traitParagraphs(String(row.data.traits ?? ""))]);
  const traits = option.traitNames.map((name) => `**_${name}._** ${paragraphs.get(name) ?? ""}`.trim()).join("\n\n");
  return raceTableOf(option, traits, String(row.data.vision ?? parent?.data.vision ?? ""));
}

// What a species's data carries for one of the builder's race options.
function raceTableOf(option: RaceOption, traits: string, vision: string): Record<string, unknown> {
  return {
    traits,
    size: option.size ?? "Medium",
    ...(option.heavyArmorSpeed ? { heavyArmorSpeed: true } : {}),
    speed: { walk: option.speed },
    asi: Object.entries(option.asi).map(([ability, value]) => ({ attributes: [ABILITY_NAME[ability] ?? ability], value })),
    languages: option.languages,
    ...(option.bonusLanguages ? { bonusLanguages: option.bonusLanguages } : {}),
    ...(option.languageChoice ? { languageChoice: option.languageChoice } : {}),
    vision,
    ...(option.asiChoice ? { asiChoice: option.asiChoice } : {}),
    ...(option.skills ? { skills: option.skills } : {}),
    ...(option.skillChoice ? { skillChoice: option.skillChoice } : {}),
    ...(option.tools ? { tools: option.tools } : {}),
    ...(option.toolChoice ? { toolChoice: option.toolChoice } : {}),
    ...(option.armor ? { armor: option.armor } : {}),
    ...(option.weapons ? { weapons: option.weapons } : {}),
    ...(option.cantripChoice ? { cantripChoice: option.cantripChoice } : {}),
  };
}

// A published background as the workshop copies it: the option the builder
// offers for it (the bundled table's for an SRD background, the pack's
// parsed prose otherwise) as structured grants, with its feature.
export function backgroundMechanicsOf(row: Row & { slug?: string; documentSlug?: string }): Record<string, unknown> | null {
  if (row.source === "homebrew" || !row.slug) {
    return null;
  }
  const options = mergedBackgroundOptions([
    { slug: row.slug, name: row.name, source: row.source, documentSlug: row.documentSlug ?? "", data: row.data },
  ]);
  const id = row.slug.toLowerCase().replace(/-/g, "_");
  const option = options.find((entry) => entry.id === row.slug) ?? options.find((entry) => entry.id === id);
  if (!option) {
    return null;
  }
  return {
    grants: {
      skills: option.skills,
      ...(option.skillChoice ? { skillChoice: option.skillChoice } : {}),
      tools: option.tools ?? [],
      languages: option.languages ?? 0,
      knownLanguages: option.knownLanguages ?? [],
      equipment: option.equipment ?? [],
      purse: option.purse ?? 0,
    },
    feature: option.feature ?? String(row.data.feature ?? ""),
    feature_desc: option.featureDesc ?? String(row.data.feature_desc ?? ""),
  };
}

// The bundled backgrounds no content row carries, as catalog rows with
// their grants, for "start from": those whose name holds `q`, less any a
// row in `results` already stands for.
export function bundledBackgroundRows(q: string, results: Array<{ slug: string }>): Array<Record<string, unknown>> {
  const wanted = q.trim().toLowerCase();
  const held = new Set(results.map((row) => row.slug.toLowerCase().replace(/-/g, "_")));
  return srdBackgroundOptions()
    .filter((option) => !held.has(option.id) && (!wanted || option.name.toLowerCase().includes(wanted)))
    .slice(0, 120)
    .map((option) => ({
      slug: option.id,
      name: option.name,
      source: "bundled",
      documentSlug: "odm",
      document: "Open Dungeon Master",
      data: { desc: option.blurb ?? "", feature: option.feature ?? "", feature_desc: option.featureDesc ?? "" },
      table: {
        grants: {
          skills: option.skills,
          ...(option.skillChoice ? { skillChoice: option.skillChoice } : {}),
          tools: option.tools ?? [],
          languages: option.languages ?? 0,
          knownLanguages: option.knownLanguages ?? [],
          equipment: option.equipment ?? [],
          purse: option.purse ?? 0,
        },
        feature: option.feature ?? "",
        feature_desc: option.featureDesc ?? "",
      },
    }));
}

// With no content pack the builder's own races and subclasses are what a
// server has; these hand them to "start from" as rows with their grants
// (`table`), less any a row in `results` already stands for.
export function bundledRaceRows(q: string, results: Array<{ name: string }>): Array<Record<string, unknown>> {
  // Every word, in any order: "hill dwarf" finds the builder's "Dwarf (Hill)".
  const words = q.trim().toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
  const held = new Set(results.map((row) => row.name.trim().toLowerCase()));
  return srdRaceOptions()
    .filter((option) => !held.has(option.name.toLowerCase()) && words.every((word) => option.name.toLowerCase().includes(word)))
    .map((option) => {
      // The traits in the bundled book's words where it prints them.
      const words = bundledRaceTraitText(option.name);
      const traits = option.traitNames
        .map((name) => `**_${name}._** ${words.get(name) ?? words.get(name.replace(/\s*\(.*\)$/, "")) ?? ""}`.trim())
        .join("\n\n");
      return {
        slug: option.id,
        name: option.name,
        source: "bundled",
        documentSlug: "wotc-srd",
        document: "SRD 5.1 (bundled)",
        data: { desc: option.note ?? "", traits },
        table: raceTableOf(option, traits, ""),
      };
    });
}

export function bundledArchetypeRows(classSlug: string, q: string, results: Array<{ name: string }>): Array<Record<string, unknown>> {
  const classId = classSlug.trim().toLowerCase();
  const wanted = q.trim().toLowerCase();
  const held = new Set(results.map((row) => row.name.trim().toLowerCase()));
  return subclassNamesFor(classId)
    .filter((name) => !held.has(name.toLowerCase()) && (!wanted || name.toLowerCase().includes(wanted)))
    .map((name) => {
      const row = { name, source: "bundled", data: { desc: "" } };
      return {
        slug: `${classId}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        ...row,
        documentSlug: "wotc-srd",
        document: "SRD 5.1 (bundled)",
        table: archetypeMechanicsOf(row, classId) ?? { classSlug: classId, levels: {} },
      };
    });
}

// A published feat as the workshop copies it: its whole text, wherever the
// pack keeps it (a Level Up feat's benefits list, not only its summary),
// and the feat the engines run it as, so a renamed copy of Sharpshooter
// still ignores long range at the table.
export function featMechanicsOf(row: Row): Record<string, unknown> | null {
  if (row.source === "homebrew") {
    return null;
  }
  const text = packFeatText(row.data);
  const runsAs = engineFeatNamed(row.name);
  return { desc: text.desc, prerequisite: text.prerequisite, ...(runsAs ? { runsAs } : {}) };
}

// The kinds of catalog row the bundled book prints a page for.
const BOOK_KIND: Record<string, RulebookPage["kind"]> = { spells: "spell", items: "item", races: "race", monsters: "monster" };

// A published SRD row carries the book page it is printed on, so a copy
// started from it keeps its page (draft.ts copiedFromOf) and the editor can
// open the book there. Another book's entry of the same name is its own
// entry, and gets no SRD page.
function withPage(kind: string, row: unknown): unknown {
  const bookKind = BOOK_KIND[kind];
  const entry = row as Row & { documentSlug?: string; rulebook?: string };
  if (!bookKind || entry.source === "homebrew" || entry.rulebook || (entry.documentSlug && entry.documentSlug !== "wotc-srd")) return row;
  const page = rulebookPageIdFor(bookKind, entry.name);
  return page ? { ...entry, rulebook: page } : row;
}

export function withMechanics(kind: string, results: unknown[], params: { classSlug?: string } = {}): unknown[] {
  return withMechanicsOnly(kind, results, params).map((row) => withPage(kind, row));
}

function withMechanicsOnly(kind: string, results: unknown[], params: { classSlug?: string }): unknown[] {
  if (kind === "backgrounds") {
    return results.map((row) => {
      const table = backgroundMechanicsOf(row as Row & { slug?: string; documentSlug?: string });
      return table ? { ...(row as Row), table } : row;
    });
  }
  if (kind === "feats") {
    return results.map((row) => {
      const table = featMechanicsOf(row as Row);
      return table ? { ...(row as Row), table } : row;
    });
  }
  if (kind === "races") {
    return results.map((row) => {
      const table = raceMechanicsOf(row as Row & { slug?: string; documentSlug?: string });
      return table ? { ...(row as Row), table } : row;
    });
  }
  if (kind === "archetypes") {
    return results.map((row) => {
      const table = archetypeMechanicsOf(row as Row, String(params.classSlug ?? "").toLowerCase());
      return table ? { ...(row as Row), table } : row;
    });
  }
  if (kind === "spells") {
    return results.map((row) => {
      const mech = spellMechanicsOf(row as Row);
      return mech ? { ...(row as Row), mech } : row;
    });
  }
  if (kind === "items") {
    return results.map((row) => {
      const gear = itemMechanicsOf(row as Row);
      return gear ? { ...(row as Row), gear } : row;
    });
  }
  return results;
}
