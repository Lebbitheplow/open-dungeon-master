import {
  damageScore,
  isWeaponProficient,
  matchWeapon,
  type SrdWeapon,
} from "@/lib/srd/weapons";
import type { EquipmentItem } from "@/lib/schemas/sheet";
import type { SheetDerived } from "@/lib/srd";

// Pure attack math for the pc_attack engine: which weapon a character swings,
// what their to-hit and damage bonuses are, and whether a roll beats an AC.
// Database-free like encounter-logic.ts so scripts/test-attack-logic.mjs can
// exercise every branch.

export type ResolvedWeapon = {
  // What the players see on the dice card: the carried item's name when one
  // matched, else the canonical SRD name, else the model's word for it.
  displayName: string;
  // null = improvised weapon or unarmed strike (no SRD profile).
  srd: SrdWeapon | null;
  unarmed: boolean;
};

export type AttackProfile = {
  weapon: string;
  toHit: number;
  damageExpression: string;
  damageType: string;
  ranged: boolean;
  // Thrown melee weapons may be used at range with rangeTiles.
  thrown: boolean;
  // Melee reach in tiles: 1, or 2 for reach weapons.
  reachTiles: number;
  // Max range in tiles for ranged/thrown use.
  rangeTiles: number;
  proficient: boolean;
  improvised: boolean;
};

function itemMatchesTerm(itemName: string, term: string): boolean {
  const item = itemName.trim().toLowerCase();
  const wanted = term.trim().toLowerCase();
  return Boolean(item && wanted && (item.includes(wanted) || wanted.includes(item)));
}

// Which weapon the character attacks with. A named weapon fuzzy-matches
// their carried equipment and the SRD table; no name picks the best
// proficient carried weapon; nothing usable falls back to an unarmed strike.
export function resolveAttackWeapon(
  equipment: EquipmentItem[],
  weaponProfs: string[],
  weaponArg: string | undefined,
): ResolvedWeapon {
  const arg = (weaponArg ?? "").trim();
  if (arg) {
    if (/unarmed|fist|punch|kick/i.test(arg)) {
      return { displayName: "Unarmed strike", srd: null, unarmed: true };
    }
    const carriedItem = equipment.find((item) => itemMatchesTerm(item.name, arg));
    const srd = matchWeapon(arg) ?? (carriedItem ? matchWeapon(carriedItem.name) : null);
    return {
      displayName: carriedItem?.name ?? srd?.name ?? arg,
      srd,
      unarmed: false,
    };
  }
  // No name given: best carried weapon, proficient ones first.
  let best: { item: EquipmentItem; srd: SrdWeapon; proficient: boolean } | null = null;
  for (const item of equipment) {
    const srd = matchWeapon(item.name);
    if (!srd) {
      continue;
    }
    const proficient = isWeaponProficient(weaponProfs, srd);
    if (
      !best ||
      (proficient && !best.proficient) ||
      (proficient === best.proficient && damageScore(srd) > damageScore(best.srd))
    ) {
      best = { item, srd, proficient };
    }
  }
  if (best) {
    return { displayName: best.item.name, srd: best.srd, unarmed: false };
  }
  return { displayName: "Unarmed strike", srd: null, unarmed: true };
}

// "1d8 slashing" -> { dice: "1d8", type: "slashing" }; flat "1 piercing" and
// oddities like "0 (restrains)" keep their leading number as the dice part.
export function splitDamage(damage: string): { dice: string; type: string } {
  const match = /^(\d+(?:d\d+)?)\s*(.*)$/i.exec(damage.trim());
  if (!match) {
    return { dice: "1d4", type: "" };
  }
  const type = match[2].replace(/[()]/g, "").trim().toLowerCase();
  return { dice: match[1], type };
}

function withModifier(dice: string, modifier: number): string {
  if (modifier > 0) {
    return `${dice}+${modifier}`;
  }
  if (modifier < 0) {
    return `${dice}-${Math.abs(modifier)}`;
  }
  return dice;
}

export const DEFAULT_RANGED_TILES = 12;

// Derives the full attack profile from the sheet's numbers and the weapon's
// SRD properties: finesse picks the better of STR/DEX, ranged weapons use
// DEX, thrown weapons use STR (or finesse), proficiency adds the bonus only
// when the sheet's weapon training covers the weapon.
export function weaponAttackProfile(
  derived: Pick<SheetDerived, "abilityMods" | "proficiencyBonus">,
  weaponProfs: string[],
  resolved: ResolvedWeapon,
): AttackProfile {
  const { srd } = resolved;
  if (!srd) {
    // Unarmed strike (1 + STR, always proficient) or improvised 1d4 + STR.
    const mod = derived.abilityMods.str;
    const dice = resolved.unarmed ? "1" : "1d4";
    return {
      weapon: resolved.displayName,
      toHit: mod + (resolved.unarmed ? derived.proficiencyBonus : 0),
      damageExpression: withModifier(dice, mod),
      damageType: "bludgeoning",
      ranged: false,
      thrown: !resolved.unarmed,
      reachTiles: 1,
      rangeTiles: 4,
      proficient: resolved.unarmed,
      improvised: !resolved.unarmed,
    };
  }
  const properties = srd.properties ?? [];
  const finesse = properties.includes("finesse");
  const thrown = properties.includes("thrown");
  const ranged = srd.kind === "ranged";
  const str = derived.abilityMods.str;
  const dex = derived.abilityMods.dex;
  // Ranged-kind weapons shoot with DEX; thrown ranged-kind (darts, vials)
  // and melee weapons use STR, with finesse taking the better of the two.
  const mod = finesse ? Math.max(str, dex) : ranged && !thrown ? dex : str;
  const proficient = isWeaponProficient(weaponProfs, srd);
  const { dice, type } = splitDamage(srd.damage);
  const rangeTiles = srd.rangeFt
    ? Math.max(1, Math.round(srd.rangeFt / 5))
    : DEFAULT_RANGED_TILES;
  return {
    weapon: resolved.displayName,
    toHit: mod + (proficient ? derived.proficiencyBonus : 0),
    damageExpression: withModifier(dice, mod),
    damageType: type,
    ranged,
    thrown,
    reachTiles: properties.includes("reach") ? 2 : 1,
    rangeTiles,
    proficient,
    improvised: false,
  };
}

// Attack-roll spells (Fire Bolt, Guiding Bolt...): to-hit is the sheet's
// spell attack bonus; the damage dice come from the model (validated by the
// caller) because spell payloads live in the content pack's prose.
export function spellAttackProfile(
  derived: Pick<SheetDerived, "spellAttack">,
  spellName: string,
  damageExpression: string,
  damageType: string,
): AttackProfile | null {
  if (derived.spellAttack === null) {
    return null;
  }
  return {
    weapon: spellName,
    toHit: derived.spellAttack,
    damageExpression,
    damageType,
    ranged: true,
    thrown: false,
    reachTiles: 1,
    // Generous default spell range (120 ft); real per-spell ranges are not
    // modeled.
    rangeTiles: 24,
    proficient: true,
    improvised: false,
  };
}

// Mirrors the enemy_attack ruling: nat1 always misses, nat20 always hits
// and crits, otherwise total vs AC.
export function adjudicateHit(
  total: number,
  crit: "nat20" | "nat1" | undefined,
  targetAc: number,
): { hit: boolean; crit: boolean } {
  const isCrit = crit === "nat20";
  return { hit: crit !== "nat1" && (isCrit || total >= targetAc), crit: isCrit };
}

// The ammunition item a ranged weapon consumes, for the resource engine:
// bows fire arrows, crossbows bolts, slings bullets, blowguns needles,
// firearms rounds. Non-ammunition weapons return null.
export function ammoKindFor(srd: SrdWeapon | null): string | null {
  if (!srd || !(srd.properties ?? []).includes("ammunition")) {
    return null;
  }
  const name = srd.name.toLowerCase();
  if (name.includes("crossbow")) {
    return "bolts";
  }
  if (name.includes("bow")) {
    return "arrows";
  }
  if (name.includes("sling")) {
    return "sling bullets";
  }
  if (name.includes("blowgun")) {
    return "needles";
  }
  return "rounds";
}
