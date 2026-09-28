// What a feat changes on the sheet's numbers, read from ODM's feat catalog
// (src/lib/srd/authored-feats.json) and from sheet.feats.
//
// A feat taken in the builder or at a level-up is written to sheet.feats by
// name, and the engines that read features alone never saw it: an elf with
// Elven Accuracy rolled two dice, Actor left Charisma where it was, Tough
// added nothing. The numbers live here, pure, so the level-up route, the hit
// point rule and the speed rule each read the same answer.
import authoredFeatsJson from "@/lib/srd/authored-feats.json";
import type { Ability } from "@/lib/schemas/sheet";

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_WORDS: Record<string, Ability> = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
};

type AuthoredFeat = { name: string; prerequisite?: string; desc: string };
const FEATS = (authoredFeatsJson as { feats: AuthoredFeat[] }).feats;

const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

function featRow(name: string): AuthoredFeat | null {
  const wanted = key(name);
  return FEATS.find((feat) => key(feat.name) === wanted) ?? null;
}

// A sheet holds a feat when it is in sheet.feats, or (for sheets written by
// the DM's tools) among its features by the same name.
export function holdsFeat(
  sheet: { feats?: string[]; features?: Array<{ name: string }> },
  name: string,
): boolean {
  const wanted = key(name);
  return (
    (sheet.feats ?? []).some((feat) => key(feat) === wanted) ||
    (sheet.features ?? []).some((feature) => key(feature.name) === wanted)
  );
}

// ---- the half-feats ----

export type FeatIncrease = { from: Ability[]; amount: 1 };

// The ability increase a feat opens with: "Increase your Charisma by 1, to a
// maximum of 20" (from: cha), "Strength or Dexterity" (a choice of two), "one
// ability score" (any). Null for a feat that raises nothing.
export function featAbilityIncrease(name: string): FeatIncrease | null {
  const row = featRow(name);
  const clause = row ? /increase ([^.]*?) by 1, to a maximum of 20/i.exec(row.desc)?.[1] : null;
  if (!clause) {
    return null;
  }
  if (/one ability score/i.test(clause)) {
    return { from: [...ABILITIES], amount: 1 };
  }
  const from = Object.entries(ABILITY_WORDS)
    .filter(([word]) => new RegExp(`\\b${word}\\b`, "i").test(clause))
    .map(([, ability]) => ability);
  return from.length ? { from, amount: 1 } : null;
}

// The scores after taking a feat. `chosen` names the ability where the feat
// offers more than one; a feat with one ability needs none. A score already
// at 20 stays there (the feat's own cap). Returns an error sentence when the
// choice is missing or not one the feat offers.
export function applyFeatIncrease(
  abilities: Record<Ability, number>,
  feat: string,
  chosen?: Ability | null,
): { abilities: Record<Ability, number>; raised: Ability | null } | { error: string } {
  const increase = featAbilityIncrease(feat);
  if (!increase) {
    return { abilities, raised: null };
  }
  const ability = increase.from.length === 1 ? increase.from[0] : chosen ?? null;
  if (!ability || !increase.from.includes(ability)) {
    return {
      error: `${featRow(feat)?.name ?? feat} raises one of ${increase.from.map((entry) => entry.toUpperCase()).join(", ")} by 1; choose which.`,
    };
  }
  return {
    abilities: { ...abilities, [ability]: Math.min(20, abilities[ability] + increase.amount) },
    raised: ability,
  };
}

// Resilient: proficiency in saving throws of the ability it raised.
export function featSaveProficiency(feat: string, raised: Ability | null): Ability | null {
  return key(feat) === "resilient" ? raised : null;
}

// ---- numbers read from sheet.feats ----

// Tough: the hit point maximum rises by twice the character level.
export function featHitPointBonus(sheet: { feats?: string[]; features?: Array<{ name: string }> }, level: number): number {
  return holdsFeat(sheet, "Tough") ? 2 * Math.max(1, Math.min(20, level)) : 0;
}

// Mobile: +10 feet of walking speed.
export function featSpeedBonus(sheet: { feats?: string[]; features?: Array<{ name: string }> }): number {
  return holdsFeat(sheet, "Mobile") ? 10 : 0;
}

// War Caster: advantage on the Constitution save to keep concentration.
export function hasWarCaster(sheet: { feats?: string[]; features?: Array<{ name: string }> }): boolean {
  return holdsFeat(sheet, "War Caster");
}

// Heavy Armor Master: while wearing heavy armor, bludgeoning, piercing and
// slashing damage from nonmagical attacks is reduced by 3.
export function heavyArmorMasterReduction(
  sheet: { feats?: string[]; features?: Array<{ name: string }> },
  input: { wearingHeavyArmor: boolean; damageType: string; magical: boolean },
): number {
  if (!holdsFeat(sheet, "Heavy Armor Master") || !input.wearingHeavyArmor || input.magical) {
    return 0;
  }
  return ["bludgeoning", "piercing", "slashing"].includes(input.damageType.trim().toLowerCase()) ? 3 : 0;
}
