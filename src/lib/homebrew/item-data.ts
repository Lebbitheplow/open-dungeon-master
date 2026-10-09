import { isValidExpression } from "@/lib/dice";
import type { SrdArmor } from "@/lib/srd/armor";
import type { SrdWeapon } from "@/lib/srd/weapons";
import type { MagicItemEffect } from "@/lib/srd/magic-items";
import { clamp, num, oneOf, text, type Raw } from "@/lib/homebrew/coerce";
import { checkItemMagic, type ItemMagic } from "@/lib/homebrew/item-magic-schema";
import type { ArmorRiders, ChargeRule, WeaponRiders } from "@/lib/srd/magic-gear";
import type { ItemSpell } from "@/lib/srd/item-spells";
import type { AttunementRule } from "@/lib/srd/magic-items";

// A homebrew item as the engine reads it: its weapon block (an SrdWeapon),
// its armour block (an SrdArmor), its magic effects (the MagicItemEffect
// words magic-items.json uses) and the rest of an SRD magic item's magic
// (src/lib/homebrew/item-magic-schema.ts), checked here, and the snapshot
// (HomebrewGear) that rides on a sheet's equipment line. Split out of
// gear.ts, which re-exports all of it. Pure: no DB and no I/O.

export const ITEM_KINDS = ["weapon", "armor", "gear", "magic_item"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const WEAPON_CATEGORIES = ["simple", "martial", "firearm", "exotic"] as const;
export const WEAPON_PROPERTIES = [
  "ammunition",
  "finesse",
  "heavy",
  "light",
  "loading",
  "reach",
  "thrown",
  "two-handed",
  "versatile",
] as const;
export const ARMOR_CATEGORIES = ["light", "medium", "heavy", "shield"] as const;
export const RARITIES = ["common", "uncommon", "rare", "very rare", "legendary", "artifact"] as const;
export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export const EFFECT_KINDS = ["ac_bonus", "ac_unarmored", "save_bonus", "set_ability", "resistance"] as const;

// The ceilings are the published game's own: no magic bonus in the SRD goes
// past +3, and no weapon a character swings rolls more than a dozen or two.
export const GEAR_LIMITS = {
  descMax: 8_000,
  effectsMax: 6,
  bonusMax: 3,
  // The largest die a weapon rolls, and the most its dice and flat damage
  // can come to on their best roll (a greatsword's 2d6 is 12).
  damageDieMax: 12,
  damageRollMax: 30,
  acMin: 10,
  acMax: 21,
  shieldMax: 5,
  weightMax: 10_000,
  chargesMax: 50,
} as const;

export type HomebrewMagic = {
  requiresAttunement: boolean;
  effects: MagicItemEffect[];
  // Who the item lets attune, and whether it works from the pack: read by
  // magic-items.ts the same as an SRD row's.
  attunedBy?: AttunementRule;
  carried?: boolean;
};

// The item as the magic-gear engines read an SRD row (GearDef, less the
// name keys): the base it is built on, its weapon and armour riders, its
// charges and its curse. gearDefOfRow (magic-gear.ts) answers with it for
// the row that carries it.
export type HomebrewGearDef = {
  requiresAttunement: boolean;
  base?: { kind: "weapon" | "armor"; name: string };
  weapon?: WeaponRiders;
  armor?: ArmorRiders;
  charges?: ChargeRule;
  cursed?: boolean;
};

export type HomebrewGear = {
  weapon?: SrdWeapon;
  armor?: SrdArmor;
  magic?: HomebrewMagic;
  def?: HomebrewGearDef;
  checks?: ItemMagic["checks"];
  spells?: ItemSpell[];
  weight?: number;
};

// What a stored entry's data blob looks like after normalization: whatever
// the kind carries, and always a description.
export type HomebrewData = Raw & { desc: string };

// ---- items ----

export type Outcome<T> = { data: T } | { error: string };

// Why a damage expression is more than a weapon deals, or null. Every die is
// a d12 at most and the best possible roll stays within damageRollMax.
export function damageProblem(dice: string): string | null {
  let best = 0;
  for (const term of dice.matchAll(/(\d*)d(\d+)/gi)) {
    const count = term[1] ? Number(term[1]) : 1;
    const sides = Number(term[2]);
    if (sides > GEAR_LIMITS.damageDieMax) {
      return `a weapon's die is a d${GEAR_LIMITS.damageDieMax} at most, and "${dice}" rolls a d${sides}.`;
    }
    best += count * sides;
  }
  for (const flat of dice.replace(/\d*d\d+/gi, "").matchAll(/[+-]?\d+/g)) {
    best += Number(flat[0]);
  }
  return best > GEAR_LIMITS.damageRollMax
    ? `a weapon deals ${GEAR_LIMITS.damageRollMax} at most on its best roll, and "${dice}" can roll ${best}.`
    : null;
}

export function normalizeWeapon(raw: unknown, name: string): Outcome<SrdWeapon> {
  const source = (raw ?? {}) as Raw;
  const damage = text(source.damage, 40);
  if (!damage) {
    return { error: `${name} needs damage, like "1d8 slashing".` };
  }
  const [dice] = damage.split(/\s+/);
  if (!isValidExpression(dice)) {
    return { error: `"${dice}" is not a dice expression the table can roll.` };
  }
  const tooMuch = damageProblem(dice);
  if (tooMuch) {
    return { error: `${name}: ${tooMuch}` };
  }
  const properties = Array.isArray(source.properties)
    ? [...new Set(source.properties.map((p) => String(p).trim().toLowerCase()).filter((p) => (WEAPON_PROPERTIES as readonly string[]).includes(p)))]
    : [];
  const kind = oneOf(source.kind, ["melee", "ranged"] as const, "melee");
  const rangeFt = num(source.rangeFt);
  const longRangeFt = num(source.longRangeFt);
  const normal = rangeFt !== null && rangeFt > 0 ? Math.min(600, Math.round(rangeFt)) : null;
  return {
    data: {
      name,
      category: oneOf(source.category, WEAPON_CATEGORIES, "simple"),
      kind,
      damage,
      ...(properties.length ? { properties } : {}),
      ...(normal !== null ? { rangeFt: normal } : {}),
      // The long range a shot at disadvantage reaches (SRD: a longbow's 600).
      ...(normal !== null && longRangeFt !== null && longRangeFt >= normal ? { longRangeFt: Math.min(1_200, Math.round(longRangeFt)) } : {}),
    },
  };
}

export function normalizeArmor(raw: unknown, name: string): Outcome<SrdArmor> {
  const source = (raw ?? {}) as Raw;
  const category = oneOf(source.category, ARMOR_CATEGORIES, "light");
  const shield = category === "shield";
  const baseAc = num(source.baseAc);
  if (baseAc === null) {
    return { error: `${name} needs a base armour class.` };
  }
  if (shield && (baseAc < 1 || baseAc > GEAR_LIMITS.shieldMax)) {
    return { error: `A shield adds between 1 and ${GEAR_LIMITS.shieldMax}.` };
  }
  if (!shield && (baseAc < GEAR_LIMITS.acMin || baseAc > GEAR_LIMITS.acMax)) {
    return { error: `Armour class runs from ${GEAR_LIMITS.acMin} to ${GEAR_LIMITS.acMax}.` };
  }
  const dexCap = num(source.dexCap);
  const strengthRequirement = num(source.strengthRequirement);
  return {
    data: {
      name,
      category,
      baseAc: Math.round(baseAc),
      // Heavy armour lets no DEX through; light lets all of it; medium is
      // the one with a number worth typing.
      ...(shield
        ? {}
        : category === "heavy"
          ? { dexCap: 0 }
          : dexCap !== null && category === "medium"
            ? { dexCap: Math.min(5, Math.max(0, Math.round(dexCap))) }
            : {}),
      ...(strengthRequirement !== null && strengthRequirement > 0
        ? { strengthRequirement: Math.min(30, Math.round(strengthRequirement)) }
        : {}),
      ...(source.stealthDisadvantage === true ? { stealthDisadvantage: true } : {}),
      weightLb: Math.max(0, num(source.weightLb) ?? 0),
    },
  };
}

export function normalizeEffects(raw: unknown): MagicItemEffect[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: MagicItemEffect[] = [];
  for (const entry of raw) {
    const source = (entry ?? {}) as Raw;
    switch (source.kind) {
      case "ac_bonus":
      case "ac_unarmored":
      case "save_bonus": {
        const amount = clamp(source.amount, -GEAR_LIMITS.bonusMax, GEAR_LIMITS.bonusMax, 0);
        if (amount !== 0) {
          out.push({ kind: source.kind, amount });
        }
        break;
      }
      case "set_ability": {
        const ability = oneOf(source.ability, ABILITIES, "str");
        out.push({ kind: "set_ability", ability, score: clamp(source.score, 3, 30, 19) });
        break;
      }
      case "resistance": {
        const types = Array.isArray(source.types)
          ? [...new Set(source.types.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 13)
          : [];
        if (types.length) {
          out.push({ kind: "resistance", types });
        }
        break;
      }
      default:
        break;
    }
    if (out.length >= GEAR_LIMITS.effectsMax) {
      break;
    }
  }
  return out;
}

export function normalizeItemData(raw: unknown, name: string): Outcome<HomebrewData> {
  const source = (raw ?? {}) as Raw;
  const itemKind = oneOf(source.itemKind, ITEM_KINDS, "gear");
  const data: HomebrewData = {
    desc: text(source.desc, GEAR_LIMITS.descMax),
    itemKind,
    rarity: text(source.rarity, 40),
    cost: text(source.cost, 40),
  };
  const weight = num(source.weight);
  if (weight !== null && weight >= 0) {
    data.weight = Math.min(GEAR_LIMITS.weightMax, Math.round(weight * 100) / 100);
  }
  if (itemKind === "weapon") {
    const weapon = normalizeWeapon(source.weapon, name);
    if ("error" in weapon) {
      return weapon;
    }
    data.weapon = weapon.data;
  }
  if (itemKind === "armor") {
    const armor = normalizeArmor(source.armor, name);
    if ("error" in armor) {
      return armor;
    }
    if (data.weight === undefined && armor.data.weightLb) {
      data.weight = armor.data.weightLb;
    }
    data.armor = armor.data;
  }
  if (itemKind === "magic_item" || source.effects !== undefined || source.requiresAttunement !== undefined) {
    data.requiresAttunement = source.requiresAttunement === true;
    data.effects = normalizeEffects(source.effects);
    // A magic weapon or armour keeps its weapon or armour block too.
    if (itemKind === "magic_item" && source.weapon) {
      const weapon = normalizeWeapon(source.weapon, name);
      if ("error" in weapon) {
        return weapon;
      }
      data.weapon = weapon.data;
    }
    if (itemKind === "magic_item" && source.armor) {
      const armor = normalizeArmor(source.armor, name);
      if ("error" in armor) {
        return armor;
      }
      data.armor = armor.data;
    }
  }
  // The rest of an SRD magic item's magic: riders, charges, the spells they
  // cast, checks, who may attune, a curse (item-magic-schema.ts).
  const magic = checkItemMagic(source);
  if ("error" in magic) {
    return magic;
  }
  Object.assign(data, magic.magic);
  return { data };
}

// The snapshot a sheet's equipment line carries for a homebrew item. Null
// for an entry with nothing the engine reads (plain gear with a
// description), so a snapshot is only ever written when it means something.
export function gearFromHomebrewData(name: string, data: unknown): HomebrewGear | null {
  const source = (data ?? {}) as Raw;
  const gear: HomebrewGear = {};
  if (source.weapon) {
    const weapon = normalizeWeapon(source.weapon, name);
    if ("data" in weapon) {
      gear.weapon = weapon.data;
    }
  }
  if (source.armor) {
    const armor = normalizeArmor(source.armor, name);
    if ("data" in armor) {
      gear.armor = armor.data;
    }
  }
  const checked = checkItemMagic(source);
  const extra: ItemMagic = "magic" in checked ? checked.magic : {};
  const effects = normalizeEffects(source.effects);
  const requiresAttunement = source.requiresAttunement === true;
  // An item that asks for attunement is judged for it even with no effect
  // of its own (a magic sword whose magic is all riders).
  // A magic item says whether it takes an attunement even when it does not:
  // one that needs none takes none of the three places (magic-items.ts).
  if (source.itemKind === "magic_item" || effects.length || requiresAttunement || extra.attunedBy || extra.carried) {
    gear.magic = {
      requiresAttunement,
      effects,
      ...(extra.attunedBy ? { attunedBy: extra.attunedBy } : {}),
      ...(extra.carried ? { carried: true } : {}),
    };
  }
  if (extra.weaponRiders || extra.armorRiders || extra.charges || extra.cursed) {
    gear.def = {
      requiresAttunement,
      ...(gear.weapon ? { base: { kind: "weapon" as const, name: gear.weapon.name } } : gear.armor ? { base: { kind: "armor" as const, name: gear.armor.name } } : {}),
      ...(extra.weaponRiders ? { weapon: extra.weaponRiders } : {}),
      ...(extra.armorRiders ? { armor: extra.armorRiders } : {}),
      ...(extra.charges ? { charges: extra.charges } : {}),
      ...(extra.cursed ? { cursed: true } : {}),
    };
  }
  if (extra.checks) {
    gear.checks = extra.checks;
  }
  if (extra.spells?.length) {
    gear.spells = extra.spells;
  }
  const weight = num(source.weight);
  if (weight !== null && weight >= 0) {
    gear.weight = weight;
  }
  return Object.keys(gear).length ? gear : null;
}

