// Pure damage arithmetic: what resistance, vulnerability and immunity do to
// a number, how a damage type is read out of a stat block's line, and the
// two conditions that change what a creature resists (petrified, and a rage
// worn under heavy armor). Database-free, like condition-logic.ts, which
// re-exports everything here for the callers that have always found it
// there.
import { RAGING } from "@/lib/srd/class-resources";
import { matchArmor, type SrdArmor } from "@/lib/srd/armor";

function has(conditions: string[], names: string[]): string | null {
  const lowered = conditions.map((entry) => entry.toLowerCase());
  return names.find((name) => lowered.includes(name)) ?? null;
}

export const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];
export const PHYSICAL_TYPES = ["bludgeoning", "piercing", "slashing"];

const wholeWord = (text: string, word: string) =>
  new RegExp(`(^|[^a-z])${word.replace(/[^a-z ]/g, "")}([^a-z]|$)`).test(text);

// The damage type a caller meant: the SRD type named in what they sent
// ("fire damage", "magical slashing"), else their own word for a homebrew
// type. Whole words only, so "fir" is not fire.
function damageTypeOf(raw: string | undefined): string {
  const cleaned = (raw ?? "").trim().toLowerCase();
  if (!cleaned) {
    return "";
  }
  return DAMAGE_TYPES.find((type) => wholeWord(cleaned, type)) ?? cleaned.replace(/[^a-z ]/g, "").trim();
}

// Whether a stat block line covers this type. Lines read "fire; cold" or
// "bludgeoning, piercing, and slashing from nonmagical attacks": the type
// has to appear as a whole word, and a clause about nonmagical attacks does
// not cover a magical one. Only the three weapon types are ever conditional
// on that, so "fire, slashing from nonmagical attacks" still covers fire.
// A clause "from nonmagical attacks that aren't silvered" (a werewolf) is
// also passed by a silvered weapon, and "that aren't adamantine" (a golem)
// by an adamantine one (SRD 5.1, Silvered Weapons).
function lineCovers(line: string, type: string, magical: boolean, material: WeaponMaterial = {}): boolean {
  return line
    .toLowerCase()
    .split(";")
    .some((clause) => {
      if (!wholeWord(clause, type)) {
        return false;
      }
      const conditional = clause.includes("nonmagical") && PHYSICAL_TYPES.includes(type);
      const passed =
        magical ||
        (material.silvered === true && clause.includes("silver")) ||
        (material.adamantine === true && clause.includes("adamantine"));
      return !(conditional && passed);
    });
}

// What a weapon is made of, for the resistances that name it.
export type WeaponMaterial = { silvered?: boolean; adamantine?: boolean };

// A weapon's material read from its name: "Silvered Longsword",
// "Adamantine Greataxe".
export function weaponMaterial(name: string | undefined): WeaponMaterial {
  const text = (name ?? "").toLowerCase();
  return {
    ...(/\bsilver(ed)?\b/.test(text) ? { silvered: true } : {}),
    ...(/\badamantine\b/.test(text) ? { adamantine: true } : {}),
  };
}

// Immunity is no damage and beats the other two. Resistance halves, rounded
// down, with no floor: one point of resisted damage is none. Vulnerability
// doubles. Both together are applied in that order (SRD 5.1), so 25 becomes
// 12 and then 24.
export function damageAdjust(
  amount: number,
  type: string | undefined,
  resist: string,
  immune: string,
  vulnerable: string,
  options?: {
    // The damage comes from a spell, a magic weapon, or strikes that count
    // as magical: "from nonmagical attacks" does not apply to it.
    magical?: boolean;
    // Resistance to every type, whatever the lines say (petrified).
    resistAll?: boolean;
  } & WeaponMaterial,
): { amount: number; note: string | null } {
  const wanted = damageTypeOf(type);
  const magical = options?.magical === true;
  const material: WeaponMaterial = { silvered: options?.silvered, adamantine: options?.adamantine };
  if (!wanted) {
    return options?.resistAll
      ? { amount: Math.floor(amount / 2), note: "resistant to all damage: halved" }
      : { amount, note: null };
  }
  if (lineCovers(immune, wanted, magical, material)) {
    return { amount: 0, note: `immune to ${wanted} damage: no damage` };
  }
  const resisted = options?.resistAll === true || lineCovers(resist, wanted, magical, material);
  const vulnerableTo = lineCovers(vulnerable, wanted, magical, material);
  if (resisted && vulnerableTo) {
    return {
      amount: Math.floor(amount / 2) * 2,
      note: `resistant and vulnerable to ${wanted} damage: halved, then doubled`,
    };
  }
  if (resisted) {
    return { amount: Math.floor(amount / 2), note: `resistant to ${wanted} damage: halved` };
  }
  if (vulnerableTo) {
    return { amount: amount * 2, note: `vulnerable to ${wanted} damage: doubled` };
  }
  return { amount, note: null };
}

// A petrified creature resists every damage type (SRD 5.1, Conditions).
export function resistsAllDamage(conditions: string[] | undefined): boolean {
  return has(conditions ?? [], ["petrified"]) !== null;
}

// Body armor of the heavy category, worn. The same reading of "worn" the
// armor engine uses: until a sheet has its first explicit toggle, everything
// carried counts.
export function wearsHeavyArmor(
  equipment: Array<{ name: string; equipped?: boolean; gear?: { armor?: SrdArmor } }> | undefined,
): boolean {
  const items = equipment ?? [];
  const anyExplicit = items.some((item) => item.equipped);
  return items.some((item) => {
    if (anyExplicit && !item.equipped) {
      return false;
    }
    return (item.gear?.armor ?? matchArmor(item.name))?.category === "heavy";
  });
}

// Rage gives its benefits only to a barbarian who is not wearing heavy armor.
export function rageApplies(sheet: {
  conditions?: string[];
  equipment?: Array<{ name: string; equipped?: boolean }>;
}): boolean {
  return has(sheet.conditions ?? [], [RAGING]) !== null && !wearsHeavyArmor(sheet.equipment);
}
