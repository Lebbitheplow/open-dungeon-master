// What a magic item on a character's sheet actually does.
//
// Batch 1 tracked attunement (a 3-slot cap) but nothing read it, because no
// item had mechanics. This is that table: the SRD magic items whose effect
// is mechanical and parseable, generated from the content pack by
// scripts/generate-magic-items.mjs into magic-items.json and loaded here.
//
// Pure and data-driven like armor.ts, so the AC engine works the same on the
// server and in the character builder.
//
// The rules an item's effect has to pass, all from SRD 5.1, "Magic Items":
//   - the row IS that item: its name or its pack slug, never a fragment of
//     one ("Pouch" is not a Pouch of Runestones);
//   - it is worn or held, unless its own text says it works from the pack
//     ("while the sword is on your person"), and its place on the body lets
//     it count: one cloak, one pair of boots, one pair of bracers at a time
//     (src/lib/srd/wear-slots.ts, issue 412);
//   - if it asks for attunement, the wearer is attuned to it, and is someone
//     its text lets attune (a Staff of Power: a sorcerer, warlock or wizard);
//   - a second copy of the same item adds nothing.

import magicItemsJson from "@/lib/classes/magic-items.json";
import { ATTUNEMENT_SLOTS, attunementSlotsFor } from "@/lib/srd/armor";
import { countsAsWorn } from "@/lib/srd/wear-slots";
import type { Ability } from "@/lib/schemas/sheet";
import type { ItemTag } from "@/lib/schemas/item-tags";
import { textKey } from "@/lib/language/text-logic";
import { magicItemBonus, rowName, type RowItem } from "@/lib/srd/item-row";
import { compositeGearNamed } from "@/lib/srd/magic-gear";
import { isNamed } from "@/lib/srd/feature-names";
import { alignmentIs } from "@/lib/srd/alignment";

// The minimal item shape the magic-item engine reads: a name and its worn
// state. The full EquipmentItem satisfies this. `gear.magic` is a homebrew
// item's snapshotted effects (src/lib/homebrew/gear.ts), written in the
// same vocabulary as magic-items.json so nothing below has to know which
// kind it is reading.
export type WornMagicItem = {
  name: string;
  slug?: string;
  srdName?: string;
  equipped?: boolean;
  attuned?: boolean;
  // Waiting on the short rest attuning takes; holds one of the three places.
  attuning?: boolean;
  gear?: { magic?: { requiresAttunement: boolean; effects: MagicItemEffect[] }; tags?: readonly ItemTag[] };
};

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

// The effects above, which a workshop item can carry too, and the ones only
// the SRD table writes (scripts/generate-magic-items.mjs and its
// corrections), which the sheet's stored homebrew block never holds.
export type TableItemEffect =
  | MagicItemEffect
  // Raises a score by `amount`, never past `max` (Belt of Dwarvenkind, the
  // Ioun Stones of Agility to Strength: "increases by 2, to a maximum of 20").
  | { kind: "increase_ability"; ability: Ability; amount: number; max: number }
  // A bonus to spell attack rolls (Staff of Power, Wand of the War Mage) and
  // to the spell save DC (Robe of the Archmagi). "named": the +N the sheet
  // row's own name carries ("+2 Wand of the War Mage"). `classes`: only for
  // these classes (a Talisman of Pure Good's good cleric or paladin).
  | { kind: "spell_attack_bonus"; amount: number | "named"; classes?: string[] }
  | { kind: "spell_dc_bonus"; amount: number }
  // Advantage on saving throws against spells (Mantle of Spell Resistance).
  | { kind: "spell_save_advantage" }
  // Damage and condition immunities (Periapt of Proof against Poison).
  | { kind: "immunity"; types: string[] }
  | { kind: "condition_immunity"; conditions: string[] }
  // A flying, swimming or climbing speed in feet, or "walk" for one equal to
  // the walking speed (Winged Boots, Ring of Swimming).
  | { kind: "speed"; mode: "fly" | "swim" | "climb"; feet: number | "walk" }
  // Weapon training and damage the item adds to attacks with these weapons,
  // on a ranged attack only when `ranged` (Bracers of Archery).
  | { kind: "weapon_rider"; weapons: string[]; ranged?: boolean; damage?: number; proficient?: boolean };

// A worn item's rider on attacks with some weapons, with the item it is from.
export type WornWeaponRider = { weapons: string[]; ranged?: boolean; damage?: number; proficient?: boolean; source: string };

// Who an item lets attune, read from the pack's "requires attunement by ..."
// line. `text` is that line's own wording, for the refusal.
export type AttunementRule = {
  text: string;
  classes?: string[];
  spellcaster?: boolean;
  alignment?: string;
  race?: string;
};

export type MagicItemDef = {
  name: string;
  match: string;
  slugs?: string[];
  aliases?: string[];
  requiresAttunement: boolean;
  attunedBy?: AttunementRule;
  // Works from the pack: the item's text asks only that it be on the person.
  carried?: boolean;
  effects: TableItemEffect[];
};

// What the engine needs to know about whoever carries the item. Every field
// is optional: a caller with no sheet to hand (the builder's preview of a
// bare equipment list) passes nothing and no restriction is judged.
export type Wearer = {
  // A Potion of Giant Strength's "giant strength (21)" lasts on the sheet as
  // a timed condition (src/lib/dm/consumables.ts).
  conditions?: string[];
  class?: string;
  level?: number;
  classes?: Array<{ id: string; level?: number }>;
  race?: string;
  alignment?: string;
  spellcasting?: unknown;
  // Use Magic Device (Thief 13) ignores class, race and level requirements.
  features?: Array<{ name: string }>;
};

const MAGIC_ITEMS = (magicItemsJson as { items: MagicItemDef[] }).items;

// "Ring of Resistance (Fire)", "ring  of resistance fire" and the pack's
// curly apostrophes all land on one key.
const byKey = new Map<string, MagicItemDef>();
const bySlug = new Map<string, MagicItemDef>();
for (const item of MAGIC_ITEMS) {
  for (const name of [item.name, ...(item.aliases ?? [])]) {
    const key = textKey(name);
    if (!byKey.has(key)) {
      byKey.set(key, item);
    }
  }
  for (const slug of item.slugs ?? []) {
    bySlug.set(slug, item);
  }
}

// The magic item a sheet entry is, if any: by its pack slug, or by its row's
// name (src/lib/srd/item-row.ts).
export function matchMagicItem(item: RowItem): MagicItemDef | null {
  if (item.slug) {
    const known = bySlug.get(item.slug.trim().toLowerCase());
    if (known) {
      return known;
    }
  }
  return magicItemNamed(rowName(item));
}

// The magic item a name names, if any: its whole name, case and spacing
// aside, or a composite the magic gear table knows ("Chain Mail of Fire
// Resistance" is Armor of Fire Resistance, src/lib/srd/magic-gear.ts). A "+1"
// in front and a note in brackets behind ("Ring of Protection (spare)") are
// the owner's words about the item and not part of its name. Nothing matches
// on a fragment.
export function magicItemNamed(name: string): MagicItemDef | null {
  const bare = name.trim().replace(/^\+\d\s+/, "");
  const whole = byKey.get(textKey(bare)) ?? byKey.get(textKey(compositeGearNamed(bare)?.def.name ?? ""));
  if (whole) {
    return whole;
  }
  const withoutNote = bare.replace(/\s*\([^()]*\)\s*$/, "");
  return withoutNote !== bare ? (byKey.get(textKey(withoutNote)) ?? null) : null;
}

export type MagicItemRiders = {
  acBonus: number;
  acUnarmoredBonus: number;
  saveBonus: number;
  // Ability -> the highest score any worn item sets it to.
  abilitySet: Partial<Record<Ability, number>>;
  // Each raise a worn item gives a score, in the order worn.
  abilityIncreases: Array<{ ability: Ability; amount: number; max: number }>;
  resistances: string[];
  immunities: string[];
  conditionImmunities: Array<{ condition: string; because: string }>;
  spellAttackBonus: number;
  spellDcBonus: number;
  // The items giving advantage on saves against spells.
  spellSaveAdvantage: string[];
  speeds: Array<{ mode: "fly" | "swim" | "climb"; feet: number | "walk" }>;
  weaponRiders: WornWeaponRider[];
  // Names of the items actually contributing, for the sheet breakdown.
  sources: string[];
};

function isSpellcaster(wearer: Wearer): boolean {
  return Boolean(wearer.spellcasting);
}

// Whether this character is someone the item's text lets attune.
export function mayAttune(def: Pick<MagicItemDef, "attunedBy">, wearer: Wearer): boolean {
  const rule = def.attunedBy;
  if (!rule) {
    return true;
  }
  const device = (wearer.features ?? []).some((f) => isNamed(f.name, "Use Magic Device"));
  if (rule.classes?.length && !device) {
    const held = [textKey(wearer.class ?? ""), ...(wearer.classes ?? []).map((entry) => textKey(entry.id))];
    if (!rule.classes.some((name) => held.includes(name))) {
      return false;
    }
  }
  if (rule.spellcaster && !device && !isSpellcaster(wearer)) {
    return false;
  }
  if (rule.alignment && !alignmentIs(wearer.alignment, rule.alignment)) {
    return false;
  }
  if (rule.race && !device && !textKey(wearer.race ?? "").includes(rule.race)) {
    return false;
  }
  return true;
}

function defOf(item: WornMagicItem): MagicItemDef | null {
  return item.gear?.magic
    ? { name: item.name, match: `homebrew ${textKey(item.name)}`, ...item.gear.magic }
    : matchMagicItem(item);
}

// An item's effect counts when the item is worn (or, for the few whose text
// says so, carried) and, if it requires attunement, only while attuned by
// someone who may. This is where the 3-slot attunement cap (enforced in
// db/sheets.ts) finally earns its keep: an item past the cap is never
// attuned, so its bonus never applies.
function itemActive(
  item: WornMagicItem,
  def: MagicItemDef,
  equipment: WornMagicItem[],
  wearer: Wearer | undefined,
): boolean {
  if (!def.carried && !countsAsWorn(item, equipment)) {
    return false;
  }
  if (!def.requiresAttunement) {
    return true;
  }
  return Boolean(item.attuned) && (!wearer || mayAttune(def, wearer));
}

// Everything the sheet's magic items grant, aggregated. `wearer` is the
// sheet itself wherever one is to hand.
export function magicItemRiders(equipment: WornMagicItem[], wearer?: Wearer): MagicItemRiders {
  const riders: MagicItemRiders = {
    acBonus: 0,
    acUnarmoredBonus: 0,
    saveBonus: 0,
    abilitySet: {},
    abilityIncreases: [],
    resistances: [],
    immunities: [],
    conditionImmunities: [],
    spellAttackBonus: 0,
    spellDcBonus: 0,
    spellSaveAdvantage: [],
    speeds: [],
    weaponRiders: [],
    sources: [],
  };
  // One copy of an item is all a creature can be attuned to, and wearing two
  // of the same ring is wearing one ring's magic.
  const counted = new Set<string>();
  for (const item of equipment) {
    const def = defOf(item);
    if (!def || counted.has(def.match) || !itemActive(item, def, equipment, wearer)) {
      continue;
    }
    counted.add(def.match);
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
        case "increase_ability":
          riders.abilityIncreases.push({ ability: effect.ability, amount: effect.amount, max: effect.max });
          contributed = true;
          break;
        case "spell_attack_bonus": {
          const held = [textKey(wearer?.class ?? ""), ...(wearer?.classes ?? []).map((entry) => textKey(entry.id))];
          if (effect.classes && wearer && !effect.classes.some((name) => held.includes(name))) {
            break;
          }
          // A Wand of the War Mage named with no +N gives no number to add.
          riders.spellAttackBonus += effect.amount === "named" ? magicItemBonus(item.name) : effect.amount;
          contributed = true;
          break;
        }
        case "spell_dc_bonus":
          riders.spellDcBonus += effect.amount;
          contributed = true;
          break;
        case "spell_save_advantage":
          riders.spellSaveAdvantage.push(item.name);
          contributed = true;
          break;
        case "immunity":
          riders.immunities.push(...effect.types);
          contributed = true;
          break;
        case "condition_immunity":
          riders.conditionImmunities.push(...effect.conditions.map((condition) => ({ condition, because: item.name })));
          contributed = true;
          break;
        case "speed":
          riders.speeds.push({ mode: effect.mode, feet: effect.feet });
          contributed = true;
          break;
        case "weapon_rider":
          riders.weaponRiders.push({ weapons: effect.weapons, ranged: effect.ranged, damage: effect.damage, proficient: effect.proficient, source: item.name });
          contributed = true;
          break;
      }
    }
    if (contributed) {
      riders.sources.push(item.name);
    }
  }
  riders.resistances = [...new Set(riders.resistances)];
  riders.immunities = [...new Set(riders.immunities)];
  return riders;
}

// The flying, swimming and climbing speeds worn items give, in feet, the
// best of each; `walking` is the wearer's walking speed, for the items whose
// speed equals it (SRD 5.1, Winged Boots: "a flying speed equal to your
// walking speed").
export function itemSpeeds(
  equipment: WornMagicItem[],
  wearer: Wearer | undefined,
  walking: number,
): { fly?: number; swim?: number; climb?: number } {
  const out: { fly?: number; swim?: number; climb?: number } = {};
  for (const speed of magicItemRiders(equipment, wearer).speeds) {
    out[speed.mode] = Math.max(out[speed.mode] ?? 0, speed.feet === "walk" ? walking : speed.feet);
  }
  return out;
}

// A character's ability scores after any worn ability-setting item raises
// them (a score already higher is untouched, per the SRD). This is the one
// magic-item effect that ripples through every derived number, so it is
// applied once here and read by computeSheetDerived.
export function effectiveAbilities(
  abilities: Record<Ability, number>,
  equipment: WornMagicItem[],
  wearer?: Wearer,
): Record<Ability, number> {
  const riders = magicItemRiders(equipment, wearer);
  const set = { ...riders.abilitySet };
  // "Your Constitution score increases by 2, to a maximum of 20" (SRD 5.1,
  // Belt of Dwarvenkind): a score at the maximum already gains nothing. The
  // raises count from the sheet's own score, and an item that sets the score
  // (an Amulet of Health's 19) wins only where it is higher still.
  let raised = abilities;
  for (const increase of riders.abilityIncreases) {
    const score = raised[increase.ability];
    if (score < increase.max) {
      raised = { ...raised, [increase.ability]: Math.min(increase.max, score + increase.amount) };
    }
  }
  // A Potion of Giant Strength sets Strength for an hour, like the belt.
  for (const condition of wearer?.conditions ?? []) {
    const potion = /^giant strength \((\d+)\)$/i.exec(condition.trim());
    if (potion) {
      set.str = Math.max(set.str ?? 0, Math.min(30, Number(potion[1])));
    }
  }
  if (!Object.keys(set).length) {
    return raised;
  }
  const out = { ...raised };
  for (const [ability, score] of Object.entries(set) as Array<[Ability, number]>) {
    out[ability] = Math.max(out[ability], score);
  }
  return out;
}

// One score after the worn items alone, for the engines that read a single
// score off the stored sheet: carrying capacity's Strength, the hit point
// maximum's Constitution.
export function itemAbilityScore(
  ability: Ability,
  score: number,
  equipment: WornMagicItem[],
  wearer?: Wearer,
): number {
  const riders = magicItemRiders(equipment, wearer);
  let out = score;
  for (const increase of riders.abilityIncreases) {
    if (increase.ability === ability && out < increase.max) {
      out = Math.min(increase.max, out + increase.amount);
    }
  }
  return Math.max(out, riders.abilitySet[ability] ?? 0);
}

// ---- attunement ----

// Why this character cannot attune to this row, as one sentence a player can
// act on, or null when they can. `equipment` is the pack as it stands before
// the change; the three-slot cap is judged here too so every door gives the
// same answer. With no wearer to judge by (null), who may attune is not asked.
export function attunementProblem(
  item: WornMagicItem,
  equipment: WornMagicItem[],
  wearer: (Wearer & { name?: string }) | null,
): string | null {
  const who = wearer?.name ?? "This character";
  const def = defOf(item);
  const cap = attunementSlotsFor(wearer);
  if (def && !def.requiresAttunement) {
    return `${item.name} needs no attunement: it works for whoever wears it, and takes none of the ${cap} attunements.`;
  }
  if (def && wearer && !mayAttune(def, wearer)) {
    return `${item.name} can be attuned only by ${def.attunedBy?.text ?? "someone else"}, and ${who} is not one.`;
  }
  // An attunement still waiting on its short rest holds its place too.
  const others = equipment.filter((entry) => entry !== item && (entry.attuned || entry.attuning));
  if (def && others.some((entry) => defOf(entry)?.match === def.match)) {
    return `${who} is already attuned to a ${def.name}, and a creature attunes to one copy of an item at most.`;
  }
  if (others.length >= cap) {
    return `${who} is attuned to ${cap} items already, which is the most ${cap > ATTUNEMENT_SLOTS ? "they" : "a creature"} can hold; end one attunement first.`;
  }
  return null;
}

// The pack with every attunement the rules deny taken off: an item that needs
// none, one its text keeps from this character, a second copy, and anything
// past the third. Earlier rows keep their attunement, as the cap always did.
export function settleAttunement<T extends WornMagicItem>(
  equipment: T[],
  wearer: Wearer | null = null,
): T[] {
  const kept: T[] = [];
  return equipment.map((item) => {
    if (!item.attuned) {
      return item;
    }
    if (attunementProblem(item, kept, wearer) !== null) {
      return { ...item, attuned: false };
    }
    kept.push(item);
    return item;
  });
}
