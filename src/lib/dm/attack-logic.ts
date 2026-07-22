import {
  damageScore,
  isWeaponProficient,
  matchWeapon,
  type SrdWeapon,
} from "@/lib/srd/weapons";
import { magicItemBonus } from "@/lib/srd/armor";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import { RAGING, rageDamageBonus } from "@/lib/srd/class-resources";
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
  // Which ability drove the attack. Rage's bonus damage rides on melee
  // Strength attacks specifically, so finesse picking DEX matters.
  ability: "str" | "dex";
  // The +1/+2/+3 a magic weapon's name declares, already folded into toHit
  // and damageExpression; kept so the tool result can say why.
  magicBonus: number;
  // Two-handed or versatile-in-two-hands: Great Weapon Fighting rerolls
  // this attack's damage dice.
  twoHanded: boolean;
  // Finesse or ranged: the attacks Sneak Attack is allowed to ride on.
  sneakEligible: boolean;
  // SRD heavy property: Small creatures attack with it at disadvantage.
  heavy: boolean;
  // Human-readable notes for the tool result ("Archery: +2 to hit").
  riderNotes: string[];
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

// Versatile weapons roll the bigger die in two hands. The SRD table stores
// only the one-handed damage, so the step up is derived: d6 -> d8, d8 -> d10,
// d10 -> d12, which is every versatile entry in the book.
const VERSATILE_STEP_UP: Record<string, string> = { d6: "d8", d8: "d10", d10: "d12" };

function versatileDice(dice: string): string {
  const match = /^(\d+)(d\d+)$/.exec(dice);
  const stepped = match ? VERSATILE_STEP_UP[match[2]] : undefined;
  return match && stepped ? `${match[1]}${stepped}` : dice;
}

// How the character is holding the weapon and what else is in play, so the
// fighting styles that care can be applied. Everything is optional: the
// callers that have no opinion get plain SRD behavior.
export type AttackStance = {
  riders?: CombatRiders;
  // True when they hold this weapon in both hands (versatile weapons step
  // their damage die up and become Great Weapon Fighting candidates).
  twoHanded?: boolean;
  // The bonus-action attack of two-weapon fighting: no ability modifier on
  // damage unless the Two-Weapon Fighting style says otherwise.
  offHand?: boolean;
};

// Derives the full attack profile from the sheet's numbers and the weapon's
// SRD properties: finesse picks the better of STR/DEX, ranged weapons use
// DEX, thrown weapons use STR (or finesse), proficiency adds the bonus only
// when the sheet's weapon training covers the weapon. Fighting styles,
// Martial Arts, and magic bonuses ride in through `stance`.
export function weaponAttackProfile(
  derived: Pick<SheetDerived, "abilityMods" | "proficiencyBonus">,
  weaponProfs: string[],
  resolved: ResolvedWeapon,
  stance: AttackStance = {},
): AttackProfile {
  const { srd } = resolved;
  const riders = stance.riders;
  const notes: string[] = [];
  if (!srd) {
    // Unarmed strike (1 + STR, always proficient) or improvised 1d4 + STR.
    // A monk's Martial Arts turns the unarmed strike into a real weapon:
    // their own die, and DEX when it beats Strength.
    const martial = resolved.unarmed ? (riders?.martialArtsDie ?? null) : null;
    const useDex = Boolean(martial) && derived.abilityMods.dex > derived.abilityMods.str;
    const mod = useDex ? derived.abilityMods.dex : derived.abilityMods.str;
    const dice = martial ? `1${martial}` : resolved.unarmed ? "1" : "1d4";
    if (martial) {
      notes.push(`Martial Arts: 1${martial}${useDex ? " with DEX" : ""}`);
    }
    return {
      weapon: resolved.displayName,
      toHit: mod + (resolved.unarmed ? derived.proficiencyBonus : 0),
      damageExpression: withModifier(dice, stance.offHand && !riders?.twoWeaponKeepsAbility ? 0 : mod),
      damageType: "bludgeoning",
      ranged: false,
      thrown: !resolved.unarmed,
      reachTiles: 1,
      rangeTiles: 4,
      proficient: resolved.unarmed,
      improvised: !resolved.unarmed,
      ability: useDex ? "dex" : "str",
      magicBonus: 0,
      twoHanded: false,
      sneakEligible: false,
      heavy: false,
      riderNotes: notes,
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
  // A "+1 Longsword" adds its bonus to the attack roll and the damage, per
  // the SRD magic-weapon rule; the name on the item is the whole contract.
  const magicBonus = magicItemBonus(resolved.displayName);

  const inherentlyTwoHanded = properties.includes("two-handed");
  const versatile = properties.includes("versatile");
  const twoHanded = inherentlyTwoHanded || (versatile && stance.twoHanded === true);
  const damageDice = versatile && twoHanded ? versatileDice(dice) : dice;
  if (versatile && twoHanded) {
    notes.push(`two-handed: ${damageDice}`);
  }

  // Fighting-style riders. Archery is ranged-only, Dueling wants a single
  // one-handed melee weapon, and the off-hand swing drops its modifier
  // unless Two-Weapon Fighting is trained.
  let toHitBonus = 0;
  let damageBonus = 0;
  if (riders) {
    if (ranged && riders.rangedAttackBonus) {
      toHitBonus += riders.rangedAttackBonus;
      notes.push(`Archery: +${riders.rangedAttackBonus} to hit`);
    }
    if (!ranged && riders.meleeAttackBonus) {
      toHitBonus += riders.meleeAttackBonus;
      notes.push(`+${riders.meleeAttackBonus} to hit`);
    }
    if (!ranged && !twoHanded && !stance.offHand && riders.oneHandedMeleeDamageBonus) {
      damageBonus += riders.oneHandedMeleeDamageBonus;
      notes.push(`Dueling: +${riders.oneHandedMeleeDamageBonus} damage`);
    }
  }
  const abilityToDamage = stance.offHand && !riders?.twoWeaponKeepsAbility ? 0 : mod;
  if (stance.offHand && riders?.twoWeaponKeepsAbility) {
    notes.push("Two-Weapon Fighting: off-hand keeps its modifier");
  }

  return {
    weapon: resolved.displayName,
    toHit: mod + magicBonus + toHitBonus + (proficient ? derived.proficiencyBonus : 0),
    damageExpression: withModifier(damageDice, abilityToDamage + magicBonus + damageBonus),
    damageType: type,
    ranged,
    thrown,
    reachTiles: properties.includes("reach") ? 2 : 1,
    rangeTiles,
    proficient,
    improvised: false,
    // Mirrors the `mod` choice above; a tie counts as Strength.
    ability: finesse ? (dex > str ? "dex" : "str") : ranged && !thrown ? "dex" : "str",
    magicBonus,
    twoHanded,
    // Sneak Attack rides on finesse and ranged weapons only.
    sneakEligible: finesse || ranged,
    heavy: properties.includes("heavy"),
    riderNotes: notes,
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
    // Spell attacks use the casting ability; neither rage case applies.
    ability: "dex",
    magicBonus: 0,
    twoHanded: false,
    sneakEligible: false,
    heavy: false,
    riderNotes: [],
  };
}

// Rage's bonus damage, or 0 when it does not apply. SRD: melee weapon
// attacks made with Strength only, so a raging barbarian's longbow and
// their finesse rapier swung with Dexterity both get nothing.
export function ragingMeleeBonus(
  sheet: { conditions: string[]; level: number; classes?: Array<{ id: string; level: number }> },
  profile: Pick<AttackProfile, "ranged" | "ability">,
): number {
  const raging = sheet.conditions.some((entry) => entry.toLowerCase() === RAGING);
  if (!raging || profile.ranged || profile.ability !== "str") {
    return 0;
  }
  // Multiclass: the bonus reads the BARBARIAN level, not the character's.
  const barbarian = sheet.classes?.find((entry) => entry.id.toLowerCase() === "barbarian");
  return rageDamageBonus(barbarian && (sheet.classes?.length ?? 0) > 1 ? barbarian.level : sheet.level);
}

// Mirrors the enemy_attack ruling: nat1 always misses, nat20 always hits
// and crits, otherwise total vs AC. `critRange` lowers the threshold for
// Improved Critical (19) and Superior Critical (18); a natural roll at or
// above it crits, though only a natural 20 also hits automatically.
export function adjudicateHit(
  total: number,
  crit: "nat20" | "nat1" | undefined,
  targetAc: number,
  options: { natural?: number; critRange?: number } = {},
): { hit: boolean; crit: boolean } {
  if (crit === "nat1") {
    return { hit: false, crit: false };
  }
  const hit = crit === "nat20" || total >= targetAc;
  const critRange = options.critRange ?? 20;
  const inRange =
    crit === "nat20" ||
    (options.natural !== undefined && options.natural >= critRange && critRange < 20);
  return { hit, crit: hit && inRange };
}
