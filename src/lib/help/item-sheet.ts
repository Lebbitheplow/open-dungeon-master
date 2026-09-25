import { describeContentEntry } from "@/lib/help";
import { DAMAGE_TYPE_BLURBS, WEAPON_PROPERTY_BLURBS } from "@/lib/help/terms";
import { magicItemBonus, matchArmor, type SrdArmor } from "@/lib/srd/armor";
import { SRD_WEAPONS, type SrdWeapon } from "@/lib/srd/weapons";

// The ⓘ card for a carried thing. An item's facts are scattered: the Open5e
// v1 tables give a Longsword's die and a Plate's AC but no prose and (for
// armour) no weight, the v2 gear rows give prose and weight but no stats, a
// magic item gives rarity and prose, the bundled SRD tables hold the genre
// gear (a Kevlar Vest) the pack never heard of, and a homebrew entry carries
// its own SrdWeapon/SrdArmor block. This folds whatever rows were found into
// one sheet, so the card always leads with weight and value, then armour or
// weapon stats, then the long text when there is any.
//
// Pure: the dialog fetches the rows, this decides what they say, and
// scripts/test-item-sheet.mjs drives it directly.

type Row = Record<string, unknown>;

export type ItemProperty = { name: string; blurb: string | null };

export type ItemSheet = {
  // "Martial melee weapon", "Medium armor", "Wondrous item", "Adventuring gear".
  type: string | null;
  rarity: string | null;
  attunement: boolean;
  // A "+1" in the name, applied to AC or to attack and damage.
  bonus: number;
  weight: string | null;
  cost: string | null;
  armor: {
    ac: string;
    // How DEX enters the AC, in words.
    dex: string | null;
    strength: number | null;
    stealthDisadvantage: boolean;
    shield: boolean;
  } | null;
  weapon: {
    damage: string | null;
    damageType: string | null;
    damageBlurb: string | null;
    range: string | null;
    properties: ItemProperty[];
  } | null;
  description: string | null;
};

function str(row: Row | undefined, key: string): string {
  const value = row?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

// "Martial Melee Weapons" is a table heading; one weapon is one of them, and
// the card reads it as a sentence.
function asType(category: string): string {
  return capitalize(category.trim().toLowerCase().replace(/s$/, ""));
}

function formatPounds(pounds: number): string {
  return `${Number(pounds.toFixed(2))} lb.`;
}

// v1 rows say "3 lb." (armour rows say nothing), v2 rows "5.000" plus a unit,
// homebrew a bare number. A zero means "not recorded", never "weightless".
function weightOf(row: Row): string | null {
  const value = row.weight;
  if (typeof value === "number") {
    return value > 0 ? formatPounds(value) : null;
  }
  const text = str(row, "weight");
  if (!text) {
    return null;
  }
  const pounds = num(text);
  if (pounds === null) {
    return /^0+(\.0+)?\s*lb/i.test(text) ? null : text;
  }
  return pounds > 0 ? formatPounds(pounds) : null;
}

// v1 rows say "15 gp", v2 rows a bare gold figure ("0.01"), homebrew
// whatever the author typed. Unarmored Defense sits in the armour table at
// "0 gp"; a price on something nobody buys is noise.
function costOf(row: Row): string | null {
  const text = str(row, "cost");
  if (!text) {
    return null;
  }
  const gold = num(text);
  if (gold === null) {
    return /^0+\s*gp$/i.test(text) ? null : text;
  }
  if (gold <= 0) {
    return null;
  }
  if (gold >= 1) {
    return `${Number(gold.toFixed(2))} gp`;
  }
  const silver = gold * 10;
  return Number.isInteger(Number(silver.toFixed(4))) ? `${Math.round(silver)} sp` : `${Math.round(gold * 100)} cp`;
}

function propertyOf(raw: string): ItemProperty {
  const name = capitalize(raw.trim());
  const base = raw.trim().toLowerCase().split(" (")[0];
  return { name, blurb: WEAPON_PROPERTY_BLURBS[base] ?? null };
}

function damageOf(dice: string, type: string, bonus: number) {
  // A Net's die is "0" (or "0 (restrains)"): it deals no damage.
  const clean = /^0\b/.test(dice) ? "" : dice;
  const lower = type.toLowerCase();
  return {
    damage: clean ? (bonus ? `${clean} + ${bonus}` : clean) : null,
    damageType: clean && lower ? lower : null,
    damageBlurb: clean ? (DAMAGE_TYPE_BLURBS[lower] ?? null) : null,
  };
}

function weaponFromSrd(weapon: SrdWeapon, bonus: number): NonNullable<ItemSheet["weapon"]> {
  const [dice = "", ...rest] = weapon.damage.split(" ");
  return {
    ...damageOf(dice, rest.join(" "), bonus),
    range: weapon.rangeFt ? `${weapon.rangeFt} ft.` : null,
    properties: (weapon.properties ?? []).map(propertyOf),
  };
}

function weaponFromPack(row: Row, bonus: number): NonNullable<ItemSheet["weapon"]> {
  const properties = Array.isArray(row.properties)
    ? row.properties.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : [];
  // The range lives inside the property text: "thrown (range 20/60)".
  const range = properties
    .map((entry) => /\((?:range\s+)?(\d+\/\d+)\)/i.exec(entry)?.[1])
    .find(Boolean);
  return {
    ...damageOf(str(row, "damage_dice"), str(row, "damage_type"), bonus),
    range: range ? `${range} ft.` : null,
    properties: properties.map(propertyOf),
  };
}

function armorFromSrd(armor: SrdArmor, bonus: number): NonNullable<ItemSheet["armor"]> {
  const shield = armor.category === "shield";
  const base = armor.baseAc + bonus;
  const dex = shield
    ? null
    : armor.dexCap === undefined
      ? "Add your full Dexterity modifier."
      : armor.dexCap === 0
        ? "Dexterity does not add to it."
        : `Add your Dexterity modifier, up to +${armor.dexCap}.`;
  const ac = shield
    ? `+${base}`
    : armor.dexCap === undefined
      ? `${base} + Dex`
      : armor.dexCap === 0
        ? String(base)
        : `${base} + Dex (max ${armor.dexCap})`;
  return {
    ac,
    dex,
    strength: armor.strengthRequirement ?? null,
    stealthDisadvantage: Boolean(armor.stealthDisadvantage),
    shield,
  };
}

function armorFromPack(row: Row, bonus: number): NonNullable<ItemSheet["armor"]> {
  const shield = str(row, "category").toLowerCase() === "shield";
  const baseAc = num(row.base_ac) ?? 0;
  const flat = num(row.plus_flat_mod) ?? 0;
  const acString = str(row, "ac_string")
    .replace(/Dex modifier/g, "Dex")
    .replace(/Con modifier/g, "Con")
    .replace(/Wis modifier/g, "Wis");
  // A shield's row reads "0 +2": it adds to AC rather than setting it.
  const ac = shield && baseAc === 0 ? `+${flat + bonus}` : bonus ? `${acString} (+${bonus})` : acString;
  const usesDex = row.plus_dex_mod === true;
  const cap = num(row.plus_max) ?? 0;
  const strength = num(row.strength_requirement);
  return {
    ac,
    dex: shield ? null : !usesDex ? "Dexterity does not add to it." : cap > 0 ? `Add your Dexterity modifier, up to +${cap}.` : "Add your full Dexterity modifier.",
    strength: strength && strength > 0 ? strength : null,
    stealthDisadvantage: row.stealth_disadvantage === true,
    shield,
  };
}

// The pack row type, told apart by the fields each table carries.
const isPackWeapon = (row: Row) => "damage_dice" in row;
const isPackArmor = (row: Row) => "base_ac" in row || "ac_string" in row;
const isMagic = (row: Row) => typeof row.rarity === "string" && row.rarity.trim() !== "";
const isHomebrew = (row: Row) => typeof row.itemKind === "string";

// The bundled weapon a name refers to, only when the weapon's name is the
// whole name or its tail ("+1 Longsword", "Silvered Dagger"), so a "Pistol
// Holster" is not read as a pistol. Longest name wins: "Hand Crossbow"
// before a plain crossbow.
function matchWeaponTail(name: string): SrdWeapon | null {
  const wanted = name
    .toLowerCase()
    .replace(/[+-]\d+/g, " ")
    .replace(/[^a-z0-9-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/s$/, "");
  if (!wanted) {
    return null;
  }
  const hits = SRD_WEAPONS.filter((weapon) => {
    const key = weapon.name.toLowerCase();
    return wanted === key || wanted.endsWith(` ${key}`);
  });
  hits.sort((a, b) => b.name.length - a.name.length);
  return hits[0] ?? null;
}

// `rows` is every content-pack or homebrew row found for the name, the
// direct slug hit first. Null when neither the rows nor the bundled tables
// know anything about it.
export function buildItemSheet(name: string, rows: Array<Row | undefined | null>): ItemSheet | null {
  const found = rows.filter((row): row is Row => Boolean(row) && typeof row === "object");
  const bonus = magicItemBonus(name);
  const homebrew = found.find(isHomebrew);
  const packWeapon = found.find(isPackWeapon);
  const packArmor = found.find(isPackArmor);
  const magic = found.find(isMagic);

  let armor: ItemSheet["armor"] = null;
  let weapon: ItemSheet["weapon"] = null;
  let type: string | null = null;
  let srdArmor: SrdArmor | null = null;

  const brewArmor = homebrew?.armor as SrdArmor | undefined;
  const brewWeapon = homebrew?.weapon as SrdWeapon | undefined;
  if (brewArmor && typeof brewArmor.baseAc === "number") {
    armor = armorFromSrd(brewArmor, bonus);
    type = brewArmor.category === "shield" ? "Shield" : `${capitalize(brewArmor.category)} armor`;
  } else if (brewWeapon && typeof brewWeapon.damage === "string") {
    weapon = weaponFromSrd(brewWeapon, bonus);
    type = `${capitalize(brewWeapon.category)} ${brewWeapon.kind} weapon`;
  } else if (packArmor) {
    armor = armorFromPack(packArmor, bonus);
    type = asType(str(packArmor, "category")) || "Armor";
    if (type !== "Shield" && !/armor$/i.test(type)) {
      type = `${type} armor`;
    }
    // The pack's armour rows carry no weight; the bundled table does.
    srdArmor = matchArmor(str(packArmor, "name") || name);
  } else if (packWeapon) {
    weapon = weaponFromPack(packWeapon, bonus);
    type = asType(str(packWeapon, "category")) || "Weapon";
  } else if ((srdArmor = matchArmor(name))) {
    armor = armorFromSrd(srdArmor, bonus);
    type = srdArmor.category === "shield" ? "Shield" : `${capitalize(srdArmor.category)} armor`;
  } else {
    const srdWeapon = matchWeaponTail(name);
    if (srdWeapon) {
      weapon = weaponFromSrd(srdWeapon, bonus);
      type = `${capitalize(srdWeapon.category)} ${srdWeapon.kind} weapon`;
    }
  }

  // Magic items name what they are ("Weapon (any sword)", "Wondrous item");
  // v2 gear rows carry {name} categories ("Adventuring Gear").
  if (!type && magic) {
    type = capitalize(str(magic, "type")) || null;
  }
  if (!type) {
    const category = found.map((row) => row.category).find((value) => value && typeof value === "object") as
      | { name?: string }
      | undefined;
    type = category?.name ? capitalize(category.name.toLowerCase()) : null;
  }
  if (!type && homebrew) {
    type = homebrew.itemKind === "magic_item" ? "Magic item" : capitalize(String(homebrew.itemKind));
  }

  const weight =
    found.map(weightOf).find(Boolean) ?? (srdArmor ? formatPounds(srdArmor.weightLb) : null);
  const cost = found.map(costOf).find(Boolean) ?? null;
  const description = found.map((row) => describeContentEntry(row)).find(Boolean) ?? null;
  const rarity = magic ? capitalize(str(magic, "rarity").toLowerCase()) : null;
  const attunement = found.some(
    (row) => row.requiresAttunement === true || /attunement/i.test(str(row, "requires_attunement")),
  );

  if (!armor && !weapon && !description && !weight && !cost && !rarity) {
    return null;
  }
  return { type, rarity, attunement, bonus, weight, cost, armor, weapon, description };
}
