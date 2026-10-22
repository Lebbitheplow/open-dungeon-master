// SRD 5.1 weapon table plus pure helpers that turn class weapon-proficiency
// terms (["simple","martial"] or specific names like "longswords") into
// starting-weapon picks and suggestion lists for the character builder.
// Firearm and exotic entries serve the setting-specific class catalog
// (cyberpunk, horror, steampunk...); names stay generic enough to read in
// any genre. No runtime dependencies so test scripts can import directly.

import { textKey } from "@/lib/language/text-logic";
import { pluralForms, spellingIndex } from "@/lib/srd/name-forms";
import { rowName, withoutBonus, type RowItem } from "@/lib/srd/item-row";
import { packBaseOf } from "@/lib/srd/pack-bases";
import { gearDefFor } from "@/lib/srd/magic-gear";

export type SrdWeapon = {
  name: string;
  category: "simple" | "martial" | "firearm" | "exotic";
  kind: "melee" | "ranged";
  damage: string;
  // Mechanical properties the attack engine reads (finesse, thrown,
  // ammunition, reach, ...); omitted = none.
  properties?: string[];
  // Normal range in feet for ranged and thrown weapons.
  rangeFt?: number;
  // Long range in feet: a shot past the normal range and inside this one is
  // made at disadvantage. Absent on a homebrew weapon saved before the field
  // existed, which reaches twice its normal range as it always did.
  longRangeFt?: number;
};

// SRD 5.1 long ranges by normal range. Every SRD weapon's long range is
// three or four times its normal one, so the table is written out rather
// than derived; the firearms and genre weapons follow the same pattern.
const LONG_RANGE_FT: Record<string, number> = {
  Dagger: 60, Handaxe: 60, Javelin: 120, "Light Hammer": 60, Spear: 60,
  "Light Crossbow": 320, Dart: 60, Shortbow: 320, Sling: 120, Trident: 60,
  Blowgun: 100, "Hand Crossbow": 120, "Heavy Crossbow": 400, Longbow: 600, Net: 15,
  Pistol: 150, Revolver: 180, "Sawed-off Scattergun": 90, "Hunting Rifle": 240,
  Musket: 120, "Hand Cannon": 90, Vibroknife: 60, "Silvered Stake": 60, "Hurled Vial": 60,
};

const WEAPON_ROWS: SrdWeapon[] = [

  { name: "Club", category: "simple", kind: "melee", damage: "1d4 bludgeoning", properties: ["light"] },
  { name: "Dagger", category: "simple", kind: "melee", damage: "1d4 piercing", properties: ["finesse", "light", "thrown"], rangeFt: 20 },
  { name: "Greatclub", category: "simple", kind: "melee", damage: "1d8 bludgeoning", properties: ["two-handed"] },
  { name: "Handaxe", category: "simple", kind: "melee", damage: "1d6 slashing", properties: ["light", "thrown"], rangeFt: 20 },
  { name: "Javelin", category: "simple", kind: "melee", damage: "1d6 piercing", properties: ["thrown"], rangeFt: 30 },
  { name: "Light Hammer", category: "simple", kind: "melee", damage: "1d4 bludgeoning", properties: ["light", "thrown"], rangeFt: 20 },
  { name: "Mace", category: "simple", kind: "melee", damage: "1d6 bludgeoning" },
  { name: "Quarterstaff", category: "simple", kind: "melee", damage: "1d6 bludgeoning", properties: ["versatile"] },
  { name: "Sickle", category: "simple", kind: "melee", damage: "1d4 slashing", properties: ["light"] },
  { name: "Spear", category: "simple", kind: "melee", damage: "1d6 piercing", properties: ["thrown", "versatile"], rangeFt: 20 },
  { name: "Light Crossbow", category: "simple", kind: "ranged", damage: "1d8 piercing", properties: ["ammunition", "loading", "two-handed"], rangeFt: 80 },
  { name: "Dart", category: "simple", kind: "ranged", damage: "1d4 piercing", properties: ["finesse", "thrown"], rangeFt: 20 },
  { name: "Shortbow", category: "simple", kind: "ranged", damage: "1d6 piercing", properties: ["ammunition", "two-handed"], rangeFt: 80 },
  { name: "Sling", category: "simple", kind: "ranged", damage: "1d4 bludgeoning", properties: ["ammunition"], rangeFt: 30 },
  { name: "Battleaxe", category: "martial", kind: "melee", damage: "1d8 slashing", properties: ["versatile"] },
  { name: "Flail", category: "martial", kind: "melee", damage: "1d8 bludgeoning" },
  { name: "Glaive", category: "martial", kind: "melee", damage: "1d10 slashing", properties: ["heavy", "reach", "two-handed"] },
  { name: "Greataxe", category: "martial", kind: "melee", damage: "1d12 slashing", properties: ["heavy", "two-handed"] },
  { name: "Greatsword", category: "martial", kind: "melee", damage: "2d6 slashing", properties: ["heavy", "two-handed"] },
  { name: "Halberd", category: "martial", kind: "melee", damage: "1d10 slashing", properties: ["heavy", "reach", "two-handed"] },
  { name: "Lance", category: "martial", kind: "melee", damage: "1d12 piercing", properties: ["reach"] },
  { name: "Longsword", category: "martial", kind: "melee", damage: "1d8 slashing", properties: ["versatile"] },
  { name: "Maul", category: "martial", kind: "melee", damage: "2d6 bludgeoning", properties: ["heavy", "two-handed"] },
  { name: "Morningstar", category: "martial", kind: "melee", damage: "1d8 piercing" },
  { name: "Pike", category: "martial", kind: "melee", damage: "1d10 piercing", properties: ["heavy", "reach", "two-handed"] },
  { name: "Rapier", category: "martial", kind: "melee", damage: "1d8 piercing", properties: ["finesse"] },
  { name: "Scimitar", category: "martial", kind: "melee", damage: "1d6 slashing", properties: ["finesse", "light"] },
  { name: "Shortsword", category: "martial", kind: "melee", damage: "1d6 piercing", properties: ["finesse", "light"] },
  { name: "Trident", category: "martial", kind: "melee", damage: "1d6 piercing", properties: ["thrown", "versatile"], rangeFt: 20 },
  { name: "War Pick", category: "martial", kind: "melee", damage: "1d8 piercing" },
  { name: "Warhammer", category: "martial", kind: "melee", damage: "1d8 bludgeoning", properties: ["versatile"] },
  { name: "Whip", category: "martial", kind: "melee", damage: "1d4 slashing", properties: ["finesse", "reach"] },
  { name: "Blowgun", category: "martial", kind: "ranged", damage: "1 piercing", properties: ["ammunition", "loading"], rangeFt: 25 },
  { name: "Hand Crossbow", category: "martial", kind: "ranged", damage: "1d6 piercing", properties: ["ammunition", "light", "loading"], rangeFt: 30 },
  { name: "Heavy Crossbow", category: "martial", kind: "ranged", damage: "1d10 piercing", properties: ["ammunition", "heavy", "loading", "two-handed"], rangeFt: 100 },
  { name: "Longbow", category: "martial", kind: "ranged", damage: "1d8 piercing", properties: ["ammunition", "heavy", "two-handed"], rangeFt: 150 },
  { name: "Net", category: "martial", kind: "ranged", damage: "0 (restrains)", properties: ["thrown"], rangeFt: 5 },
  { name: "Pistol", category: "firearm", kind: "ranged", damage: "1d10 piercing", properties: ["ammunition", "loading"], rangeFt: 50 },
  { name: "Revolver", category: "firearm", kind: "ranged", damage: "1d8 piercing", properties: ["ammunition"], rangeFt: 60 },
  { name: "Sawed-off Scattergun", category: "firearm", kind: "ranged", damage: "1d12 piercing", properties: ["ammunition", "loading"], rangeFt: 30 },
  { name: "Hunting Rifle", category: "firearm", kind: "ranged", damage: "2d6 piercing", properties: ["ammunition", "two-handed"], rangeFt: 80 },
  { name: "Musket", category: "firearm", kind: "ranged", damage: "1d12 piercing", properties: ["ammunition", "loading", "two-handed"], rangeFt: 40 },
  { name: "Hand Cannon", category: "firearm", kind: "ranged", damage: "1d10 piercing", properties: ["ammunition", "loading"], rangeFt: 30 },
  { name: "Monoblade", category: "exotic", kind: "melee", damage: "1d8 slashing", properties: ["finesse"] },
  { name: "Chainblade", category: "exotic", kind: "melee", damage: "1d10 slashing", properties: ["heavy", "two-handed"] },
  { name: "Shock Baton", category: "exotic", kind: "melee", damage: "1d6 lightning", properties: ["light"] },
  { name: "Vibroknife", category: "exotic", kind: "melee", damage: "1d4 piercing", properties: ["finesse", "light", "thrown"], rangeFt: 20 },
  { name: "Ripper Gauntlet", category: "exotic", kind: "melee", damage: "1d6 slashing", properties: ["light"] },
  { name: "Heavy Spanner", category: "exotic", kind: "melee", damage: "1d8 bludgeoning" },
  { name: "Sword Cane", category: "exotic", kind: "melee", damage: "1d6 piercing", properties: ["finesse", "light"] },
  { name: "Machete", category: "simple", kind: "melee", damage: "1d6 slashing", properties: ["light"] },
  { name: "Crowbar", category: "simple", kind: "melee", damage: "1d6 bludgeoning" },
  { name: "Silvered Stake", category: "simple", kind: "melee", damage: "1d4 piercing", properties: ["finesse", "light", "thrown"], rangeFt: 20 },
  { name: "Censer Mace", category: "simple", kind: "melee", damage: "1d6 bludgeoning" },
  { name: "Hurled Vial", category: "simple", kind: "ranged", damage: "1d6 acid", properties: ["thrown"], rangeFt: 20 },
];

export const SRD_WEAPONS: SrdWeapon[] = WEAPON_ROWS.map((weapon) =>
  LONG_RANGE_FT[weapon.name] ? { ...weapon, longRangeFt: LONG_RANGE_FT[weapon.name] } : weapon,
);

// SRD 5.1's Weapons table, the weight column, in pounds (the Sling and
// the genre weapons print none). The encumbrance rule weighs a weapon by it
// when the content pack stamps no weight, and a workshop copy started from
// one with no pack installed carries it.
export const SRD_WEAPON_WEIGHT_LB: Record<string, number> = {
  Club: 2, Dagger: 1, Greatclub: 10, Handaxe: 2, Javelin: 2, "Light Hammer": 2, Mace: 4, Quarterstaff: 4, Sickle: 2, Spear: 3,
  "Light Crossbow": 5, Dart: 0.25, Shortbow: 2,
  Battleaxe: 4, Flail: 2, Glaive: 6, Greataxe: 7, Greatsword: 6, Halberd: 6, Lance: 6, Longsword: 3, Maul: 10, Morningstar: 4,
  Pike: 18, Rapier: 2, Scimitar: 3, Shortsword: 2, Trident: 4, "War Pick": 2, Warhammer: 2, Whip: 3,
  Blowgun: 1, "Hand Crossbow": 3, "Heavy Crossbow": 18, Longbow: 2, Net: 3,
};

// The two SRD weapons whose "special" property is a rule of its own
// (src/lib/dm/attack-rules.ts reads them by name, so the property list the
// builder shows stays the mechanical one).
export const SPECIAL_WEAPONS = { net: "Net", lance: "Lance" } as const;

// Curated shortlists so category proficiencies suggest familiar picks
// instead of the whole table.
const SIMPLE_SHORTLIST = ["Quarterstaff", "Spear", "Mace", "Dagger", "Light Crossbow", "Shortbow"];
const MARTIAL_SHORTLIST = ["Longsword", "Greatsword", "Battleaxe", "Rapier", "Shortsword", "Longbow"];
const FIREARM_SHORTLIST = ["Pistol", "Revolver", "Sawed-off Scattergun", "Hunting Rifle"];
const EXOTIC_SHORTLIST = ["Monoblade", "Shock Baton", "Chainblade"];

// Catalog proficiency terms that expand to a curated set of specific
// weapons rather than a whole category ("sidearms" is the pistol class of
// firearms; "occult" is a hunter's ritual kit).
const ALIAS_TERMS: Record<string, string[]> = {
  sidearm: ["Pistol", "Revolver"],
  occult: ["Silvered Stake", "Censer Mace", "Dagger", "Hurled Vial"],
};

// Other whole names a weapon goes by: a staff is fought with as a
// quarterstaff.
export const WEAPON_ALIASES: Record<string, string[]> = { Quarterstaff: ["staff", "wooden staff", "wood staff"] };

// Each weapon's English spellings, onto its row: its name, its aliases and
// their plurals ("Longswords", "quarterstaffs", "Hand crossbows"), each also
// without its spaces, so a name written apart ("long sword", "Hand axe") is
// the same weapon.
const unspaced = (key: string) => key.replace(/ /g, "");
const byName = spellingIndex(SRD_WEAPONS, (weapon) =>
  [textKey(weapon.name), ...(WEAPON_ALIASES[weapon.name] ?? [])].flatMap((key) => [key, unspaced(key)]),
);

const aliasTerms = new Map(Object.entries(ALIAS_TERMS).flatMap(([term, names]) => pluralForms(term).map((form) => [form, names] as const)));

// The weapon a written name is: its whole name past a "+N" bonus, a plural or
// an alias, also written apart or in the book's order ("Crossbow, light"). A
// name that holds a weapon's among other words is none: "Longsword of the
// Dawn" names its row in srdName, and "Signet Ring" is no Net.
export function weaponNamed(term: string): SrdWeapon | null {
  const book = /^([^,(]+),\s*([^,(]+)$/.exec(term);
  for (const written of [term, ...(book ? [`${book[2]} ${book[1]}`] : [])]) {
    const wanted = textKey(withoutBonus(written));
    const weapon = byName.get(wanted) ?? byName.get(unspaced(wanted));
    if (weapon) {
      return weapon;
    }
  }
  return null;
}

// The weapon a carried item's row is by name (src/lib/srd/item-row.ts), or
// the one a pack row of another document is built on (pack-bases.ts).
export function rowWeapon(item: RowItem): SrdWeapon | null {
  return weaponNamed(rowName(item)) ?? weaponNamed(packBaseOf(item) ?? "");
}

// The weapon a carried item is: its row's, else the one its magic row is
// built on (src/lib/srd/magic-gear.ts): a Dagger of Venom is a dagger.
export function matchWeapon(item: RowItem): SrdWeapon | null {
  const base = gearDefFor(item)?.base;
  return rowWeapon(item) ?? (base?.kind === "weapon" ? weaponNamed(base.name) : null);
}

function parseProfs(weaponProfs: string[]) {
  let simple = false;
  let martial = false;
  let firearm = false;
  let exotic = false;
  const specific: SrdWeapon[] = [];
  const seen = new Set<string>();
  const addSpecific = (weapon: SrdWeapon | undefined) => {
    if (weapon && !seen.has(weapon.name)) {
      seen.add(weapon.name);
      specific.push(weapon);
    }
  };
  for (const raw of weaponProfs) {
    const term = raw.trim().toLowerCase();
    if (!term) {
      continue;
    }
    if (term.includes("simple")) {
      simple = true;
      continue;
    }
    if (term.includes("martial")) {
      martial = true;
      continue;
    }
    if (term.includes("firearm")) {
      firearm = true;
      continue;
    }
    if (term.includes("tech") || term.includes("exotic")) {
      exotic = true;
      continue;
    }
    const alias = aliasTerms.get(textKey(term));
    if (alias) {
      for (const name of alias) {
        addSpecific(byName.get(textKey(name)));
      }
      continue;
    }
    addSpecific(byName.get(textKey(term)));
  }
  return { simple, martial, firearm, exotic, specific };
}

// Whether a sheet's weapon-training list covers this weapon, by category
// ("martial weapons") or by specific name ("longswords").
export function isWeaponProficient(weaponProfs: string[], weapon: SrdWeapon): boolean {
  const { simple, martial, firearm, exotic, specific } = parseProfs(weaponProfs);
  if (
    (weapon.category === "simple" && simple) ||
    (weapon.category === "martial" && martial) ||
    (weapon.category === "firearm" && firearm) ||
    (weapon.category === "exotic" && exotic)
  ) {
    return true;
  }
  return specific.some((entry) => entry.name === weapon.name);
}

// Average roll of "XdY ..." for ranking picks; flat numbers pass through.
export function damageScore(weapon: SrdWeapon) {
  const dice = weapon.damage.match(/^(\d+)d(\d+)/);
  if (dice) {
    return (Number(dice[1]) * (Number(dice[2]) + 1)) / 2;
  }
  const flat = weapon.damage.match(/^(\d+)/);
  return flat ? Number(flat[1]) : 0;
}

// Later entries win ties so finesse-flavored lists (bard/rogue) land on the
// rapier rather than the longsword.
function bestOf(weapons: SrdWeapon[]) {
  let best: SrdWeapon | undefined;
  for (const weapon of weapons) {
    if (!best || damageScore(weapon) >= damageScore(best)) {
      best = weapon;
    }
  }
  return best;
}

function get(name: string) {
  const weapon = byName.get(textKey(name));
  if (!weapon) {
    throw new Error(`Unknown SRD weapon: ${name}`);
  }
  return weapon;
}

// One melee and one ranged starting weapon for the class, or [] when the
// proficiency list implies none. Firearm-proficient classes start with a
// pistol even when martial-trained: those classes should hold guns.
export function defaultLoadout(weaponProfs: string[]): SrdWeapon[] {
  const { simple, martial, firearm, exotic, specific } = parseProfs(weaponProfs);
  if (!simple && !martial && !firearm && !exotic && !specific.length) {
    return [];
  }
  const exoticMelee = exotic ? EXOTIC_SHORTLIST.map(get) : [];
  const melee = martial
    ? get("Longsword")
    : (bestOf(
        [...specific, ...exoticMelee].filter((weapon) => weapon.kind === "melee"),
      ) ?? (simple ? get("Mace") : undefined));
  const ranged = firearm
    ? get("Pistol")
    : martial
      ? get("Longbow")
      : (bestOf(specific.filter((weapon) => weapon.kind === "ranged")) ??
        (simple ? get("Light Crossbow") : undefined));
  const loadout: SrdWeapon[] = [];
  if (melee) {
    loadout.push(melee);
  }
  if (ranged && ranged !== melee) {
    loadout.push(ranged);
  }
  return loadout;
}

// Proficient weapons worth offering as one-click adds: specific
// proficiencies first, then the firearm/exotic and martial/simple shortlists.
export function suggestWeapons(weaponProfs: string[], limit = 8): SrdWeapon[] {
  const { simple, martial, firearm, exotic, specific } = parseProfs(weaponProfs);
  const out: SrdWeapon[] = [];
  const seen = new Set<string>();
  const push = (weapon: SrdWeapon) => {
    if (!seen.has(weapon.name) && out.length < limit) {
      seen.add(weapon.name);
      out.push(weapon);
    }
  };
  for (const weapon of specific) {
    push(weapon);
  }
  if (firearm) {
    for (const name of FIREARM_SHORTLIST) {
      push(get(name));
    }
  }
  if (exotic) {
    for (const name of EXOTIC_SHORTLIST) {
      push(get(name));
    }
  }
  if (martial) {
    for (const name of MARTIAL_SHORTLIST) {
      push(get(name));
    }
  }
  if (simple) {
    for (const name of SIMPLE_SHORTLIST) {
      push(get(name));
    }
  }
  return out;
}
