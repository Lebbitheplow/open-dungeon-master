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

// A content pack feat with the same rules as one of ODM's, under another
// name (issue #147): Level Up's Attentive is Alert, its Hardy Adventurer
// is Tough. The engines read the twin as the feat they know. Only feats
// whose every benefit the engine applies is the same are listed; a near
// twin (Battle Caster's expertise die, Powerful Attacker's disadvantage)
// stays its own feat, and so does one whose name a class feature shares
// (Level Up's Skirmisher is Mobile, but the Scout ranger's feature is
// named Skirmisher and this table reads features too).
export const FEAT_TWINS: Record<string, string> = {
  attentive: "alert",
  intuitive: "observant",
  "hardy adventurer": "tough",
  "crossbow expertise": "crossbow expert",
  "power caster": "spell sniper",
  dungeoneer: "dungeon delver",
  "heavy armor expertise": "heavy armor master",
  tenacious: "resilient",
  "street fighter": "tavern brawler",
  "dual-wielding expert": "dual wielder",
  "rite master": "ritual caster",
};

// The feat the engines know a name as: its twin's, or its own, lower case.
export function featTwinOf(name: string): string {
  const own = key(name);
  return FEAT_TWINS[own] ?? own;
}

// A sheet holds a feat when it is in sheet.feats, or (for sheets written by
// the DM's tools) among its features by the same name, or holds its twin.
export function holdsFeat(
  sheet: { feats?: string[]; features?: Array<{ name: string }> },
  name: string,
): boolean {
  const wanted = key(name);
  return (
    (sheet.feats ?? []).some((feat) => featTwinOf(feat) === wanted) ||
    (sheet.features ?? []).some((feature) => featTwinOf(feature.name) === wanted)
  );
}

// The text of one of ODM's own feats, for the grants read from it
// (src/lib/srd/feat-grants.ts) where the catalog is not at hand; null for
// a content pack's feat, whose text the pack serves.
export function authoredFeatDesc(name: string): string | null {
  return featRow(name)?.desc ?? null;
}

// ---- the half-feats ----

export type FeatIncrease = { from: Ability[]; amount: 1 };

// The ability increase a feat's text opens with, in every wording the
// packs use: ODM's "Increase your Charisma by 1, to a maximum of 20" (from:
// cha), "Strength or Dexterity" (a choice of two), "one ability score"
// (any); Tome of Heroes' "Increase your Wisdom score by 1, up to a maximum
// of 20"; Level Up's "Raise your Strength attribute by 1, up to the
// attribute cap of 20", "Your Strength or Dexterity score increases by 1",
// "An ability score of your choice increases by 1" and "Choose an
// attribute and raise it by 1". Null for text that raises nothing.
export function featAbilityIncreaseFrom(desc: string | null | undefined): FeatIncrease | null {
  const text = (desc ?? "").toLowerCase().replace(/[*_]/g, "").replace(/\s+/g, " ");
  const clause = /\bchoose an? (?:attribute|ability score) and (?:raise|increase) it by 1\b|\b(?:an|one|any) (?:ability score|attribute) of your choice increases by 1\b/.test(text)
    ? "one ability score"
    : (/\b(?:increase|raise) (?:your )?([a-z ,]*?)(?: score| attribute)? by 1\b/.exec(text)?.[1] ??
      /\b(?:your )?((?:[a-z]+(?: or [a-z]+)?)) (?:score|attribute) increases by 1\b/.exec(text)?.[1] ??
      null);
  if (!clause) {
    return null;
  }
  const from = Object.entries(ABILITY_WORDS)
    .filter(([word]) => new RegExp(`\\b${word}\\b`, "i").test(clause))
    .map(([, ability]) => ability);
  if (from.length) {
    return { from, amount: 1 };
  }
  return /\b(?:ability|attribute)\b/.test(clause) ? { from: [...ABILITIES], amount: 1 } : null;
}

// The ability increase a feat opens with: ODM's feats by name, a content
// pack's from the text handed in (the catalog's, or the builder's fetch).
// Null for a feat that raises nothing, or a pack feat with no text at hand.
export function featAbilityIncrease(name: string, desc?: string | null): FeatIncrease | null {
  return featAbilityIncreaseFrom(featRow(name)?.desc ?? desc ?? "");
}

// The scores after taking a feat. `chosen` names the ability where the feat
// offers more than one; a feat with one ability needs none. A score already
// at 20 stays there (the feat's own cap). Returns an error sentence when the
// choice is missing or not one the feat offers.
export function applyFeatIncrease(
  abilities: Record<Ability, number>,
  feat: string,
  chosen?: Ability | null,
  desc?: string | null,
): { abilities: Record<Ability, number>; raised: Ability | null } | { error: string } {
  const increase = featAbilityIncrease(feat, desc);
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

// Resilient: proficiency in saving throws of the ability it raised. A pack
// feat says so in its text (Level Up's Tenacious: "become proficient with
// saving throws using the selected attribute").
export function featSaveProficiency(feat: string, raised: Ability | null, desc?: string | null): Ability | null {
  if (featTwinOf(feat) === "resilient") {
    return raised;
  }
  return /\bsaving throws? (?:using|with|of) (?:the |that )?(?:selected|chosen) (?:attribute|ability|score)\b/i.test(desc ?? "") ? raised : null;
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
