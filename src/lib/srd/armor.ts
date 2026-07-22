// SRD 5.1 armor table plus the pure AC math the whole app derives armor
// class from. Mirrors src/lib/srd/weapons.ts: a data table, fuzzy name
// matching, a proficiency test, and starting-kit helpers, with no runtime
// dependencies so scripts/test-armor.mjs can import it directly.
//
// Before this module AC was a number the player typed once and nothing ever
// changed it; buying plate did nothing. computeSheetDerived now computes it
// from what the character actually wears.

export type ArmorCategory = "light" | "medium" | "heavy" | "shield";

export type SrdArmor = {
  name: string;
  category: ArmorCategory;
  // Shields add to AC; every other category replaces the 10 base.
  baseAc: number;
  // How much DEX the armor lets through: undefined = all of it (light),
  // 2 = medium, 0 = heavy. Shields never touch DEX.
  dexCap?: number;
  // Minimum Strength score; below it the wearer's speed drops by 10.
  strengthRequirement?: number;
  stealthDisadvantage?: boolean;
};

export const SRD_ARMOR: SrdArmor[] = [
  { name: "Padded", category: "light", baseAc: 11, stealthDisadvantage: true },
  { name: "Leather", category: "light", baseAc: 11 },
  { name: "Studded Leather", category: "light", baseAc: 12 },
  { name: "Hide", category: "medium", baseAc: 12, dexCap: 2 },
  { name: "Chain Shirt", category: "medium", baseAc: 13, dexCap: 2 },
  { name: "Scale Mail", category: "medium", baseAc: 14, dexCap: 2, stealthDisadvantage: true },
  { name: "Breastplate", category: "medium", baseAc: 14, dexCap: 2 },
  { name: "Half Plate", category: "medium", baseAc: 15, dexCap: 2, stealthDisadvantage: true },
  { name: "Ring Mail", category: "heavy", baseAc: 14, dexCap: 0, stealthDisadvantage: true },
  { name: "Chain Mail", category: "heavy", baseAc: 16, dexCap: 0, strengthRequirement: 13, stealthDisadvantage: true },
  { name: "Splint", category: "heavy", baseAc: 17, dexCap: 0, strengthRequirement: 15, stealthDisadvantage: true },
  { name: "Plate", category: "heavy", baseAc: 18, dexCap: 0, strengthRequirement: 15, stealthDisadvantage: true },
  { name: "Shield", category: "shield", baseAc: 2 },
  // Setting-specific equivalents for the custom genre classes, so a
  // cyberpunk runner in a armorweave vest gets real AC instead of nothing.
  { name: "Armorweave Vest", category: "light", baseAc: 12 },
  { name: "Kevlar Vest", category: "medium", baseAc: 13, dexCap: 2 },
  { name: "Riot Plating", category: "heavy", baseAc: 17, dexCap: 0, strengthRequirement: 13, stealthDisadvantage: true },
  { name: "Brass Carapace", category: "medium", baseAc: 14, dexCap: 2 },
  { name: "Scrap Plate", category: "heavy", baseAc: 16, dexCap: 0, strengthRequirement: 13, stealthDisadvantage: true },
  { name: "Ballistic Shield", category: "shield", baseAc: 2 },
];

const byName = new Map(SRD_ARMOR.map((armor) => [normalize(armor.name), armor]));

// "+1 Plate", "Plate Armor", "Chain Mail, +2" -> a lookup key. The magic
// bonus, punctuation, and the noise word "armor" go; a trailing plural too.
function normalize(term: string) {
  return term
    .toLowerCase()
    .replace(/[+-]\d+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(armor|armour)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/s$/, "");
}

// The bonus a magic item's name declares: "+1 Longsword", "Plate +2",
// "Shield, +3". Shared with the weapon engine (attack-logic.ts) because
// both sides read the same naming convention off the same equipment list.
export function magicItemBonus(name: string): number {
  const match = /(?:^|[\s,(])\+([123])(?![0-9])/.exec(name);
  return match ? Number(match[1]) : 0;
}

// Finds the armor a free-text item name points at. The armor name must be
// the TAIL of the item name ("Dwarven Chain Mail", "+1 Plate"), never an
// arbitrary substring, so "Leather Backpack" and "Hide Rope" stay ordinary
// gear instead of silently becoming armor. Longest canonical name wins so
// "chain mail" never lands on "Chain Shirt" and "Studded Leather" beats
// "Leather".
export function matchArmor(term: string): SrdArmor | null {
  const wanted = normalize(term);
  if (!wanted) {
    return null;
  }
  const exact = byName.get(wanted);
  if (exact) {
    return exact;
  }
  const candidates = SRD_ARMOR.filter((armor) => wanted.endsWith(` ${normalize(armor.name)}`));
  candidates.sort((a, b) => b.name.length - a.name.length);
  return candidates[0] ?? null;
}

// Whether a sheet's armor-training list covers this piece. Class armor
// proficiencies are category terms ("light", "medium", "heavy", "shields",
// "shields (nonmetal)"), and heavy training implies the lighter categories
// exactly as the SRD does.
export function isArmorProficient(armorProfs: string[], armor: SrdArmor): boolean {
  const terms = armorProfs.map((entry) => entry.trim().toLowerCase());
  if (armor.category === "shield") {
    return terms.some((term) => term.includes("shield"));
  }
  const light = terms.some((term) => term.includes("light"));
  const medium = terms.some((term) => term.includes("medium"));
  const heavy = terms.some((term) => term.includes("heavy"));
  if (armor.category === "light") {
    return light || medium || heavy;
  }
  if (armor.category === "medium") {
    return medium || heavy;
  }
  return heavy;
}

// 5e lets a character attune to three magic items at once. Lives here with
// the other item rules so the sheet UI can read it without importing the
// database layer; db/sheets.ts enforces it on every write.
export const ATTUNEMENT_SLOTS = 3;

// ---- AC derivation ----

export type WornItem = { name: string; equipped?: boolean };

// An alternative base-AC formula a class feature provides while wearing no
// armor: Unarmored Defense (barbarian 10 + DEX + CON, monk 10 + DEX + WIS),
// Draconic Resilience (13 + DEX). `ability` is added on top of DEX.
export type UnarmoredFormula = {
  source: string;
  base: number;
  ability: "con" | "wis" | null;
  // Barbarian's version allows a shield; the monk's does not.
  allowsShield: boolean;
};

// The SRD unarmored-AC features, keyed by the feature names populateFeatures
// puts on sheets. Batch 2 moves this data into the feature-effects table;
// the shape here is already what that table will hand back.
const UNARMORED_FORMULAS: Array<{ match: string; classes: string[]; formula: UnarmoredFormula }> = [
  {
    match: "unarmored defense",
    classes: ["barbarian"],
    formula: { source: "Unarmored Defense", base: 10, ability: "con", allowsShield: true },
  },
  {
    match: "unarmored defense",
    classes: ["monk"],
    formula: { source: "Unarmored Defense", base: 10, ability: "wis", allowsShield: false },
  },
  {
    match: "draconic resilience",
    classes: [],
    formula: { source: "Draconic Resilience", base: 13, ability: null, allowsShield: true },
  },
];

// Which unarmored formula a character carries, if any. Unarmored Defense is
// one feature name shared by two classes with different abilities, so the
// class breaks the tie. Multiclass sheets pass their whole class list in
// acquisition order; the earliest class with a matching formula wins (RAW:
// a character only ever gained one Unarmored Defense, their first).
export function unarmoredFormulaFor(
  classId: string | string[],
  features: Array<{ name: string }>,
): UnarmoredFormula | null {
  const names = features.map((feature) => feature.name.trim().toLowerCase());
  const wantedClasses = (Array.isArray(classId) ? classId : [classId]).map((entry) =>
    entry.trim().toLowerCase(),
  );
  const candidates = UNARMORED_FORMULAS.filter((entry) =>
    names.some((name) => name === entry.match || name.startsWith(`${entry.match} `)),
  );
  for (const wanted of wantedClasses) {
    const owned = candidates.find((entry) => entry.classes.includes(wanted));
    if (owned) {
      return owned.formula;
    }
  }
  return candidates.find((entry) => entry.classes.length === 0)?.formula ?? null;
}

export type AcBreakdown = {
  ac: number;
  // Human-readable parts for the sheet UI: ["Plate 18", "Shield +2"].
  parts: string[];
  armorName: string | null;
  shieldName: string | null;
  stealthDisadvantage: boolean;
  // Heavy armor worn below its Strength requirement.
  speedPenalty: number;
  // Armor worn without the training for it: disadvantage on anything
  // physical and no spellcasting, per the SRD.
  unproficient: boolean;
};

// The character's real AC. Equipped armor sets the base (or the unarmored
// formula does), DEX applies up to the armor's cap, a shield and any flat
// bonuses stack on top.
//
// `equipped` is opt-in: an item explicitly marked equipped always counts,
// but a character who has never touched the toggle wears the best armor and
// shield they carry, so existing sheets keep working without an edit.
export function computeArmorClass(input: {
  equipment: WornItem[];
  armorProfs: string[];
  dexMod: number;
  abilityMods: { con: number; wis: number };
  strength: number;
  unarmored: UnarmoredFormula | null;
  // Flat adds from features and fighting styles (Defense +1, a ring +1).
  bonus?: number;
}): AcBreakdown {
  const anyExplicit = input.equipment.some((item) => item.equipped);
  const worn = input.equipment.filter((item) => (anyExplicit ? item.equipped : true));

  let armorItem: { item: WornItem; armor: SrdArmor } | null = null;
  let shieldItem: { item: WornItem; armor: SrdArmor } | null = null;
  for (const item of worn) {
    const armor = matchArmor(item.name);
    if (!armor) {
      continue;
    }
    if (armor.category === "shield") {
      if (!shieldItem || armor.baseAc > shieldItem.armor.baseAc) {
        shieldItem = { item, armor };
      }
      continue;
    }
    const score = armor.baseAc + Math.min(input.dexMod, armor.dexCap ?? input.dexMod);
    const bestScore = armorItem
      ? armorItem.armor.baseAc + Math.min(input.dexMod, armorItem.armor.dexCap ?? input.dexMod)
      : -Infinity;
    if (score > bestScore) {
      armorItem = { item, armor };
    }
  }

  const parts: string[] = [];
  let ac: number;
  let unproficient = false;
  let speedPenalty = 0;
  let stealthDisadvantage = false;

  if (armorItem) {
    const { armor, item } = armorItem;
    const magic = magicItemBonus(item.name);
    const dex = Math.min(input.dexMod, armor.dexCap ?? input.dexMod);
    ac = armor.baseAc + magic + dex;
    parts.push(`${item.name} ${armor.baseAc + magic}`);
    if (dex !== 0) {
      parts.push(`DEX ${dex >= 0 ? "+" : ""}${dex}`);
    }
    unproficient = !isArmorProficient(input.armorProfs, armor);
    stealthDisadvantage = Boolean(armor.stealthDisadvantage);
    if (armor.strengthRequirement && input.strength < armor.strengthRequirement) {
      speedPenalty = 10;
    }
  } else if (input.unarmored) {
    const extra = input.unarmored.ability ? input.abilityMods[input.unarmored.ability] : 0;
    ac = input.unarmored.base + input.dexMod + extra;
    parts.push(`${input.unarmored.source} ${input.unarmored.base}`);
    if (input.dexMod !== 0) {
      parts.push(`DEX ${input.dexMod >= 0 ? "+" : ""}${input.dexMod}`);
    }
    if (extra !== 0 && input.unarmored.ability) {
      parts.push(`${input.unarmored.ability.toUpperCase()} ${extra >= 0 ? "+" : ""}${extra}`);
    }
  } else {
    ac = 10 + input.dexMod;
    parts.push("Unarmored 10");
    if (input.dexMod !== 0) {
      parts.push(`DEX ${input.dexMod >= 0 ? "+" : ""}${input.dexMod}`);
    }
  }

  // The monk's Unarmored Defense is the one formula a shield switches off.
  const shieldAllowed = armorItem !== null || !input.unarmored || input.unarmored.allowsShield;
  if (shieldItem && shieldAllowed) {
    const magic = magicItemBonus(shieldItem.item.name);
    ac += shieldItem.armor.baseAc + magic;
    parts.push(`${shieldItem.item.name} +${shieldItem.armor.baseAc + magic}`);
    if (!isArmorProficient(input.armorProfs, shieldItem.armor)) {
      unproficient = true;
    }
  }

  const bonus = input.bonus ?? 0;
  if (bonus) {
    ac += bonus;
    parts.push(`bonus ${bonus >= 0 ? "+" : ""}${bonus}`);
  }

  return {
    ac: Math.max(1, Math.min(30, ac)),
    parts,
    armorName: armorItem?.item.name ?? null,
    shieldName: shieldItem && shieldAllowed ? shieldItem.item.name : null,
    stealthDisadvantage,
    speedPenalty,
    unproficient,
  };
}

// The armor a class should start the adventure wearing, from its training.
// Mirrors defaultLoadout in weapons.ts: nobody should begin in a loincloth
// because the builder never offered them a breastplate.
export function defaultArmor(armorProfs: string[]): SrdArmor[] {
  const out: SrdArmor[] = [];
  const heavy = isArmorProficient(armorProfs, get("Plate"));
  const medium = isArmorProficient(armorProfs, get("Breastplate"));
  const light = isArmorProficient(armorProfs, get("Leather"));
  if (heavy) {
    out.push(get("Chain Mail"));
  } else if (medium) {
    out.push(get("Scale Mail"));
  } else if (light) {
    out.push(get("Leather"));
  }
  if (isArmorProficient(armorProfs, get("Shield"))) {
    out.push(get("Shield"));
  }
  return out;
}

// Proficient armor worth offering as one-click adds in the builder.
export function suggestArmor(armorProfs: string[]): SrdArmor[] {
  return SRD_ARMOR.filter((armor) => isArmorProficient(armorProfs, armor));
}

function get(name: string) {
  const armor = byName.get(normalize(name));
  if (!armor) {
    throw new Error(`Unknown SRD armor: ${name}`);
  }
  return armor;
}
