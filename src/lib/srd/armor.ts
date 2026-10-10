import { gearDefFor, gearDefOfRow, gearRidersActive } from "@/lib/srd/magic-gear";
import { speciesRulesFor, type SpeciesRules } from "@/lib/srd/race-id";

// SRD 5.1 armor table plus the pure AC math the whole app derives armor
// class from. Mirrors src/lib/srd/weapons.ts: a data table, fuzzy name
// matching, a proficiency test, and starting-kit helpers. Its one dependency
// is the generated magic item table (src/lib/srd/magic-gear.ts), which says
// what suit a magic armor is.
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
  // Pounds. Open5e ships every armor row with a blank weight, so the SRD
  // table is the only source we have for it; the encumbrance rule
  // (src/lib/srd/encumbrance.ts) falls back here when the content pack has
  // nothing to say.
  weightLb: number;
  // Set on the setting armor only: the genres whose classes it is offered
  // to. An SRD class is never suggested a kevlar vest (issue #112).
  genres?: string[];
};

export const SRD_ARMOR: SrdArmor[] = [
  { name: "Padded", category: "light", baseAc: 11, stealthDisadvantage: true, weightLb: 8 },
  { name: "Leather", category: "light", baseAc: 11, weightLb: 10 },
  { name: "Studded Leather", category: "light", baseAc: 12, weightLb: 13 },
  { name: "Hide", category: "medium", baseAc: 12, dexCap: 2, weightLb: 12 },
  { name: "Chain Shirt", category: "medium", baseAc: 13, dexCap: 2, weightLb: 20 },
  { name: "Scale Mail", category: "medium", baseAc: 14, dexCap: 2, stealthDisadvantage: true, weightLb: 45 },
  { name: "Breastplate", category: "medium", baseAc: 14, dexCap: 2, weightLb: 20 },
  { name: "Half Plate", category: "medium", baseAc: 15, dexCap: 2, stealthDisadvantage: true, weightLb: 40 },
  { name: "Ring Mail", category: "heavy", baseAc: 14, dexCap: 0, stealthDisadvantage: true, weightLb: 40 },
  { name: "Chain Mail", category: "heavy", baseAc: 16, dexCap: 0, strengthRequirement: 13, stealthDisadvantage: true, weightLb: 55 },
  { name: "Splint", category: "heavy", baseAc: 17, dexCap: 0, strengthRequirement: 15, stealthDisadvantage: true, weightLb: 60 },
  { name: "Plate", category: "heavy", baseAc: 18, dexCap: 0, strengthRequirement: 15, stealthDisadvantage: true, weightLb: 65 },
  { name: "Shield", category: "shield", baseAc: 2, weightLb: 6 },
  // Setting-specific equivalents for the custom genre classes, so a
  // cyberpunk runner in a armorweave vest gets real AC instead of nothing.
  { name: "Armorweave Vest", category: "light", baseAc: 12, weightLb: 6, genres: ["cyberpunk"] },
  { name: "Kevlar Vest", category: "medium", baseAc: 13, dexCap: 2, weightLb: 15, genres: ["cyberpunk", "post_apocalyptic"] },
  { name: "Riot Plating", category: "heavy", baseAc: 17, dexCap: 0, strengthRequirement: 13, stealthDisadvantage: true, weightLb: 50, genres: ["cyberpunk", "post_apocalyptic"] },
  { name: "Brass Carapace", category: "medium", baseAc: 14, dexCap: 2, weightLb: 25, genres: ["steampunk"] },
  { name: "Scrap Plate", category: "heavy", baseAc: 16, dexCap: 0, strengthRequirement: 13, stealthDisadvantage: true, weightLb: 50, genres: ["post_apocalyptic"] },
  { name: "Ballistic Shield", category: "shield", baseAc: 2, weightLb: 8, genres: ["cyberpunk", "post_apocalyptic"] },
];

const byName = new Map(SRD_ARMOR.map((armor) => [normalize(armor.name), armor]));

// "+1 Plate", "Plate Armor", "Chain Mail, +2" -> a lookup key. The magic
// bonus, punctuation, and the noise word "armor" go; a trailing plural too
// ("Shields" is a shield). `written` keeps the plural, for the tail rule
// below: "work leathers" is clothing, not Leather (issue #113).
function written(term: string) {
  return term
    .toLowerCase()
    .replace(/[+-]\d+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(armor|armour)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalize(term: string) {
  return written(term).replace(/s$/, "");
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
  // The tail must be the armor's name as written, singular: a "+1 Studded
  // Leather" is one, a Guild Engineer's "work leathers" is not.
  const tail = written(term);
  const candidates = SRD_ARMOR.filter((armor) => tail.endsWith(` ${normalize(armor.name)}`));
  candidates.sort((a, b) => b.name.length - a.name.length);
  return candidates[0] ?? null;
}

// An SRD armor named anywhere in a free-text name, as whole words, longest
// first: "Chain Mail of Fire Resistance" holds chain mail. Only used to find
// the magic armor such a name is (armorOfRow), never as armor on its own, so
// a "Leather Backpack" stays a backpack.
export function armorInside(term: string): SrdArmor | null {
  const wanted = ` ${normalize(term)} `;
  const candidates = SRD_ARMOR.filter((armor) => wanted.includes(` ${normalize(armor.name)} `));
  candidates.sort((a, b) => b.name.length - a.name.length);
  return candidates[0] ?? null;
}

// A worn row as the armor engine reads it: the suit (or shield) it is, the
// magic bonus it carries, and whether it is worn as if trained. A magic
// armor is its base armor with what its entry changes (src/lib/srd/
// magic-gear.ts): Armor of Invulnerability is plate, Elven Chain a chain
// shirt +1 anyone may wear, mithral drops the Strength requirement and the
// Stealth disadvantage. A name that says which suit it is ("Mithral Half
// Plate") wins over the entry's default. The bonus and the other riders of an
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
  const tail = matchArmor(item.name);
  const inside = tail ?? armorInside(item.name);
  const def = gearDefFor(item.name, item.slug, inside?.name ?? null);
  // A row with no base of its own whose name ends in a suit (Animated Chain
  // Mail, a Grasping Shield) is that suit, with its riders.
  const namesSuit = Boolean(!def?.base && inside && def?.armor && Object.keys(def.armor).length);
  if (!def || (def.base?.kind !== "armor" && !namesSuit)) {
    return tail ? { armor: tail, bonus: named, proficientAnyway: false } : null;
  }
  const base = inside ?? (def.base ? byName.get(normalize(def.base.name)) : null) ?? null;
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
    const def = gearDefOfRow(item, matchArmor(item.name)?.name ?? null);
    const suit = def?.base?.kind === "armor" || Boolean(!def?.base && (item.gear?.armor || matchArmor(item.name)));
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
  equipped?: boolean;
  attuned?: boolean;
  gear?: { armor?: SrdArmor };
};

// Wearing is opt in per sheet. Once any row says whether it is worn, every
// row is read as it is marked, so a character who took the last piece off
// stands unarmored. A sheet that has never said wears what it carries, which
// keeps sheets written before the toggle working.
export function wearingIsExplicit(equipment: Array<{ equipped?: boolean }>): boolean {
  return equipment.some((item) => item.equipped !== undefined);
}

export function isWorn(
  item: { equipped?: boolean },
  equipment: Array<{ equipped?: boolean }>,
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
// not); the bundled dwarves and a race named in free text by the word.
export function ignoresHeavyArmorSpeedPenalty(race: string | undefined | null, rules?: SpeciesRules | null): boolean {
  const species = speciesRulesFor(race ?? "", rules);
  return species ? Boolean(species.heavyArmorSpeed) : /dwarf/i.test(race ?? "");
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
  // The suit worn, as the armor engine read it (a magic armor's base, with
  // what its magic changes), for the callers that ask its category.
  armor?: SrdArmor | null;
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
  ["Chain Shirt", "Scale Mail", "Breastplate", "Half Plate", "Ring Mail", "Chain Mail", "Splint", "Plate"].map(normalize),
);

export function isMetalArmor(armor: Pick<SrdArmor, "name">): boolean {
  return METAL_ARMOR.has(normalize(armor.name));
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
  const armor = byName.get(normalize(name));
  if (!armor) {
    throw new Error(`Unknown SRD armor: ${name}`);
  }
  return armor;
}
