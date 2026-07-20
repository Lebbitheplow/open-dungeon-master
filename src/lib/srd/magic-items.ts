// What a magic item on a character's sheet actually does.
//
// Batch 1 tracked attunement (a 3-slot cap) but nothing read it, because no
// item had mechanics. This is that table: the SRD magic items whose effect
// is mechanical and parseable, generated from the content pack by
// scripts/generate-magic-items.mjs into magic-items.json and loaded here.
//
// Pure and data-driven like armor.ts, so the AC engine works the same on the
// server and in the character builder. An item that requires attunement only
// applies while it is attuned; every worn/attuned effect also needs the item
// to be carried (and, for AC, equipped where the armor engine cares).

import magicItemsJson from "@/lib/classes/magic-items.json";
import type { Ability } from "@/lib/schemas/sheet";

// The minimal item shape the magic-item engine reads: a name and its worn
// state. The full EquipmentItem satisfies this.
export type WornMagicItem = { name: string; equipped?: boolean; attuned?: boolean };

export type MagicItemEffect =
  // Flat armor class from a non-armor item (Cloak/Ring of Protection).
  | { kind: "ac_bonus"; amount: number }
  // AC only while wearing no armor and no shield (Bracers of Defense).
  | { kind: "ac_unarmored"; amount: number }
  // Flat bonus to every saving throw (Cloak/Ring of Protection).
  | { kind: "save_bonus"; amount: number }
  // Sets an ability score to `score` if it is not already higher
  // (Gauntlets of Ogre Power, Amulet of Health, Headband of Intellect).
  | { kind: "set_ability"; ability: Ability; score: number }
  // Damage resistance keywords (Ring/Armor of Resistance).
  | { kind: "resistance"; types: string[] };

type MagicItemDef = {
  name: string;
  match: string;
  requiresAttunement: boolean;
  effects: MagicItemEffect[];
};

const MAGIC_ITEMS = (magicItemsJson as { items: MagicItemDef[] }).items;
const byMatch = new Map(MAGIC_ITEMS.map((item) => [item.match, item]));

// The magic item a sheet entry names, if any. Exact match first, then a
// containment match so "Cloak of Protection of the Owl" still resolves.
export function matchMagicItem(name: string): MagicItemDef | null {
  const wanted = name.trim().toLowerCase().replace(/^\+\d\s+/, "");
  if (!wanted) {
    return null;
  }
  const exact = byMatch.get(wanted);
  if (exact) {
    return exact;
  }
  const candidates = MAGIC_ITEMS.filter(
    (item) => wanted.includes(item.match) || item.match.includes(wanted),
  );
  candidates.sort((a, b) => b.match.length - a.match.length);
  return candidates[0] ?? null;
}

export type MagicItemRiders = {
  acBonus: number;
  acUnarmoredBonus: number;
  saveBonus: number;
  // Ability -> the highest score any worn item sets it to.
  abilitySet: Partial<Record<Ability, number>>;
  resistances: string[];
  // Names of the items actually contributing, for the sheet breakdown.
  sources: string[];
};

// An item's effect counts when the item is carried, and, if it requires
// attunement, only while attuned. This is where the 3-slot attunement cap
// (enforced in db/sheets.ts) finally earns its keep: an item past the cap is
// never attuned, so its bonus never applies.
function itemActive(item: WornMagicItem, def: MagicItemDef): boolean {
  return !def.requiresAttunement || Boolean(item.attuned);
}

// Everything the sheet's magic items grant, aggregated.
export function magicItemRiders(equipment: WornMagicItem[]): MagicItemRiders {
  const riders: MagicItemRiders = {
    acBonus: 0,
    acUnarmoredBonus: 0,
    saveBonus: 0,
    abilitySet: {},
    resistances: [],
    sources: [],
  };
  for (const item of equipment) {
    const def = matchMagicItem(item.name);
    if (!def || !itemActive(item, def)) {
      continue;
    }
    let contributed = false;
    for (const effect of def.effects) {
      switch (effect.kind) {
        case "ac_bonus":
          riders.acBonus += effect.amount;
          contributed = true;
          break;
        case "ac_unarmored":
          riders.acUnarmoredBonus = Math.max(riders.acUnarmoredBonus, effect.amount);
          contributed = true;
          break;
        case "save_bonus":
          riders.saveBonus += effect.amount;
          contributed = true;
          break;
        case "set_ability":
          riders.abilitySet[effect.ability] = Math.max(
            riders.abilitySet[effect.ability] ?? 0,
            effect.score,
          );
          contributed = true;
          break;
        case "resistance":
          riders.resistances.push(...effect.types);
          contributed = true;
          break;
      }
    }
    if (contributed) {
      riders.sources.push(item.name);
    }
  }
  riders.resistances = [...new Set(riders.resistances)];
  return riders;
}

// A character's ability scores after any worn ability-setting item raises
// them (a score already higher is untouched, per the SRD). This is the one
// magic-item effect that ripples through every derived number, so it is
// applied once here and read by computeSheetDerived.
export function effectiveAbilities(
  abilities: Record<Ability, number>,
  equipment: WornMagicItem[],
): Record<Ability, number> {
  const set = magicItemRiders(equipment).abilitySet;
  if (!Object.keys(set).length) {
    return abilities;
  }
  const out = { ...abilities };
  for (const [ability, score] of Object.entries(set) as Array<[Ability, number]>) {
    out[ability] = Math.max(out[ability], score);
  }
  return out;
}
