import { isValidExpression } from "@/lib/dice";
import type { SrdArmor } from "@/lib/srd/armor";
import type { SrdWeapon } from "@/lib/srd/weapons";
import type { MagicItemEffect } from "@/lib/srd/magic-items";
import type { SpellMech } from "@/lib/srd/spell-mechanics";
import type { HomebrewKind } from "@/lib/schemas/homebrew";

// What a homebrew entry means to the engine.
//
// homebrew_entries has always been a loose blob the pickers could search and
// nothing else could read. This module is the other half: the structured
// fields an item, a spell or a character option carries so the same engines
// that run SRD gear run it too, and the one place those fields are checked.
//
// A weapon here is an SrdWeapon, an armour an SrdArmor, a magic item's
// effects the same MagicItemEffect vocabulary magic-items.json uses. No
// second vocabulary on purpose: the armour engine, the attack profile and
// the rider aggregator all read the SRD shapes and never learn a new one.
//
// The snapshot (HomebrewGear) rides on the equipment line of a sheet, in the
// same way a monster's stat block is snapshotted into stat_json when a fight
// starts, and is refreshed from the entry whenever the sheet is read
// (src/lib/db/sheets.ts). So the pure engines take no user id, and an
// item edited in the workshop reaches every sheet that carries it.
//
// Pure by design: no DB and no I/O, so scripts/test-homebrew-gear.mjs drives
// it directly.

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

export const GEAR_LIMITS = {
  descMax: 8_000,
  effectsMax: 6,
  bonusMax: 5,
  acMin: 10,
  acMax: 21,
  shieldMax: 5,
  weightMax: 10_000,
  chargesMax: 50,
} as const;

export type HomebrewMagic = { requiresAttunement: boolean; effects: MagicItemEffect[] };

export type HomebrewGear = {
  weapon?: SrdWeapon;
  armor?: SrdArmor;
  magic?: HomebrewMagic;
  weight?: number;
};

type Raw = Record<string, unknown>;
// What a stored entry's data blob looks like after normalization: whatever
// the kind carries, and always a description.
export type HomebrewData = Raw & { desc: string };

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function num(value: unknown): number | null {
  const number =
    typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = num(value);
  return number === null ? fallback : Math.min(max, Math.max(min, Math.round(number)));
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

// ---- items ----

export type Outcome<T> = { data: T } | { error: string };

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
  const properties = Array.isArray(source.properties)
    ? [...new Set(source.properties.map((p) => String(p).trim().toLowerCase()).filter((p) => (WEAPON_PROPERTIES as readonly string[]).includes(p)))]
    : [];
  const kind = oneOf(source.kind, ["melee", "ranged"] as const, "melee");
  const rangeFt = num(source.rangeFt);
  return {
    data: {
      name,
      category: oneOf(source.category, WEAPON_CATEGORIES, "simple"),
      kind,
      damage,
      ...(properties.length ? { properties } : {}),
      ...(rangeFt !== null && rangeFt > 0 ? { rangeFt: Math.min(600, Math.round(rangeFt)) } : {}),
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
    const chargesMax = num((source.charges as Raw | undefined)?.max);
    if (chargesMax !== null && chargesMax > 0) {
      data.charges = {
        max: Math.min(GEAR_LIMITS.chargesMax, Math.round(chargesMax)),
        recharge: text((source.charges as Raw).recharge, 80) || "dawn",
      };
    }
  }
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
  const effects = normalizeEffects(source.effects);
  if (effects.length) {
    gear.magic = { requiresAttunement: source.requiresAttunement === true, effects };
  }
  const weight = num(source.weight);
  if (weight !== null && weight >= 0) {
    gear.weight = weight;
  }
  return Object.keys(gear).length ? gear : null;
}

// ---- spells ----

const RESOLUTIONS = ["attack", "save", "auto", "heal", "buff", "summon", "utility"] as const;

export function normalizeSpellMech(raw: unknown): SpellMech | null {
  const source = (raw ?? {}) as Raw;
  if (!RESOLUTIONS.includes(source.resolution as (typeof RESOLUTIONS)[number])) {
    return null;
  }
  const mech: SpellMech = { resolution: source.resolution as SpellMech["resolution"] };
  if (ABILITIES.includes(source.save as (typeof ABILITIES)[number])) {
    mech.save = source.save as SpellMech["save"];
  }
  if (source.halfOnSave === true) {
    mech.halfOnSave = true;
  }
  const damageType = text(source.damageType, 30).toLowerCase();
  if (damageType) {
    mech.damageType = damageType;
  }
  const condition = source.condition as Raw | undefined;
  const conditionName = text(condition?.name, 40);
  if (conditionName) {
    mech.condition = {
      name: conditionName.toLowerCase(),
      ...(num(condition?.rounds) !== null ? { rounds: clamp(condition?.rounds, 1, 6000, 10) } : {}),
      ...(condition?.saveEnds === true ? { saveEnds: true } : {}),
    };
  }
  const buff = source.buff as Raw | undefined;
  const buffName = text(buff?.condition, 40);
  if (buffName) {
    mech.buff = {
      condition: buffName.toLowerCase(),
      target: oneOf(buff?.target, ["self", "ally", "allies"] as const, "self"),
      rounds: clamp(buff?.rounds, 1, 6000, 10),
    };
  }
  const note = text(source.note, 200);
  if (note) {
    mech.note = note;
  }
  return mech;
}

export function normalizeSpellData(raw: unknown): Outcome<HomebrewData> {
  const source = (raw ?? {}) as Raw;
  const data: HomebrewData = {
    desc: text(source.desc, GEAR_LIMITS.descMax),
    higher_level: text(source.higher_level, 2_000),
    level: clamp(source.level, 0, 9, 1),
    school: text(source.school, 40).toLowerCase(),
    classes: Array.isArray(source.classes)
      ? [...new Set(source.classes.map((c) => String(c).trim().toLowerCase()).filter(Boolean))].slice(0, 20)
      : [],
    ritual: source.ritual === true,
    concentration: source.concentration === true,
    casting_time: text(source.casting_time, 60) || "1 action",
    range: text(source.range, 60) || "60 feet",
    components: text(source.components, 120) || "V, S",
    duration: text(source.duration, 60) || "Instantaneous",
  };
  if (!data.desc) {
    return { error: "A spell needs a description; the engine reads its damage and save out of it." };
  }
  const mech = normalizeSpellMech(source.mech);
  if (mech) {
    if (mech.resolution === "save" && !mech.save) {
      return { error: "A spell that calls for a save has to say which ability saves." };
    }
    data.mech = mech;
  }
  return { data };
}

// ---- character options ----

function normalizeOptionData(raw: unknown, kind: HomebrewKind): HomebrewData {
  const source = (raw ?? {}) as Raw;
  const data: HomebrewData = { desc: text(source.desc, GEAR_LIMITS.descMax) };
  switch (kind) {
    case "feat":
      data.prerequisite = text(source.prerequisite, 200);
      break;
    case "background":
      // The Open5e field names, because that is what the builder reads
      // (skillsInText over skill_proficiencies).
      data.skill_proficiencies = text(source.skill_proficiencies, 200);
      data.tool_proficiencies = text(source.tool_proficiencies, 200);
      data.languages = text(source.languages, 200);
      data.equipment = text(source.equipment, 500);
      data.feature = text(source.feature, 80);
      data.feature_desc = text(source.feature_desc, 2_000);
      break;
    case "race": {
      data.traits = text(source.traits, 4_000);
      data.size = text(source.size, 40) || "Medium";
      data.speed = { walk: clamp((source.speed as Raw | undefined)?.walk, 5, 120, 30) };
      data.languages = text(source.languages, 300);
      data.vision = text(source.vision, 120);
      const asi: Array<{ attributes: string[]; value: number }> = [];
      if (Array.isArray(source.asi)) {
        for (const entry of source.asi.slice(0, 6)) {
          const row = (entry ?? {}) as Raw;
          const attributes = Array.isArray(row.attributes)
            ? row.attributes.map((a) => String(a).trim()).filter(Boolean).slice(0, 6)
            : [];
          const value = clamp(row.value, -2, 3, 1);
          if (attributes.length && value !== 0) {
            asi.push({ attributes, value });
          }
        }
      }
      data.asi = asi;
      break;
    }
    case "archetype": {
      data.classSlug = text(source.classSlug, 60).toLowerCase();
      const levels: Record<string, Array<{ n: string; d: string }>> = {};
      const rawLevels = (source.levels ?? {}) as Raw;
      for (const [level, features] of Object.entries(rawLevels)) {
        // A level outside the game is dropped, not pulled to 20.
        const at = num(level);
        if (at === null || at < 1 || at > 20 || !Array.isArray(features)) {
          continue;
        }
        const rows = features
          .map((feature) => {
            const row = (feature ?? {}) as Raw;
            return { n: text(row.n, 80), d: text(row.d, 500) };
          })
          .filter((feature) => feature.n)
          .slice(0, 6);
        if (rows.length) {
          levels[String(at)] = rows;
        }
      }
      data.levels = levels;
      break;
    }
    default:
      break;
  }
  return data;
}

// Every kind through one door, so the route and the editor agree on what a
// stored entry looks like. Unknown keys are dropped: the blob used to be
// loose, and a shape nothing reads is a shape nothing can validate.
export function normalizeHomebrewData(
  kind: HomebrewKind,
  raw: unknown,
  name: string,
): Outcome<HomebrewData> {
  switch (kind) {
    case "item":
      return normalizeItemData(raw, name);
    case "spell":
      return normalizeSpellData(raw);
    case "monster": {
      // The bestiary owns monsters (src/lib/bestiary/monster-draft.ts).
      const source = (raw ?? {}) as Raw;
      return { data: { ...source, desc: text(source.desc, GEAR_LIMITS.descMax) } };
    }
    default:
      return { data: normalizeOptionData(raw, kind) };
  }
}

// One line for a row in a list: "martial melee, 1d8 slashing, versatile".
export function describeHomebrew(kind: HomebrewKind, data: Raw): string {
  if (kind === "item") {
    const weapon = data.weapon as SrdWeapon | undefined;
    const armor = data.armor as SrdArmor | undefined;
    const effects = (data.effects as MagicItemEffect[] | undefined) ?? [];
    const parts: string[] = [];
    if (weapon) {
      parts.push(`${weapon.category} ${weapon.kind}`, weapon.damage, ...(weapon.properties ?? []));
    }
    if (armor) {
      parts.push(
        armor.category === "shield" ? `shield +${armor.baseAc}` : `${armor.category} armour, AC ${armor.baseAc}`,
      );
    }
    for (const effect of effects) {
      parts.push(describeEffect(effect));
    }
    if (data.requiresAttunement) {
      parts.push("attunement");
    }
    if (typeof data.rarity === "string" && data.rarity) {
      parts.push(String(data.rarity));
    }
    return parts.join(", ") || String(data.itemKind ?? "gear");
  }
  if (kind === "spell") {
    const level = Number(data.level ?? 0);
    const mech = data.mech as SpellMech | undefined;
    return [
      level === 0 ? "cantrip" : `level ${level}`,
      String(data.school ?? ""),
      mech ? mech.resolution : "",
      data.concentration ? "concentration" : "",
    ]
      .filter(Boolean)
      .join(", ");
  }
  if (kind === "archetype") {
    const levels = Object.keys((data.levels as Raw | undefined) ?? {});
    return [String(data.classSlug ?? ""), levels.length ? `${levels.length} feature levels` : ""]
      .filter(Boolean)
      .join(", ");
  }
  if (kind === "race") {
    return [String(data.size ?? ""), `speed ${(data.speed as Raw | undefined)?.walk ?? 30}`].join(", ");
  }
  if (kind === "background") {
    return String(data.skill_proficiencies ?? "");
  }
  if (kind === "feat") {
    return data.prerequisite ? `needs ${String(data.prerequisite)}` : "";
  }
  return "";
}

export function describeEffect(effect: MagicItemEffect): string {
  switch (effect.kind) {
    case "ac_bonus":
      return `AC ${effect.amount >= 0 ? "+" : ""}${effect.amount}`;
    case "ac_unarmored":
      return `AC ${effect.amount >= 0 ? "+" : ""}${effect.amount} unarmoured`;
    case "save_bonus":
      return `saves ${effect.amount >= 0 ? "+" : ""}${effect.amount}`;
    case "set_ability":
      return `${effect.ability.toUpperCase()} becomes ${effect.score}`;
    case "resistance":
      return `resists ${effect.types.join(", ")}`;
  }
}
