// Magic weapons and armor as the attack and armor engines read them: the
// mundane item each is built on and the numbers its text adds, from the rows
// scripts/generate-magic-items.mjs writes into magic-items.json (the base
// from the pack row's category, the riders from the authored table in
// scripts/lib/magic-item-riders.mjs).
//
// Kept apart from magic-items.ts, and importing nothing but the tables, so
// the armor engine (armor.ts, which magic-items.ts itself imports) can read it
// without a cycle. Pure: the builder runs it in the browser.

import magicItemsJson from "@/lib/classes/magic-items.json";
import { textKey } from "@/lib/language/text-logic";
import { rowName, type RowItem } from "@/lib/srd/item-row";
import { armorSpellings, SRD_ARMOR } from "@/lib/srd/armor-table";
import { SRD_WEAPONS } from "@/lib/srd/weapons";

// Extra dice a magic weapon adds to a hit. `type` "weapon" is the weapon's
// own damage type; `vs` limits it to those creature types, `notVs` keeps it
// from them, `ranged` to a ranged attack.
export type GearDice = {
  dice: string;
  type: string;
  vs?: string[];
  notVs?: string[];
  ranged?: boolean;
};

export type WeaponRiders = {
  bonus?: number;
  bonusVs?: { types: string[]; bonus: number };
  damageType?: string;
  properties?: string[];
  rangeFt?: number;
  longRangeFt?: number;
  extra?: GearDice[];
  critExtra?: GearDice[];
};

export type ArmorRiders = {
  bonus?: number;
  noStrength?: boolean;
  noStealthPenalty?: boolean;
  proficientAnyway?: boolean;
  critProof?: boolean;
};

export type ChargeRule = {
  // A number, or dice rolled the first time the item is used (Luck Blade).
  max: number | string;
  // Dice regained at dawn, "all", or absent for an item that never refills.
  regain?: string;
  // Spending the last charge rolls a d20; on a 1 the item is destroyed.
  lastChargeD20?: boolean;
  // The item is gone (or no longer magic) once the last charge is spent.
  spentAway?: boolean;
  // A once-a-day power tracked as one charge: what it does.
  daily?: string;
};

export type GearDef = {
  name: string;
  match: string;
  slugs?: string[];
  aliases?: string[];
  requiresAttunement: boolean;
  // `any`: the family the SRD's entry names ("any sword", "medium or
  // heavy"), when the item may be built on more than one base; `name` is
  // the one it is built on when nothing says which.
  base?: { kind: "weapon" | "armor"; name: string; any?: string };
  weapon?: WeaponRiders;
  armor?: ArmorRiders;
  charges?: ChargeRule;
  // Attuning curses the wearer: the attunement holds until remove curse.
  cursed?: boolean;
};

const ROWS = (magicItemsJson as { items: GearDef[] }).items;

const byKey = new Map<string, GearDef>();
const bySlug = new Map<string, GearDef>();
for (const row of ROWS) {
  for (const name of [row.name, ...(row.aliases ?? [])]) {
    const key = textKey(name);
    if (!byKey.has(key)) {
      byKey.set(key, row);
    }
  }
  for (const slug of row.slugs ?? []) {
    bySlug.set(slug, row);
  }
}

function exact(name: string): GearDef | null {
  const bare = name.trim().replace(/^\+\d\s+/, "");
  return byKey.get(textKey(bare)) ?? byKey.get(textKey(bare.replace(/\s*\([^()]*\)\s*$/, ""))) ?? null;
}

// The bases each family of the SRD's entries allows (SRD 5.1, Magic Items:
// "Weapon (any sword)", "Armor (medium or heavy, but not hide)"). Swords are
// the weapons a sword's name says, the rapier and the scimitar; the setting
// weapons and armor are no SRD base. The pack prints two families short of
// the SRD's text: Adamantine and Mithral Armor drop "but not hide", and
// Armor of Resistance is "light, medium, or heavy", not "light".
const SWORDS = ["Greatsword", "Longsword", "Rapier", "Scimitar", "Shortsword"];
const AXES = ["Battleaxe", "Greataxe", "Handaxe"];
const SRD_WEAPON_NAMES = () => SRD_WEAPONS.filter((weapon) => weapon.category === "simple" || weapon.category === "martial").map((weapon) => weapon.name);
const SUITS = (keep: (armor: (typeof SRD_ARMOR)[number]) => boolean) =>
  SRD_ARMOR.filter((armor) => !armor.genres && armor.category !== "shield" && keep(armor)).map((armor) => armor.name);
const FAMILY_BASES: Record<string, () => string[]> = {
  any: SRD_WEAPON_NAMES,
  "any sword": () => SWORDS,
  "any sword that deals slashing damage": () => ["Greatsword", "Longsword", "Scimitar"],
  "any axe": () => AXES,
  "any axe or sword": () => [...AXES, ...SWORDS],
  "shortbow or longbow": () => ["Shortbow", "Longbow"],
  "medium or heavy": () => SUITS((armor) => armor.category !== "light" && armor.name !== "Hide"),
  light: () => SUITS(() => true),
};

// A magic weapon or armor named with the mundane item it is built on, in the
// SRD's own composite forms: the row's family word at either end replaced by
// the base ("Vicious Rapier", "Mithral Half Plate", "Chain Mail of Fire
// Resistance", "Vorpal Scimitar"), the base after the row ("Flame Tongue
// Scimitar") or in brackets ("Frost Brand (Greatsword)"); a suit in the ways
// the armor table writes it ("Plate Armor of Fire Resistance"). Each is an exact pair of
// listed names, keyed by textKey to the row built on that base, for the rows
// whose entry lets the base vary and only the bases its family allows: a
// Dagger of Venom is a dagger and nothing else. A table in another language
// names it by this English composite in srdName. Built on first use, since
// the weapon table's module reads this one.
type CompositeGear = { name: string; def: GearDef };

const FAMILY_WORDS = new Set(["weapon", "armor", "sword", "axe"]);
let byComposite: Map<string, CompositeGear> | null = null;

function composites(): Map<string, CompositeGear> {
  if (byComposite) {
    return byComposite;
  }
  byComposite = new Map();
  for (const row of ROWS) {
    // The "Weapon, +1, +2, or +3" family is no one item to build on a base.
    const family = row.base?.any ? FAMILY_BASES[row.base.any] : undefined;
    if (!row.base || !family || /\+\d/.test(row.name)) {
      continue;
    }
    const kind = row.base.kind;
    for (const name of [row.name, ...(row.aliases ?? [])]) {
      const words = name.split(" ");
      for (const base of family()) {
        const def = { ...row, base: { kind, name: base } };
        for (const spelled of kind === "armor" ? armorSpellings(base) : [base]) {
          const swapped = [0, words.length - 1]
            .filter((at) => FAMILY_WORDS.has(textKey(words[at])))
            .map((at) => words.map((word, index) => (index === at ? spelled : word)).join(" "));
          for (const composite of [...swapped, `${name} ${spelled}`, `${name} (${spelled})`]) {
            const key = textKey(composite);
            if (!byKey.has(key) && !byComposite.has(key)) {
              byComposite.set(key, { name: composite, def });
            }
          }
        }
      }
    }
  }
  return byComposite;
}

// The composite a name is, whole: "Flame Tongue Scimitar" is the Flame Tongue
// built on a scimitar.
export function compositeGearNamed(name: string): CompositeGear | null {
  return composites().get(textKey(name)) ?? null;
}

// The magic item a sheet row is, by its row (src/lib/srd/item-row.ts): a
// row of the table by its slug or its whole name, else a composite, whose
// entry comes back built on the base it names. A name that holds a row's
// among other words is none: a "Longsword of Warning" the table does not
// know stays a longsword.
export function gearDefFor(item: RowItem): GearDef | null {
  return lookUp(rowName(item), item.slug);
}

// The same for a name nobody carries: an attack's weapon, a catalog entry.
export function gearDefNamed(name: string): GearDef | null {
  return lookUp(name, null);
}

// The slug first, then the composite, whose base in brackets is no note
// ("Frost Brand (Greatsword)"), then the row by its whole name.
function lookUp(name: string, slug: string | null | undefined): GearDef | null {
  return (slug ? bySlug.get(slug.trim().toLowerCase()) : undefined) ?? compositeGearNamed(name)?.def ?? exact(name);
}

// Whether the riders of this row count for the one holding it: an item that
// asks for attunement gives its magic only to someone attuned. The base item
// is a weapon or a suit either way.
export function gearRidersActive(def: GearDef, item: { attuned?: boolean }): boolean {
  return !def.requiresAttunement || item.attuned === true;
}

// The row a carried equipment line runs as: its own workshop block when it
// carries one (src/lib/homebrew/item-data.ts snapshots it onto the line),
// else the table's row for its name. Every engine that asks what a carried
// item's magic is asks here, so a homebrew Flame Tongue burns like the SRD's.
type RowGear = { def?: Omit<GearDef, "name" | "match"> };

export function gearDefOfRow(item: RowItem & { gear?: unknown }): GearDef | null {
  const own = (item.gear as RowGear | undefined)?.def;
  if (own && typeof own === "object") {
    return { ...own, name: item.name, match: `homebrew ${textKey(item.name)}` };
  }
  return gearDefFor(item);
}
