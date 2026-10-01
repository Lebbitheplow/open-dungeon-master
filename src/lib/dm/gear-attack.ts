// A magic weapon in the attack engine: the mundane weapon it is built on,
// with what its magic adds (src/lib/srd/magic-gear.ts reads the table). Pure,
// like attack-logic.ts, which calls it while it resolves the swing.
//
// SRD 5.1, "Magic Items": a magic weapon keeps its base weapon's statistics
// and adds what its entry gives: a bonus to attack and damage rolls, extra
// dice of a damage type on a hit, sometimes only against some creatures or
// only on a natural 20. An item that asks for attunement gives its magic
// only to someone attuned; the sword underneath swings for anyone.

import type { AttackProfile } from "@/lib/dm/attack-logic";
import type { TypedRider } from "@/lib/dm/damage-parts";
import {
  gearBaseName,
  gearDefFor,
  gearRidersActive,
  type GearDef,
  type GearDice,
  type WeaponRiders,
} from "@/lib/srd/magic-gear";
import { matchWeapon, type SrdWeapon } from "@/lib/srd/weapons";
import type { EquipmentItem } from "@/lib/schemas/sheet";

export type WeaponGear = {
  def: GearDef;
  // The riders that count for this wielder now (empty while an item that
  // asks for attunement is not attuned).
  riders: WeaponRiders;
};

// The weapon a carried row swings as, and the magic weapon it is when it is
// one: the SRD weapon its name names wins ("Flame Tongue Scimitar"), else the
// base the item's entry gives ("Flame Tongue" is a longsword). A row whose
// magic item is armor or a wondrous thing is not made a weapon here.
export function magicWeaponOfRow(
  item: EquipmentItem,
): { srd: SrdWeapon | null; gear: WeaponGear | null } {
  const named = matchWeapon(item.name);
  const def = gearDefFor(item.name, item.slug, named?.name);
  if (!def || def.base?.kind !== "weapon") {
    return { srd: named, gear: null };
  }
  const base = named ?? matchWeapon(gearBaseName(def, "weapon") ?? "");
  const riders = gearRidersActive(def, item) ? (def.weapon ?? {}) : {};
  return { srd: base ? withGear(base, riders) : null, gear: { def, riders } };
}

// A magic weapon asked for by a name nobody carries: still a weapon on the
// table, not an improvised object.
export function isMagicWeaponName(name: string): boolean {
  const def = gearDefFor(name, undefined, matchWeapon(name)?.name);
  return def?.base?.kind === "weapon";
}

// The base weapon with what the magic changes about it: a Sun Blade's
// radiant damage and finesse, a Dwarven Thrower's throwing range. The name
// stays the base weapon's, which is what weapon training reads.
function withGear(base: SrdWeapon, riders: WeaponRiders): SrdWeapon {
  if (!riders.damageType && !riders.properties?.length && !riders.rangeFt) {
    return base;
  }
  const dice = base.damage.trim().split(/\s+/)[0];
  return {
    ...base,
    damage: riders.damageType ? `${dice} ${riders.damageType}` : base.damage,
    properties: [...new Set([...(base.properties ?? []), ...(riders.properties ?? [])])],
    ...(riders.rangeFt ? { rangeFt: riders.rangeFt } : {}),
    ...(riders.longRangeFt ? { longRangeFt: riders.longRangeFt } : {}),
  };
}

// What a magic weapon adds to the profile weaponAttackProfile builds: the
// dice that ride every hit (folded into the expression now), the dice that
// wait on the target, the range or a natural 20, and the mark that its blows
// are magical.
export function gearProfileParts(
  gear: WeaponGear | null | undefined,
  weaponName: string,
  damageType: string,
): {
  suffix: string;
  notes: string[];
  fields: Partial<AttackProfile>;
} {
  if (!gear) {
    return { suffix: "", notes: [], fields: {} };
  }
  const { riders } = gear;
  const always = (riders.extra ?? []).filter((entry) => !entry.vs && !entry.notVs && !entry.ranged);
  const waiting = (riders.extra ?? []).filter((entry) => entry.vs || entry.notVs || entry.ranged);
  const typeOf = (entry: GearDice) => (entry.type === "weapon" ? damageType : entry.type);
  const notes = always.map((entry) => `${weaponName}: +${entry.dice} ${typeOf(entry)}`);
  if (riders.bonus) {
    notes.unshift(`${weaponName}: +${riders.bonus} to hit and damage`);
  }
  return {
    suffix: always.map((entry) => `+${entry.dice}`).join(""),
    notes,
    fields: {
      magicWeapon: true,
      ...(always.length
        ? { gearTyped: always.map((entry) => ({ dice: entry.dice, type: typeOf(entry) })) }
        : {}),
      ...(waiting.length ? { gearDice: waiting } : {}),
      ...(riders.critExtra?.length ? { gearCritDice: riders.critExtra } : {}),
      ...(riders.bonusVs ? { gearBonusVs: riders.bonusVs } : {}),
    },
  };
}

// Whether a magic weapon's dice apply to this target: its creature type is
// one the dice name (or they name none), is not one they spare, and the
// attack is at range when the dice ask for that.
function applies(entry: GearDice, creatureType: string, atRange: boolean): boolean {
  if (entry.ranged && !atRange) {
    return false;
  }
  if (entry.vs && !entry.vs.some((wanted) => creatureType.includes(wanted))) {
    return false;
  }
  return !entry.notVs?.some((spared) => creatureType.includes(spared));
}

// A magic weapon's riders against the creature it is swung at: a Holy
// Avenger's 2d10 radiant against a fiend, a Dwarven Thrower's 1d8 on a
// throw, a Mace of Smiting's +3 against a construct. Returns the profile with
// those folded in, and every typed die the hit carries (the always-on ones
// included) for the per-type resolution in src/lib/dm/damage-parts.ts.
export function itemRidersAgainst(
  profile: AttackProfile,
  creatureType: string | undefined,
  atRange: boolean,
): { profile: AttackProfile; typed: TypedRider[] } {
  const kind = (creatureType ?? "").trim().toLowerCase();
  const typed: TypedRider[] = [...(profile.gearTyped ?? [])];
  let next = profile;
  const bonusVs = profile.gearBonusVs;
  if (bonusVs && bonusVs.types.some((wanted) => kind.includes(wanted)) && bonusVs.bonus > profile.magicBonus) {
    const lift = bonusVs.bonus - profile.magicBonus;
    next = {
      ...next,
      toHit: next.toHit + lift,
      damageExpression: `${next.damageExpression}+${lift}`,
      magicBonus: bonusVs.bonus,
      riderNotes: [...next.riderNotes, `${profile.weapon}: +${bonusVs.bonus} against a ${kind}`],
    };
  }
  for (const entry of profile.gearDice ?? []) {
    if (!applies(entry, kind, atRange)) {
      continue;
    }
    const type = entry.type === "weapon" ? profile.damageType : entry.type;
    next = {
      ...next,
      damageExpression: `${next.damageExpression}+${entry.dice}`,
      riderNotes: [...next.riderNotes, `${profile.weapon}: +${entry.dice} ${type}${entry.vs ? ` against a ${kind}` : ""}`],
    };
    typed.push({ dice: entry.dice, type });
  }
  return { profile: next, typed };
}

// The dice a magic weapon adds when the attack roll is a natural 20 (a
// Vicious Weapon's 2d6, a Sword of Sharpness's 4d6), for that hit's damage
// roll. Folded in before the critical doubles the dice, as every die of a
// critical hit is doubled.
export function gearCritRiders(
  profile: AttackProfile,
  creatureType: string | undefined,
): { suffix: string; typed: TypedRider[]; notes: string[] } {
  const kind = (creatureType ?? "").trim().toLowerCase();
  const out = { suffix: "", typed: [] as TypedRider[], notes: [] as string[] };
  for (const entry of profile.gearCritDice ?? []) {
    if (!applies(entry, kind, true)) {
      continue;
    }
    const type = entry.type === "weapon" ? profile.damageType : entry.type;
    out.suffix += `+${entry.dice}`;
    out.typed.push({ dice: entry.dice, type });
    out.notes.push(`${profile.weapon}: a natural 20 adds ${entry.dice} ${type}`);
  }
  return out;
}
