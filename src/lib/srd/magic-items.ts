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
//     ("while the sword is on your person");
//   - if it asks for attunement, the wearer is attuned to it, and is someone
//     its text lets attune (a Staff of Power: a sorcerer, warlock or wizard);
//   - a second copy of the same item adds nothing.

import magicItemsJson from "@/lib/classes/magic-items.json";
import { ATTUNEMENT_SLOTS, isWorn } from "@/lib/srd/armor";
import type { Ability } from "@/lib/schemas/sheet";

// The minimal item shape the magic-item engine reads: a name and its worn
// state. The full EquipmentItem satisfies this. `gear.magic` is a homebrew
// item's snapshotted effects (src/lib/homebrew/gear.ts), written in the
// same vocabulary as magic-items.json so nothing below has to know which
// kind it is reading.
export type WornMagicItem = {
  name: string;
  slug?: string;
  equipped?: boolean;
  attuned?: boolean;
  gear?: { magic?: { requiresAttunement: boolean; effects: MagicItemEffect[] } };
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
  effects: MagicItemEffect[];
};

// What the engine needs to know about whoever carries the item. Every field
// is optional: a caller with no sheet to hand (the builder's preview of a
// bare equipment list) passes nothing and no restriction is judged.
export type Wearer = {
  class?: string;
  classes?: Array<{ id: string }>;
  race?: string;
  alignment?: string;
  spellcasting?: unknown;
};

const MAGIC_ITEMS = (magicItemsJson as { items: MagicItemDef[] }).items;

// "Ring of Resistance (Fire)", "ring  of resistance fire" and the pack's
// curly apostrophes all land on one key.
function keyOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'À-ɏ]+/g, " ")
    .trim();
}

const byKey = new Map<string, MagicItemDef>();
const bySlug = new Map<string, MagicItemDef>();
for (const item of MAGIC_ITEMS) {
  for (const name of [item.name, ...(item.aliases ?? [])]) {
    const key = keyOf(name);
    if (!byKey.has(key)) {
      byKey.set(key, item);
    }
  }
  for (const slug of item.slugs ?? []) {
    bySlug.set(slug, item);
  }
}

// The magic item a sheet entry names, if any: by its pack slug, or by its
// whole name, case and spacing aside. A "+1" in front and a note in brackets
// behind ("Ring of Protection (spare)") are the owner's words about the
// item and not part of its name. Nothing matches on a fragment.
export function matchMagicItem(name: string, slug?: string | null): MagicItemDef | null {
  if (slug) {
    const known = bySlug.get(slug.trim().toLowerCase());
    if (known) {
      return known;
    }
  }
  const bare = name.trim().replace(/^\+\d\s+/, "");
  const whole = byKey.get(keyOf(bare));
  if (whole) {
    return whole;
  }
  const withoutNote = bare.replace(/\s*\([^()]*\)\s*$/, "");
  return withoutNote !== bare ? (byKey.get(keyOf(withoutNote)) ?? null) : null;
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

const lower = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

function isSpellcaster(wearer: Wearer): boolean {
  return Boolean(wearer.spellcasting);
}

// Whether this character is someone the item's text lets attune.
export function mayAttune(def: Pick<MagicItemDef, "attunedBy">, wearer: Wearer): boolean {
  const rule = def.attunedBy;
  if (!rule) {
    return true;
  }
  if (rule.classes?.length) {
    const held = [lower(wearer.class), ...(wearer.classes ?? []).map((entry) => lower(entry.id))];
    if (!rule.classes.some((name) => held.includes(name))) {
      return false;
    }
  }
  if (rule.spellcaster && !isSpellcaster(wearer)) {
    return false;
  }
  if (rule.alignment && !lower(wearer.alignment).includes(rule.alignment)) {
    return false;
  }
  if (rule.race && !lower(wearer.race).replace(/_/g, " ").includes(rule.race)) {
    return false;
  }
  return true;
}

function defOf(item: WornMagicItem): MagicItemDef | null {
  return item.gear?.magic
    ? { name: item.name, match: `homebrew ${keyOf(item.name)}`, ...item.gear.magic }
    : matchMagicItem(item.name, item.slug);
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
  if (!def.carried && !isWorn(item, equipment)) {
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
    resistances: [],
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
  wearer?: Wearer,
): Record<Ability, number> {
  const set = magicItemRiders(equipment, wearer).abilitySet;
  if (!Object.keys(set).length) {
    return abilities;
  }
  const out = { ...abilities };
  for (const [ability, score] of Object.entries(set) as Array<[Ability, number]>) {
    out[ability] = Math.max(out[ability], score);
  }
  return out;
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
  if (def && !def.requiresAttunement) {
    return `${item.name} needs no attunement: it works for whoever wears it, and takes none of the ${ATTUNEMENT_SLOTS} attunements.`;
  }
  if (def && wearer && !mayAttune(def, wearer)) {
    return `${item.name} can be attuned only by ${def.attunedBy?.text ?? "someone else"}, and ${who} is not one.`;
  }
  const others = equipment.filter((entry) => entry !== item && entry.attuned);
  if (def && others.some((entry) => defOf(entry)?.match === def.match)) {
    return `${who} is already attuned to a ${def.name}, and a creature attunes to one copy of an item at most.`;
  }
  if (others.length >= ATTUNEMENT_SLOTS) {
    return `${who} is attuned to ${ATTUNEMENT_SLOTS} items already, which is the most a creature can hold; end one attunement first.`;
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
