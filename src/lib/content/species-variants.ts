import { ABILITIES, type Ability } from "@/lib/schemas/abilities";
import { ALL_SKILLS } from "@/lib/content/mechanics";
import { DAMAGE_TYPES } from "@/lib/dm/damage-logic";
import { textKey } from "@/lib/language/text-logic";
import { variantBreathFeatureName } from "@/lib/srd/racial-grants";

// A species whose player picks one of several packages: a Half-Dragon's
// ancestry, an elf's lineage, a sorcerous bloodline (issue #538). Each option
// gives only grants the engines already run (scores, skills, tools,
// languages, damage resistances and a breath weapon), plus words the player
// reads. The pick is kept on the sheet as racialChoices.variant, the
// option's id.
//
// The engines read features and the race row, never the pick itself. So the
// options' scores, skills, tools and languages are folded into the race
// before any rule runs (withSpeciesVariant), and their resistances and
// breath are written as race features in the formats the table already
// reads (variantFeatureNames). A sheet is judged from the race again on every
// save, so an option given up leaves nothing behind.
//
// Pure: the builder, the species editor, the normalizer and the server's
// creation check all read the same answer.

export type BreathShape = "cone" | "line";
export type SpeciesBreath = { damageType: string; save: Ability; shape: BreathShape };

export type SpeciesVariantOption = {
  // Fixed when the option is made, so a rename keeps every sheet's pick.
  id: string;
  name: string;
  description?: string;
  asi?: Partial<Record<Ability, number>>;
  resistances?: string[];
  skills?: string[];
  tools?: string[];
  languages?: string[];
  breath?: SpeciesBreath;
};

export type SpeciesVariantGroup = { label: string; options: SpeciesVariantOption[] };

// What a choice holds. Every name the table writes from it stays inside the
// 80 letters a sheet keeps of a feature's name (src/lib/schemas/sheet.ts):
// "Label (Name)" is 73 at most.
export const VARIANT_LIMITS = {
  minOptions: 2,
  options: 16,
  label: 30,
  name: 40,
  id: 40,
  description: 1_000,
  asiTotal: 3,
  resistances: 3,
  skills: 2,
  tools: 2,
  languages: 2,
  tool: 60,
  language: 40,
} as const;

// The two shapes the SRD's breaths take (the Dragonborn's table).
export const BREATH_AREAS: Record<BreathShape, string> = { cone: "15 ft. cone", line: "5 by 30 ft. line" };
const SHAPES = Object.keys(BREATH_AREAS) as BreathShape[];

const ABILITY_WORDS: Record<Ability, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};

type Raw = Record<string, unknown>;
const L = VARIANT_LIMITS;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// The table reads these in a feature's name: a bracket note or a "Family:"
// prefix as the choice made, "resistance" as damage resisted, "breath
// weapon" as the breath's counter (src/lib/dm/pc-defenses.ts,
// src/lib/srd/feature-names.ts).
const RESERVED = /[():]|\bresistance\b|\bbreath weapon\b/i;
const RESERVED_WORDS = `brackets, a colon, "resistance" or "breath weapon": the table reads those words`;

const quoted = (name: string) => `"${name.length > 40 ? `${name.slice(0, 40)}...` : name}"`;
const listed = (items: string[], last = "and") =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} ${last} ${items[items.length - 1]}` : (items[0] ?? "");
const count = (value: number) => value.toLocaleString("en-US");

// A list the option sends, each entry trimmed, a repeat folded. Not a list,
// or an entry that is not text, is refused rather than read as empty.
function textList(value: unknown, what: string, where: string): { list: string[] } | { error: string } {
  if (value == null) {
    return { list: [] };
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return { error: `${where}: its ${what} are a list of names.` };
  }
  const seen = new Set<string>();
  const list: string[] = [];
  for (const entry of value as string[]) {
    const trimmed = entry.trim();
    if (trimmed && !seen.has(textKey(trimmed))) {
      seen.add(textKey(trimmed));
      list.push(trimmed);
    }
  }
  return { list };
}

// An id from a name, once, when the option is made: "Fire Opal" is
// "fire-opal", and the next "Fire Opal" "fire-opal-2".
export function uniqueVariantId(name: string, taken: Iterable<string>): string {
  const held = new Set(taken);
  const slug = textKey(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, L.id).replace(/-+$/, "") || "option";
  let id = slug;
  for (let next = 2; held.has(id); next += 1) {
    const suffix = `-${next}`;
    id = `${slug.slice(0, L.id - suffix.length).replace(/-+$/, "")}${suffix}`;
  }
  return id;
}

// `ids`: the ids options before this one hold; `asked`: every id the rows
// send, which an option made without one steers clear of.
function checkOption(
  row: Raw,
  index: number,
  ids: Set<string>,
  asked: Set<string>,
  names: Set<string>,
): { option: SpeciesVariantOption } | { error: string } {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) {
    return { error: `Option ${index + 1} of the player's choice needs a name.` };
  }
  const where = quoted(name);
  if (name.length > L.name) {
    return { error: `${where} is a name of ${name.length} characters; an option's name holds ${L.name}.` };
  }
  if (RESERVED.test(name)) {
    return { error: `${where}: an option's name cannot hold ${RESERVED_WORDS}.` };
  }
  if (names.has(textKey(name))) {
    return { error: `Two options are called ${where}; give each its own name.` };
  }
  const sent = typeof row.id === "string" ? row.id.trim() : "";
  if (sent && (sent.length > L.id || !ID.test(sent))) {
    return { error: `${where}: its id "${sent}" is not lower-case letters and numbers joined by dashes, ${L.id} at most.` };
  }
  if (sent && ids.has(sent)) {
    return { error: `Two options share the id "${sent}"; each option keeps its own.` };
  }
  const id = sent || uniqueVariantId(name, [...ids, ...asked]);
  const option: SpeciesVariantOption = { id, name };

  if (row.description != null && typeof row.description !== "string") {
    return { error: `${where}: its words are text.` };
  }
  const description = typeof row.description === "string" ? row.description.trim() : "";
  if (description.length > L.description) {
    return { error: `${where}'s words run to ${count(description.length)} characters; an option's words hold ${count(L.description)}.` };
  }
  if (description) option.description = description;

  // The scores: +1 or +2 to an ability, +3 in all at most (an SRD race's).
  if (row.asi != null && (typeof row.asi !== "object" || Array.isArray(row.asi))) {
    return { error: `${where}: its increases are a map of ability to +1 or +2.` };
  }
  const asi: Partial<Record<Ability, number>> = {};
  let total = 0;
  for (const [key, value] of Object.entries((row.asi ?? {}) as Raw)) {
    if (!(ABILITIES as readonly string[]).includes(key) || (value !== 1 && value !== 2)) {
      return { error: `${where}: an increase is +1 or +2 to str, dex, con, int, wis or cha.` };
    }
    asi[key as Ability] = value;
    total += value;
  }
  if (total > L.asiTotal) {
    return { error: `${where} raises scores by +${total} in all; an option gives at most +${L.asiTotal}.` };
  }
  if (total) option.asi = asi;

  const resistances = textList(row.resistances, "resistances", where);
  if ("error" in resistances) return resistances;
  const unknownType = resistances.list.find((type) => !DAMAGE_TYPES.includes(type.toLowerCase()));
  if (unknownType) {
    return { error: `${where}: "${unknownType}" is not a damage type the table knows; pick from ${listed(DAMAGE_TYPES, "or")}.` };
  }
  if (resistances.list.length > L.resistances) {
    return { error: `${where} resists ${resistances.list.length} damage types; an option resists ${L.resistances} at most.` };
  }
  if (resistances.list.length) option.resistances = resistances.list.map((type) => type.toLowerCase());

  // Skills as the sheet keeps them ("sleight_of_hand").
  const skills = textList(row.skills, "skills", where);
  if ("error" in skills) return skills;
  const skillIds = skills.list.map((skill) => skill.toLowerCase().replace(/\s+/g, "_"));
  const unknownSkill = skillIds.find((skill) => !(ALL_SKILLS as readonly string[]).includes(skill));
  if (unknownSkill) {
    return { error: `${where}: "${unknownSkill}" is not a skill.` };
  }
  if (skillIds.length > L.skills) {
    return { error: `${where} grants ${skillIds.length} skills; an option grants ${L.skills} at most.` };
  }
  if (skillIds.length) option.skills = skillIds;

  for (const [field, most, longest, noun] of [
    ["tools", L.tools, L.tool, "tool"],
    ["languages", L.languages, L.language, "language"],
  ] as const) {
    const read = textList(row[field], field, where);
    if ("error" in read) return read;
    if (read.list.length > most) {
      return { error: `${where} grants ${read.list.length} ${field}; an option grants ${most} at most.` };
    }
    const long = read.list.find((entry) => entry.length > longest);
    if (long) {
      return { error: `${where}: the ${noun} ${quoted(long)} is a name of ${long.length} characters; a ${noun}'s name holds ${longest}.` };
    }
    if (read.list.length) option[field] = read.list;
  }

  if (row.breath != null) {
    const breath = (typeof row.breath === "object" && !Array.isArray(row.breath) ? row.breath : {}) as Raw;
    const damageType = typeof breath.damageType === "string" ? breath.damageType.trim().toLowerCase() : "";
    if (!DAMAGE_TYPES.includes(damageType)) {
      return { error: `${where}'s breath weapon deals one damage type the table knows: ${listed(DAMAGE_TYPES, "or")}.` };
    }
    if (!(ABILITIES as readonly unknown[]).includes(breath.save)) {
      return { error: `${where}'s breath weapon asks for a save of str, dex, con, int, wis or cha.` };
    }
    if (!(SHAPES as readonly unknown[]).includes(breath.shape)) {
      return { error: `${where}'s breath weapon is a cone (${BREATH_AREAS.cone}) or a line (${BREATH_AREAS.line}).` };
    }
    option.breath = { damageType, save: breath.save as Ability, shape: breath.shape as BreathShape };
  }

  ids.add(id);
  names.add(textKey(name));
  return { option };
}

// The choice a species offers, checked whole: every limit is refused by
// name, never cut to fit, since the save is someone's own writing. Null when
// the species offers none.
export function checkSpeciesVariants(raw: unknown): { group: SpeciesVariantGroup | null } | { error: string } {
  if (raw == null) {
    return { group: null };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "The player's choice is a label and a list of options." };
  }
  const source = raw as Raw;
  const label = typeof source.label === "string" ? source.label.trim() : "";
  const rows = Array.isArray(source.options) ? source.options : [];
  if (!label) {
    return { error: "The player's choice needs a label, such as Draconic ancestry or Bloodline." };
  }
  if (label.length > L.label) {
    return { error: `The choice's label is ${label.length} characters; it holds ${L.label}.` };
  }
  if (RESERVED.test(label)) {
    return { error: `The choice's label cannot hold ${RESERVED_WORDS}.` };
  }
  if (rows.length < L.minOptions || rows.length > L.options) {
    return { error: `A choice holds ${L.minOptions} to ${L.options} options; this one has ${rows.length}.` };
  }
  // The ids the rows send are kept; one made here for a row that sends none
  // never lands on any of them.
  const asked = new Set(
    rows.map((row) => (row && typeof (row as Raw).id === "string" ? String((row as Raw).id).trim() : "")).filter(Boolean),
  );
  const ids = new Set<string>();
  const names = new Set<string>();
  const options: SpeciesVariantOption[] = [];
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { error: `Option ${index + 1} of the player's choice is not an option.` };
    }
    const checked = checkOption(row as Raw, index, ids, asked, names);
    if ("error" in checked) {
      return checked;
    }
    options.push(checked.option);
  }
  return { group: { label, options } };
}

// A stored choice read back: the group, or undefined when there is none or
// it no longer holds together (it was checked when it was saved).
export function readSpeciesVariants(raw: unknown): SpeciesVariantGroup | undefined {
  const checked = checkSpeciesVariants(raw);
  return "error" in checked ? undefined : (checked.group ?? undefined);
}

// ---- the race with its option ----

type VariantRace = {
  asi: Partial<Record<Ability, number>>;
  skills?: string[];
  tools?: string[];
  languages: string[];
  variants?: SpeciesVariantGroup;
};
type WithVariant<T> = T & { variantOf?: T; variantPicked?: SpeciesVariantOption };

function sumAsi(base: Partial<Record<Ability, number>>, extra: Partial<Record<Ability, number>> | undefined) {
  const out: Partial<Record<Ability, number>> = { ...base };
  for (const [ability, value] of Object.entries(extra ?? {})) {
    out[ability as Ability] = (out[ability as Ability] ?? 0) + (value ?? 0);
  }
  return out;
}

function union(base: string[] | undefined, extra: string[] | undefined): string[] | undefined {
  if (!extra?.length) {
    return base;
  }
  const out = [...(base ?? [])];
  for (const entry of extra) {
    if (!out.some((held) => textKey(held) === textKey(entry))) {
      out.push(entry);
    }
  }
  return out;
}

// The race as the rules read it once the option is picked: its scores,
// skills, tools and languages with the option's added. It starts from the
// race without any option every time, so a second pick replaces the first
// and the same pick twice is the race once. An id the race does not offer
// (none yet, or an option since removed) is the race alone.
export function withSpeciesVariant<T extends VariantRace>(race: T, id: string | null | undefined): T {
  const base = (race as WithVariant<T>).variantOf ?? race;
  const option = base.variants?.options.find((entry) => entry.id === (id ?? "").trim());
  if (!option) {
    return base;
  }
  return {
    ...base,
    asi: sumAsi(base.asi, option.asi),
    skills: union(base.skills, option.skills),
    tools: union(base.tools, option.tools),
    languages: union(base.languages, option.languages) ?? [],
    variantOf: base,
    variantPicked: option,
  };
}

// The option a race read through withSpeciesVariant holds, or null.
export function pickedVariant(race: object | null | undefined): SpeciesVariantOption | null {
  return (race as WithVariant<object> | null | undefined)?.variantPicked ?? null;
}

// ---- what the sheet carries ----

const capital = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

// The race features an option is written as: its record, "Draconic ancestry
// (Ashen)"; a "Fire Resistance" per type, which the damage engine reads by
// name (the option's own name is left out of it, since that reader takes
// every type word in the name, and "Fire Opal" would resist fire); and its
// breath. A name the species' own traits already hold is not written twice.
export function variantFeatureNames(label: string, option: SpeciesVariantOption, speciesTraitNames: readonly string[] = []): string[] {
  const held = new Set(speciesTraitNames.map(textKey));
  const names = [
    `${label} (${option.name})`,
    ...(option.resistances ?? []).map((type) => `${capital(type)} Resistance`),
    ...(option.breath
      ? [variantBreathFeatureName({ damageType: option.breath.damageType, area: BREATH_AREAS[option.breath.shape], save: option.breath.save })]
      : []),
  ];
  const out: string[] = [];
  for (const name of names) {
    if (!held.has(textKey(name))) {
      held.add(textKey(name));
      out.push(name);
    }
  }
  return out;
}

const skillName = (id: string) =>
  id
    .split("_")
    .map((word, index) => (index && word === "of" ? word : capital(word)))
    .join(" ");

// What an option gives, in one plain line, for the builder, the editor and
// the tests: "+1 Constitution; resists fire damage; breath weapon: fire,
// 15 ft. cone, Dexterity save". With `baseAsi`, the scores are the species'
// own and the option's together.
export function variantSummary(option: SpeciesVariantOption, baseAsi?: Partial<Record<Ability, number>>): string {
  const asi = baseAsi ? sumAsi(baseAsi, option.asi) : (option.asi ?? {});
  const parts: string[] = [];
  const raised = ABILITIES.filter((ability) => asi[ability]).map((ability) => `+${asi[ability]} ${ABILITY_WORDS[ability]}`);
  if (raised.length) parts.push(raised.join(", "));
  if (option.resistances?.length) parts.push(`resists ${listed(option.resistances)} damage`);
  if (option.breath) {
    parts.push(`breath weapon: ${option.breath.damageType}, ${BREATH_AREAS[option.breath.shape]}, ${ABILITY_WORDS[option.breath.save]} save`);
  }
  if (option.skills?.length) parts.push(`proficient in ${listed(option.skills.map(skillName))}`);
  if (option.tools?.length) parts.push(`proficient with ${listed(option.tools)}`);
  if (option.languages?.length) parts.push(`speaks ${listed(option.languages)}`);
  return parts.length ? parts.join("; ") : "nothing beyond its words";
}

// The same, short enough for a pick list: "+1 CON, fire, fire breath".
export function variantShort(option: SpeciesVariantOption): string {
  const asi = option.asi ?? {};
  const parts = [
    ...ABILITIES.filter((ability) => asi[ability]).map((ability) => `+${asi[ability]} ${ability.toUpperCase()}`),
    ...(option.resistances ?? []),
    ...(option.breath ? [`${option.breath.damageType} breath`] : []),
    ...(option.skills ?? []).map(skillName),
    ...(option.tools ?? []),
    ...(option.languages ?? []),
  ];
  return parts.join(", ") || "its words only";
}
