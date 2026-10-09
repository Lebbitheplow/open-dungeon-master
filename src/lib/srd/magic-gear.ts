// Magic weapons and armor as the attack and armor engines read them: the
// mundane item each is built on and the numbers its text adds, from the rows
// scripts/generate-magic-items.mjs writes into magic-items.json (the base
// from the pack row's category, the riders from the authored table in
// scripts/lib/magic-item-riders.mjs).
//
// Kept apart from magic-items.ts, and importing nothing but the table, so the
// armor engine (armor.ts, which magic-items.ts itself imports) can read it
// without a cycle. Pure: the builder runs it in the browser.

import magicItemsJson from "@/lib/classes/magic-items.json";

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
  base?: { kind: "weapon" | "armor"; name: string };
  weapon?: WeaponRiders;
  armor?: ArmorRiders;
  charges?: ChargeRule;
  // Attuning curses the wearer: the attunement holds until remove curse.
  cursed?: boolean;
};

const ROWS = (magicItemsJson as { items: GearDef[] }).items;

function keyOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'À-ɏ]+/g, " ")
    .trim();
}

const byKey = new Map<string, GearDef>();
const bySlug = new Map<string, GearDef>();
for (const row of ROWS) {
  for (const name of [row.name, ...(row.aliases ?? [])]) {
    const key = keyOf(name);
    if (!byKey.has(key)) {
      byKey.set(key, row);
    }
  }
  for (const slug of row.slugs ?? []) {
    bySlug.set(slug, row);
  }
}

function exact(name: string, slug?: string | null): GearDef | null {
  if (slug) {
    const known = bySlug.get(slug.trim().toLowerCase());
    if (known) {
      return known;
    }
  }
  const bare = name.trim().replace(/^\+\d\s+/, "");
  return byKey.get(keyOf(bare)) ?? byKey.get(keyOf(bare.replace(/\s*\([^()]*\)\s*$/, ""))) ?? null;
}

// The magic item a sheet row names, where the name may also say which
// mundane item it is built on: "Flame Tongue Scimitar", "Frost Brand
// (Greatsword)", "Mithral Half Plate", "Vicious Rapier", "Chain Mail of Fire
// Resistance". `baseInName` is the weapon or armor the caller's own matcher
// found in the name; with it gone, what is left names the item. Only a row
// that is itself a magic weapon or armor is found this way, so a "Longsword
// of Warning" the table does not know stays a longsword.
export function gearDefFor(
  name: string,
  slug?: string | null,
  baseInName?: string | null,
): GearDef | null {
  const direct = exact(name, slug);
  if (direct || !baseInName) {
    return direct;
  }
  const escaped = baseInName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rest = name
    .replace(new RegExp(`\\b${escaped}\\b`, "i"), " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^,|,$/g, "")
    .trim();
  if (!rest || keyOf(rest) === keyOf(name)) {
    return null;
  }
  for (const candidate of [rest, `${rest} Weapon`, `${rest} Armor`, `Armor ${rest}`, `${rest} Sword`]) {
    const found = exact(candidate);
    if (found?.base) {
      return found;
    }
  }
  return null;
}

// Whether the riders of this row count for the one holding it: an item that
// asks for attunement gives its magic only to someone attuned. The base item
// is a weapon or a suit either way.
export function gearRidersActive(def: GearDef, item: { attuned?: boolean }): boolean {
  return !def.requiresAttunement || item.attuned === true;
}

// The base weapon or armor name a row's category gives, when the name did
// not give one.
export function gearBaseName(def: GearDef | null, kind: "weapon" | "armor"): string | null {
  return def?.base?.kind === kind ? def.base.name : null;
}

// The row a carried equipment line runs as: its own workshop block when it
// carries one (src/lib/homebrew/item-data.ts snapshots it onto the line),
// else the table's row for its name. Every engine that asks what a carried
// item's magic is asks here, so a homebrew Flame Tongue burns like the SRD's.
type RowGear = { def?: Omit<GearDef, "name" | "match"> };

export function gearDefOfRow(
  item: { name: string; slug?: string | null; gear?: unknown },
  baseInName?: string | null,
): GearDef | null {
  const own = (item.gear as RowGear | undefined)?.def;
  if (own && typeof own === "object") {
    return { ...own, name: item.name, match: `homebrew ${keyOf(item.name)}` };
  }
  return gearDefFor(item.name, item.slug, baseInName);
}

// Every magic item the table knows by name, for callers that list them.
export function gearDefs(): readonly GearDef[] {
  return ROWS;
}
