// What a race grants beyond numbers the race table states outright: the
// dragonborn's ancestry, the spells some lineages cast by nature, and the
// rule for a proficiency two grants both give.
//
// Pure and database-free, like the rest of src/lib/srd, so the builder, the
// server's creation check and the counters can all read the same answer.
import racesJson from "@/lib/srd/races.json";
import classesJson from "@/lib/srd/classes.json";
import { speciesHoldsTrait, speciesRulesFor, srdRaceId, type SpeciesRules } from "@/lib/srd/race-id";
import type { Ability } from "@/lib/schemas/sheet";
import { racialCantripsOf, type RacialCantripChoices } from "@/lib/srd/racial-cantrips";
import { textKey } from "@/lib/language/text-logic";
import { checklistSpell } from "@/lib/srd/spell-lists";

// ---- Draconic Ancestry (SRD 5.1, Dragonborn) ----

export type DraconicAncestry = {
  id: string;
  dragon: string;
  damageType: string;
  area: string;
  save: "dex" | "con";
};

// The SRD's table, row for row: the dragon, the damage its breath deals and
// the dragonborn resists, and the breath's shape and saving throw.
export const DRACONIC_ANCESTRIES: DraconicAncestry[] = [
  { id: "black", dragon: "Black", damageType: "acid", area: "5 by 30 ft. line", save: "dex" },
  { id: "blue", dragon: "Blue", damageType: "lightning", area: "5 by 30 ft. line", save: "dex" },
  { id: "brass", dragon: "Brass", damageType: "fire", area: "5 by 30 ft. line", save: "dex" },
  { id: "bronze", dragon: "Bronze", damageType: "lightning", area: "5 by 30 ft. line", save: "dex" },
  { id: "copper", dragon: "Copper", damageType: "acid", area: "5 by 30 ft. line", save: "dex" },
  { id: "gold", dragon: "Gold", damageType: "fire", area: "15 ft. cone", save: "dex" },
  { id: "green", dragon: "Green", damageType: "poison", area: "15 ft. cone", save: "con" },
  { id: "red", dragon: "Red", damageType: "fire", area: "15 ft. cone", save: "dex" },
  { id: "silver", dragon: "Silver", damageType: "cold", area: "15 ft. cone", save: "con" },
  { id: "white", dragon: "White", damageType: "cold", area: "15 ft. cone", save: "con" },
];

export const DRACONIC_ANCESTRY_IDS = DRACONIC_ANCESTRIES.map((entry) => entry.id);

// An ancestry nobody chose, rolled on the table above (one d10, one row
// each), for a dragonborn the engine makes: every dragon is as likely.
export function rollDraconicAncestry(rollDie: (sides: number) => number): DraconicAncestry {
  const face = Math.max(1, Math.min(DRACONIC_ANCESTRIES.length, rollDie(DRACONIC_ANCESTRIES.length)));
  return DRACONIC_ANCESTRIES[face - 1];
}

// A stored choice read back: the id ("red"), the dragon's name ("Red") or the
// feature this module names ("Draconic Ancestry: Red (...)").
export function findDraconicAncestry(value: string | null | undefined): DraconicAncestry | null {
  const key = (value ?? "").trim().toLowerCase().replace(/^draconic ancestry:\s*/, "");
  const word = key.split(/[\s(]/)[0];
  return DRACONIC_ANCESTRIES.find((entry) => entry.id === word) ?? null;
}

// Whether this race asks for an ancestry (the bundled dragonborn under any of
// its ids).
export function takesDraconicAncestry(raceId: string, rules?: SpeciesRules | null): boolean {
  return raceRow(raceId, rules)?.ancestryChoice === "draconic";
}

// The race feature a chosen ancestry is written as. Its name carries the
// resistance in the words the damage engine reads ("resistance to fire"),
// so the sheet resists the ancestry's type wherever features are read.
export function draconicAncestryFeature(ancestry: DraconicAncestry): { name: string; source: "race" } {
  return {
    name: `Draconic Ancestry: ${ancestry.dragon} (${ancestry.damageType} breath, ${ancestry.area}, ${ancestry.save.toUpperCase()} save; resistance to ${ancestry.damageType})`,
    source: "race",
  };
}

// The ancestry a sheet holds, read from its features. Null for a dragonborn
// written before the choice existed; the breath then stays the narrated one.
export function ancestryOf(features: Array<{ name: string }>): DraconicAncestry | null {
  for (const feature of features) {
    if (/^draconic ancestry:/i.test(feature.name.trim())) {
      return findDraconicAncestry(feature.name);
    }
  }
  return null;
}

// What a breath needs to be spent: its damage, its shape and the save it
// asks for. A dragon of the table above is one; a workshop species' option
// (src/lib/content/species-variants.ts) is another, with any save.
export type BreathSpec = { damageType: string; area: string; save: Ability };

// The race feature an option's breath is written as: "Breath Weapon (fire,
// 15 ft. cone, DEX save)". The counter reads it as Breath Weapon by the name
// before its bracket note; the spend reads the note back (variantBreathOf).
export const variantBreathFeatureName = (spec: BreathSpec) =>
  `Breath Weapon (${spec.damageType}, ${spec.area}, ${spec.save.toUpperCase()} save)`;

// Only the two shapes the SRD's breaths take, so the bundled trait's own
// "Breath Weapon (2d6, DC 8 + CON mod + PB)" is never read as one.
const VARIANT_BREATH = /^breath weapon \(([a-z]+), (15 ft\. cone|5 by 30 ft\. line), (str|dex|con|int|wis|cha) save\)$/i;

// The breath an option wrote on the sheet, or null.
export function variantBreathOf(features: Array<{ name: string }>): BreathSpec | null {
  for (const feature of features) {
    const match = VARIANT_BREATH.exec(feature.name.trim());
    if (match) {
      return { damageType: match[1].toLowerCase(), area: match[2], save: match[3].toLowerCase() as Ability };
    }
  }
  return null;
}

// Breath Weapon (SRD 5.1): 2d6, 3d6 at 6th level, 4d6 at 11th, 5d6 at 16th;
// DC 8 + Constitution modifier + proficiency bonus; the save and the damage
// type are the ancestry's.
export function breathWeaponFor(
  ancestry: BreathSpec,
  level: number,
  conMod: number,
  proficiencyBonus: number,
): { dice: string; damageType: string; save: Ability; dc: number; area: string } {
  const dice = level >= 16 ? "5d6" : level >= 11 ? "4d6" : level >= 6 ? "3d6" : "2d6";
  return {
    dice,
    damageType: ancestry.damageType,
    save: ancestry.save,
    dc: 8 + conMod + proficiencyBonus,
    area: ancestry.area,
  };
}

// ---- spells a race casts by nature ----

type InnateSpellRow = { name: string; level: number; castAt?: number; per?: "long" };
type RaceRow = {
  id: string;
  ancestryChoice?: string;
  cantripChoice?: { list?: string };
  innateSpells?: { trait: string; ability: Ability; spells: InnateSpellRow[] };
};

const RACES = (racesJson as unknown as { races: RaceRow[] }).races;

// The bundled row, or for a species the bundled list does not carry, the
// rows its traits name: a workshop copy of the Tiefling holds Infernal
// Legacy and casts its spells, a copy of the Dragonborn picks an ancestry.
function raceRow(raceId: string, rules?: SpeciesRules | null): RaceRow | null {
  const wanted = srdRaceId(raceId);
  const bundled = RACES.find((entry) => entry.id === wanted);
  if (bundled) {
    return bundled;
  }
  const species = speciesRulesFor(raceId, rules);
  if (!species) {
    return null;
  }
  const innate = RACES.find((entry) => entry.innateSpells && speciesHoldsTrait(species, entry.innateSpells.trait));
  const draconic = speciesHoldsTrait(species, "draconic ancestry");
  return innate || draconic
    ? { id: raceId, ...(draconic ? { ancestryChoice: "draconic" } : {}), ...(innate ? { innateSpells: innate.innateSpells } : {}) }
    : null;
}

export type InnateSpell = {
  name: string;
  // Character level the spell arrives at.
  gainedAt: number;
  // The slot level it is cast at (0 for a cantrip).
  castAt: number;
  // A levelled innate spell is cast once, and again after a long rest.
  counterId: string | null;
};

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// Every spell the race has given by this character level: Infernal Legacy's
// thaumaturgy, then hellish rebuke (as a 2nd-level spell) at 3rd and darkness
// at 5th; Drow Magic's dancing lights, faerie fire and darkness; a forest
// gnome's minor illusion. Cantrips are known outright and cost nothing.
export function innateSpellsFor(raceId: string, level: number, rules?: SpeciesRules | null): InnateSpell[] {
  const row = raceRow(raceId, rules);
  return (row?.innateSpells?.spells ?? [])
    .filter((spell) => level >= spell.level)
    .map((spell) => {
      const cantrip = spell.level === 1 && !spell.per;
      return {
        name: spell.name,
        gainedAt: spell.level,
        castAt: cantrip ? 0 : (spell.castAt ?? 1),
        counterId: spell.per ? `racial_${slug(spell.name)}` : null,
      };
    });
}

// The ability the race's spells are cast with (Charisma for the tiefling and
// the drow, Intelligence for the forest gnome), or null.
export function innateSpellAbility(raceId: string, rules?: SpeciesRules | null): Ability | null {
  return raceRow(raceId, rules)?.innateSpells?.ability ?? null;
}

const CLASSES = (classesJson as unknown as { classes: Array<{ id: string; spellAbility: Ability | null }> }).classes;

// The ability a bundled race's chosen cantrip is cast with: its list's
// class's (SRD 5.1, High Elf, Cantrip: "You know one cantrip of your choice
// from the wizard spell list. Intelligence is your spellcasting ability for
// it."). Null for a species the bundled list does not carry: the class's
// ability answers then, as before.
export function racialCantripAbility(raceId: string): Ability | null {
  const list = RACES.find((entry) => entry.id === srdRaceId(raceId))?.cantripChoice?.list;
  return list ? (CLASSES.find((entry) => entry.id === textKey(list))?.spellAbility ?? null) : null;
}

// The ability a spell the race gives is cast with: the chosen cantrip's
// (a high elf's Intelligence) or the trait's (a tiefling's Charisma for
// Infernal Legacy), or null when the spell is not the race's or the race
// names no ability for it. The class's ability answers then, and also for a
// levelled spell the class knows too (`classHolds`): a tiefling wizard's
// darkness from a wizard slot is cast with Intelligence.
export function racialSpellAbility(
  sheet: RacialSpellSheet,
  spell: string,
  classHolds = false,
): Ability | null {
  if (!sheet.race) {
    return null;
  }
  const wanted = textKey(spell);
  const choice = RACES.find((entry) => entry.id === srdRaceId(sheet.race ?? ""))?.cantripChoice;
  const cantripAbility = racialCantripAbility(sheet.race);
  if (choice && cantripAbility) {
    const picks = racialCantripsOf(sheet.racialChoices);
    if (picks.length ? picks.some((name) => textKey(name) === wanted) : racialCantripHeld(sheet, spell, choice.list ?? "")) {
      return cantripAbility;
    }
  }
  const innate = innateSpellsFor(sheet.race, sheet.level).find((entry) => textKey(entry.name) === wanted);
  return innate && !(classHolds && innate.castAt > 0) ? innateSpellAbility(sheet.race) : null;
}

type RacialSpellSheet = {
  race?: string;
  level: number;
  racialChoices?: RacialCantripChoices;
  class?: string;
  classes?: ReadonlyArray<{ id: string }>;
  spellcasting?: { cantrips?: string[]; casters?: Array<{ cantrips?: string[] }> } | null;
};

// A sheet in play does not record which cantrip the race gave: the one it
// holds that is on the race's list and on none of its classes' lists is it
// (a high elf cleric's Fire Bolt). On a wizard it is a wizard cantrip either
// way, and the class's ability is the same.
function racialCantripHeld(sheet: RacialSpellSheet, spell: string, list: string): boolean {
  const wanted = textKey(spell);
  const casting = sheet.spellcasting;
  const held = [casting?.cantrips ?? [], ...(casting?.casters ?? []).map((entry) => entry.cantrips ?? [])].flat();
  if (!list || !held.some((name) => textKey(name) === wanted)) {
    return false;
  }
  const lists = checklistSpell(spell)?.classes ?? [];
  const classIds = [sheet.class ?? "", ...(sheet.classes ?? []).map((entry) => entry.id)].map(textKey).filter(Boolean);
  return lists.includes(textKey(list)) && !classIds.some((id) => lists.includes(id));
}

// The race's cantrips, which ride on top of any class's cantrips known.
export function innateCantripsFor(raceId: string, level: number, rules?: SpeciesRules | null): string[] {
  return innateSpellsFor(raceId, level, rules)
    .filter((spell) => spell.castAt === 0)
    .map((spell) => spell.name);
}

// The once-a-day counters, shaped like the sheet's resources map, with any
// use already spent kept (and clamped) so a regrant never refunds one.
export function innateSpellCounters(
  raceId: string,
  level: number,
  existing?: Record<string, { max: number; used: number }>,
  rules?: SpeciesRules | null,
): Record<string, { max: number; used: number }> {
  const out: Record<string, { max: number; used: number }> = {};
  for (const spell of innateSpellsFor(raceId, level, rules)) {
    if (spell.counterId) {
      out[spell.counterId] = { max: 1, used: Math.min(existing?.[spell.counterId]?.used ?? 0, 1) };
    }
  }
  return out;
}

// The once-a-day racial spells as counter rows, for the resource table: the
// trait whose feature carries them ("infernal legacy"), the level the spell
// arrives at, and the spell. A counter exists only from that level on.
export type InnateSpellCounterRow = {
  id: string;
  displayName: string;
  trait: string;
  spell: string;
  gainedAt: number;
  castAt: number;
};

export function innateSpellCounterRows(): InnateSpellCounterRow[] {
  const rows: InnateSpellCounterRow[] = [];
  for (const race of RACES) {
    for (const spell of race.innateSpells?.spells ?? []) {
      if (!spell.per) {
        continue;
      }
      const id = `racial_${slug(spell.name)}`;
      if (rows.some((row) => row.id === id && row.trait === race.innateSpells!.trait.toLowerCase())) {
        continue;
      }
      rows.push({
        id,
        displayName: `${spell.name} (${race.innateSpells!.trait})`,
        trait: race.innateSpells!.trait.toLowerCase(),
        spell: spell.name,
        gainedAt: spell.level,
        castAt: spell.castAt ?? 1,
      });
    }
  }
  return rows;
}

// ---- the same proficiency from two grants ----

// SRD 5.1, Backgrounds: a character who would gain the same proficiency from
// two sources can choose a different proficiency of the same kind instead.
// Given the fixed grants of one kind (the race's skills, the background's
// skills, the class's tools), the names given more than once: each repeat is
// one free pick of that kind owed to the player.
export function repeatedGrants(...grants: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const list of grants) {
    for (const name of new Set((list ?? []).map((entry) => entry.trim().toLowerCase()))) {
      if (!name) {
        continue;
      }
      if (seen.has(name)) {
        repeated.push(name);
      } else {
        seen.add(name);
      }
    }
  }
  return repeated;
}
