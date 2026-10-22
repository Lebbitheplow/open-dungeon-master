import { gearDefFor, gearDefOfRow, gearRidersActive } from "@/lib/srd/magic-gear";
import { isDwarf, speciesRulesFor, type SpeciesRules } from "@/lib/srd/race-id";
import { textKey } from "@/lib/language/text-logic";
import { pluralForms } from "@/lib/srd/name-forms";
import { magicItemBonus, rowName, withoutBonus, type RowItem } from "@/lib/srd/item-row";
import { armorSpellings as around, SRD_ARMOR, type SrdArmor } from "@/lib/srd/armor-table";
import { packBaseOf } from "@/lib/srd/pack-bases";
import { holdsFeature } from "@/lib/srd/feature-names";

// SRD 5.1 armor table (armor-table.ts) plus the pure AC math the whole app
// derives armor class from. Mirrors src/lib/srd/weapons.ts: whole-name
// matching, a proficiency test, and starting-kit helpers. Its one dependency
// is the generated magic item table (src/lib/srd/magic-gear.ts), which says
// what suit a magic armor is.
//
// Before this module AC was a number the player typed once and nothing ever
// changed it; buying plate did nothing. computeSheetDerived now computes it
// from what the character actually wears.

export { SRD_ARMOR, type ArmorCategory, type SrdArmor } from "@/lib/srd/armor-table";

// "+1 Plate", "Chain Mail, +2" -> a lookup key: the magic bonus is notation,
// not part of the name, and goes (src/lib/srd/item-row.ts withoutBonus).
function armorKey(term: string) {
  return textKey(withoutBonus(term));
}

// Other whole names ODM's own lists give an armour: the SRD starts a druid
// with a "wooden shield" (src/lib/srd/starting-kit-data.ts).
const ARMOR_ALIASES: Record<string, string[]> = { Shield: ["Wooden Shield"] };

// The English ways an armour's row is written, onto the row: its name and
// its aliases, with "armor"/"armour" before or after them ("Plate
// Armor"), and the plurals of those ("Shields"). Every spelling to its
// armour; a name as the table writes it before any plural, so no plural
// shadows another armour's name.
const byName = new Map<string, SrdArmor>();
for (const pass of [(key: string) => [key], pluralForms]) {
  for (const armor of SRD_ARMOR) {
    for (const form of [armor.name, ...(ARMOR_ALIASES[armor.name] ?? [])].flatMap((name) => pass(armorKey(name))).flatMap(around)) {
      if (!byName.has(form)) {
        byName.set(form, armor);
      }
    }
  }
}

// The armor a written name is: its whole name or plural, with or without
// "armor", a "+1" aside. A name that ends in an armor's among other words is
// none: "Dinner plate" is no Plate, a Guild Engineer's "work leathers" no
// Leather (issue #113), and a magic suit names its row in srdName.
export function armorNamed(term: string): SrdArmor | null {
  return byName.get(armorKey(term)) ?? null;
}

// The armor a carried item's row is by name (src/lib/srd/item-row.ts), or
// the one a pack row of another document is built on (pack-bases.ts).
export function rowArmor(item: RowItem): SrdArmor | null {
  return armorNamed(rowName(item)) ?? armorNamed(packBaseOf(item) ?? "");
}

// The armor a carried item is: its row's, else the suit or shield its magic
// row is built on (src/lib/srd/magic-gear.ts): Dwarven Plate is plate.
export function matchArmor(item: RowItem): SrdArmor | null {
  const base = gearDefFor(item)?.base;
  return rowArmor(item) ?? (base?.kind === "armor" ? armorNamed(base.name) : null);
}

// A worn row as the armor engine reads it: the suit (or shield) it is, the
// magic bonus it carries, and whether it is worn as if trained. A magic
// armor is its base armor with what its entry changes (src/lib/srd/
// magic-gear.ts): Armor of Invulnerability is plate, Elven Chain a chain
// shirt +1 anyone may wear, mithral drops the Strength requirement and the
// Stealth disadvantage. A composite name the table knows ("Mithral Half
// Plate") is built on the suit it names. The bonus and the other riders of an
// item that asks for attunement count only while attuned; the suit itself is
// armor either way.
export type WornArmor = { armor: SrdArmor; bonus: number; proficientAnyway: boolean };

export function armorOfRow(item: WornItem): WornArmor | null {
  const named = magicItemBonus(item.name);
  if (item.gear?.armor) {
    // A workshop suit: its own block, and its own riders when it is magic.
    const own = gearDefOfRow(item);
    const riders = own?.base?.kind === "armor" && gearRidersActive(own, item) ? (own.armor ?? {}) : {};
    return {
      armor: {
        ...item.gear.armor,
        ...(riders.noStrength ? { strengthRequirement: undefined } : {}),
        ...(riders.noStealthPenalty ? { stealthDisadvantage: false } : {}),
      },
      bonus: Math.max(named, riders.bonus ?? 0),
      proficientAnyway: riders.proficientAnyway === true,
    };
  }
  const suit = matchArmor(item);
  const def = gearDefFor(item);
  if (def?.base?.kind !== "armor") {
    return suit ? { armor: suit, bonus: named, proficientAnyway: false } : null;
  }
  const base = armorNamed(def.base.name);
  if (!base) {
    return null;
  }
  const riders = gearRidersActive(def, item) ? (def.armor ?? {}) : {};
  const armor: SrdArmor = {
    ...base,
    ...(riders.noStrength ? { strengthRequirement: undefined } : {}),
    ...(riders.noStealthPenalty ? { stealthDisadvantage: false } : {}),
  };
  return {
    armor,
    bonus: Math.max(named, riders.bonus ?? 0),
    proficientAnyway: riders.proficientAnyway === true,
  };
}

// SRD 5.1, Adamantine Armor: "While you're wearing it, any critical hit
// against you becomes a normal hit." For the attack engines that roll
// against a character.
export function wornArmorTurnsCrits(equipment: WornItem[]): boolean {
  return equipment.some((item) => {
    if (!isWorn(item, equipment)) {
      return false;
    }
    const def = gearDefOfRow(item);
    const suit = def?.base?.kind === "armor" || Boolean(!def?.base && (item.gear?.armor || matchArmor(item)));
    return Boolean(def && suit && def.armor?.critProof === true && gearRidersActive(def, item));
  });
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

// How many items this character may be attuned to: three, or the
// Artificer's four, five and six from Magic Item Adept, Savant and Master
// (10th, 14th and 18th level).
export function attunementSlotsFor(holder: { class?: string; level?: number; classes?: Array<{ id: string; level?: number }> | null } | null): number {
  if (!holder) {
    return ATTUNEMENT_SLOTS;
  }
  const artificer = holder.classes?.length
    ? (holder.classes.find((entry) => entry.id.trim().toLowerCase() === "artificer")?.level ?? 0)
    : (holder.class ?? "").trim().toLowerCase() === "artificer"
      ? (holder.level ?? 0)
      : 0;
  return artificer >= 18 ? 6 : artificer >= 14 ? 5 : artificer >= 10 ? 4 : ATTUNEMENT_SLOTS;
}

// ---- AC derivation ----

// `gear` is a homebrew item's snapshotted mechanics (src/lib/homebrew/
// gear.ts): an armour written in the workshop is read here exactly as an
// SRD one, and the name lookup is only the fallback.
export type WornItem = {
  name: string;
  slug?: string;
  srdName?: string;
  equipped?: boolean;
  attuned?: boolean;
  gear?: { armor?: SrdArmor };
};

// Wearing is opt in per sheet. Once any row says whether it is worn, every
// row is read as it is marked, so a character who took the last piece off
// stands unarmored. A sheet that has never said wears what it carries, which
// keeps sheets written before the toggle working.
export function wearingIsExplicit(equipment: ReadonlyArray<{ equipped?: boolean }>): boolean {
  return equipment.some((item) => item.equipped !== undefined);
}

export function isWorn(
  item: { equipped?: boolean },
  equipment: ReadonlyArray<{ equipped?: boolean }>,
): boolean {
  return wearingIsExplicit(equipment) ? item.equipped === true : true;
}

// How much of the Dexterity modifier a suit lets through. Heavy armor takes
// none of it, in either direction: a clumsy wearer is not penalized (SRD 5.1,
// Armor). Medium armor caps the bonus and passes a penalty on whole.
function dexThrough(armor: SrdArmor, dexMod: number, mediumArmorMaster = false): number {
  if (armor.category === "heavy") {
    return 0;
  }
  // Medium Armor Master: medium armor takes 3 of the modifier, not 2.
  const cap = armor.dexCap !== undefined && mediumArmorMaster && armor.category === "medium" ? Math.max(armor.dexCap, 3) : armor.dexCap;
  return Math.min(dexMod, cap ?? dexMod);
}

// Whether the character wears armor or carries a shield they were never
// trained in. SRD 5.1, Armor: that costs disadvantage on every ability check,
// saving throw and attack roll that uses Strength or Dexterity, and the
// wearer cannot cast spells. Needs only the pack and the training list, so
// the attack engine and the cast guard ask the same question.
export function wearsUntrainedArmor(sheet: {
  equipment?: WornItem[];
  proficiencies?: { armor?: string[] };
}): boolean {
  const equipment = sheet.equipment ?? [];
  const trained = sheet.proficiencies?.armor ?? [];
  return equipment.some((item) => {
    if (!isWorn(item, equipment)) {
      return false;
    }
    const worn = armorOfRow(item);
    return worn ? !worn.proficientAnyway && !isArmorProficient(trained, worn.armor) : false;
  });
}

// SRD 5.1, Dwarf, Speed: "Your speed is not reduced by wearing heavy armor."
// A species with a row of its own answers by its text (a workshop copy of
// the Dwarf does; Tome of Heroes' Dwarf Chassis, which never says so, does
// not); the bundled dwarves by their ids, and a race written "Dwarf".
export function ignoresHeavyArmorSpeedPenalty(race: string | undefined | null, rules?: SpeciesRules | null): boolean {
  const species = speciesRulesFor(race ?? "", rules);
  return species ? Boolean(species.heavyArmorSpeed) : isDwarf(race ?? "");
}

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
  const wantedClasses = (Array.isArray(classId) ? classId : [classId]).map((entry) =>
    entry.trim().toLowerCase(),
  );
  const candidates = UNARMORED_FORMULAS.filter((entry) =>
    holdsFeature({ features }, entry.match),
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
  // The suit worn, as the armor engine read it (a magic armor's base, with
  // what its magic changes), for the callers that ask its category.
  armor: SrdArmor | null;
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
// `equipped` is opt-in: once any item says whether it is worn, only the
// items marked worn count, but a character who has never touched the toggle
// wears the best armor and shield they carry, so existing sheets keep
// working without an edit.
export function computeArmorClass(input: {
  equipment: WornItem[];
  armorProfs: string[];
  dexMod: number;
  abilityMods: { con: number; wis: number };
  strength: number;
  unarmored: UnarmoredFormula | null;
  // Flat adds from features and fighting styles (Defense +1, a ring +1).
  bonus?: number;
  // The wearer's race, for the one race heavy armor does not slow.
  race?: string;
  // Medium Armor Master: 3 of the Dexterity modifier through medium armor,
  // and no Stealth disadvantage from it (src/lib/srd/feat-combat.ts).
  mediumArmorMaster?: boolean;
}): AcBreakdown {
  const worn = input.equipment.filter((item) => isWorn(item, input.equipment));

  type Piece = { item: WornItem; armor: SrdArmor; bonus: number; proficientAnyway: boolean };
  let armorItem: Piece | null = null;
  let shieldItem: Piece | null = null;
  for (const item of worn) {
    const resolved = armorOfRow(item);
    if (!resolved) {
      continue;
    }
    const { armor } = resolved;
    if (armor.category === "shield") {
      if (!shieldItem || armor.baseAc + resolved.bonus > shieldItem.armor.baseAc + shieldItem.bonus) {
        shieldItem = { item, ...resolved };
      }
      continue;
    }
    const score = armor.baseAc + resolved.bonus + dexThrough(armor, input.dexMod, input.mediumArmorMaster);
    const bestScore = armorItem
      ? armorItem.armor.baseAc + armorItem.bonus + dexThrough(armorItem.armor, input.dexMod, input.mediumArmorMaster)
      : -Infinity;
    if (score > bestScore) {
      armorItem = { item, ...resolved };
    }
  }

  const parts: string[] = [];
  let ac: number;
  let unproficient = false;
  let speedPenalty = 0;
  let stealthDisadvantage = false;

  if (armorItem) {
    const { armor, item } = armorItem;
    const magic = armorItem.bonus;
    const dex = dexThrough(armor, input.dexMod, input.mediumArmorMaster);
    ac = armor.baseAc + magic + dex;
    parts.push(`${item.name} ${armor.baseAc + magic}`);
    if (dex !== 0) {
      parts.push(`DEX ${dex >= 0 ? "+" : ""}${dex}`);
    }
    unproficient = !armorItem.proficientAnyway && !isArmorProficient(input.armorProfs, armor);
    stealthDisadvantage = Boolean(armor.stealthDisadvantage) && !(input.mediumArmorMaster && armor.category === "medium");
    if (
      armor.strengthRequirement &&
      input.strength < armor.strengthRequirement &&
      !ignoresHeavyArmorSpeedPenalty(input.race)
    ) {
      speedPenalty = 10;
    }
  } else if (input.unarmored && (input.unarmored.allowsShield || !shieldItem)) {
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

  // The monk's Unarmored Defense is the one formula a shield switches off:
  // behind a shield the monk stands at 10 + DEX + the shield, which is what
  // the branch above fell through to. The shield itself always counts.
  if (shieldItem) {
    const magic = shieldItem.bonus;
    ac += shieldItem.armor.baseAc + magic;
    parts.push(`${shieldItem.item.name} +${shieldItem.armor.baseAc + magic}`);
    if (!shieldItem.proficientAnyway && !isArmorProficient(input.armorProfs, shieldItem.armor)) {
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
    armor: armorItem?.armor ?? null,
    shieldName: shieldItem ? shieldItem.item.name : null,
    stealthDisadvantage,
    speedPenalty,
    unproficient,
  };
}

// The armor a class should start the adventure wearing, from its training.
// Mirrors defaultLoadout in weapons.ts: nobody should begin in a loincloth
// because the builder never offered them a breastplate.
// The SRD's metal armor. A druid's training reads "(nonmetal)": druids will
// not wear armor or use shields made of metal (SRD 5.1, Druid).
const METAL_ARMOR = new Set(
  ["Chain Shirt", "Scale Mail", "Breastplate", "Half Plate", "Ring Mail", "Chain Mail", "Splint", "Plate"].map(armorKey),
);

export function isMetalArmor(armor: Pick<SrdArmor, "name">): boolean {
  return METAL_ARMOR.has(armorKey(armor.name));
}

function wearsNoMetal(armorProfs: string[]): boolean {
  return armorProfs.some((entry) => /non-?metal/i.test(entry));
}

export function defaultArmor(armorProfs: string[]): SrdArmor[] {
  const out: SrdArmor[] = [];
  const heavy = isArmorProficient(armorProfs, get("Plate"));
  const medium = isArmorProficient(armorProfs, get("Breastplate"));
  const light = isArmorProficient(armorProfs, get("Leather"));
  if (wearsNoMetal(armorProfs)) {
    // The SRD starts a druid in leather with a wooden shield.
    if (light || medium) {
      out.push(get("Leather"));
    }
  } else if (heavy) {
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
// The armor a class's training suggests. The setting armor (a kevlar vest,
// brass carapace) is offered only to a class of its genre: `genres` is the
// class's own list, absent for an SRD or content-pack class, which sees
// the SRD table alone (issue #112).
export function suggestArmor(armorProfs: string[], genres?: readonly string[]): SrdArmor[] {
  const noMetal = wearsNoMetal(armorProfs);
  return SRD_ARMOR.filter(
    (armor) =>
      isArmorProficient(armorProfs, armor) &&
      !(noMetal && isMetalArmor(armor)) &&
      (!armor.genres || armor.genres.some((genre) => genres?.includes(genre))),
  );
}

function get(name: string) {
  const armor = byName.get(armorKey(name));
  if (!armor) {
    throw new Error(`Unknown SRD armor: ${name}`);
  }
  return armor;
}
