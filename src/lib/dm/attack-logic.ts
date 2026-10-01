import {
  damageScore,
  isWeaponProficient,
  matchWeapon,
  type SrdWeapon,
} from "@/lib/srd/weapons";
import { magicItemBonus } from "@/lib/srd/armor";
import {
  gearProfileParts,
  isMagicWeaponName,
  magicWeaponOfRow,
  type WeaponGear,
} from "@/lib/dm/gear-attack";
import type { TypedRider } from "@/lib/dm/damage-parts";
import type { GearDice } from "@/lib/srd/magic-gear";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import { rageDamageBonus } from "@/lib/srd/class-resources";
import { rageApplies } from "@/lib/dm/damage-logic";
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
  // False when the attack named a real weapon the character does not carry.
  // An unarmed strike and an improvised object picked up by name are always
  // "carried": neither comes out of the pack.
  carried?: boolean;
  // The magic weapon the carried row is, when it is one
  // (src/lib/dm/gear-attack.ts): its riders, already judged against the
  // item's attunement.
  gear?: WeaponGear | null;
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
  // An unarmed strike (Martial Arts' bonus strike, Ki-Empowered Strikes).
  unarmed?: boolean;
  // Swung under Martial Arts: an unarmed strike or a monk weapon in the
  // hands of a monk with no armor and no shield.
  martialArts?: boolean;
  // Long range in tiles for ranged and thrown use: past rangeTiles a shot is
  // at disadvantage, past this it cannot be made. Absent on attacks with no
  // printed long range, which reach twice their normal one.
  longRangeTiles?: number;
  // The weapon's own properties (light, loading, two-handed...), for the
  // rules about hands and turns (src/lib/dm/attack-rules.ts).
  properties?: string[];
  // Human-readable notes for the tool result ("Archery: +2 to hit").
  riderNotes: string[];
  // A magic weapon, bonus or not: its blows pass resistance to nonmagical
  // attacks.
  magicWeapon?: boolean;
  // A magic weapon's typed dice already in the expression, and the dice that
  // wait on the target, the range or a natural 20 (a Holy Avenger's radiant
  // against fiends, a Vicious Weapon's 2d6), for itemRidersAgainst and
  // gearCritRiders in src/lib/dm/gear-attack.ts.
  gearTyped?: TypedRider[];
  gearDice?: GearDice[];
  gearCritDice?: GearDice[];
  gearBonusVs?: { types: string[]; bonus: number };
};

// The weapon block a homebrew item snapshotted onto its equipment line, if
// it has one.
export function weaponOf(item: EquipmentItem | undefined): SrdWeapon | null {
  const weapon = item?.gear?.weapon as SrdWeapon | undefined;
  return weapon && typeof weapon.damage === "string" ? weapon : null;
}

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
      return { displayName: "Unarmed strike", srd: null, unarmed: true, carried: true };
    }
    // The exact name wins over a name that merely contains it, so a
    // "Longsword" asked for beside a "Longsword +1" is the plain one.
    const wanted = arg.toLowerCase();
    const carriedItem =
      equipment.find((item) => item.name.trim().toLowerCase() === wanted) ??
      equipment.find((item) => itemMatchesTerm(item.name, arg));
    // A carried homebrew weapon carries its own block (src/lib/homebrew/
    // gear.ts) and wins over a name that happens to resemble an SRD one. A
    // carried magic weapon swings as its base weapon (src/lib/dm/
    // gear-attack.ts): a Flame Tongue is a longsword.
    const magic = carriedItem && !weaponOf(carriedItem) ? magicWeaponOfRow(carriedItem) : null;
    const srd =
      weaponOf(carriedItem) ??
      (magic?.gear ? magic.srd : null) ??
      matchWeapon(arg) ??
      (carriedItem ? matchWeapon(carriedItem.name) : null);
    return {
      displayName: carriedItem?.name ?? srd?.name ?? arg,
      srd,
      unarmed: false,
      // A name that is a weapon on the table and on nobody's back is not
      // theirs to swing. A name that is no weapon at all is whatever they
      // picked up: improvised.
      carried: Boolean(carriedItem) || (srd === null && !isMagicWeaponName(arg)),
      ...(magic?.gear ? { gear: magic.gear } : {}),
    };
  }
  // No name given: best carried weapon, proficient ones first.
  let best: { item: EquipmentItem; srd: SrdWeapon; proficient: boolean; gear: WeaponGear | null } | null = null;
  for (const item of equipment) {
    const magic = weaponOf(item) ? null : magicWeaponOfRow(item);
    const srd = weaponOf(item) ?? magic?.srd ?? null;
    if (!srd) {
      continue;
    }
    const proficient = isWeaponProficient(weaponProfs, srd);
    if (
      !best ||
      (proficient && !best.proficient) ||
      (proficient === best.proficient && damageScore(srd) > damageScore(best.srd))
    ) {
      best = { item, srd, proficient, gear: magic?.gear ?? null };
    }
  }
  if (best) {
    return {
      displayName: best.item.name,
      srd: best.srd,
      unarmed: false,
      carried: true,
      ...(best.gear ? { gear: best.gear } : {}),
    };
  }
  return { displayName: "Unarmed strike", srd: null, unarmed: true, carried: true };
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
  // Another weapon is in the other hand, which is what Dueling refuses.
  otherWeaponInHand?: boolean;
  // Whether a monk's Martial Arts applies to this swing: false while they
  // wear armor or carry a shield (SRD 5.1, Martial Arts). Absent means "as
  // the riders say", which is what the hand and the PDF, with no armor
  // reading of their own, have always shown.
  martialArts?: boolean;
};

// SRD 5.1 monk weapons: shortswords and any simple melee weapon that has
// neither the two-handed nor the heavy property.
export function isMonkWeapon(srd: SrdWeapon | null): boolean {
  if (!srd || srd.kind !== "melee") {
    return false;
  }
  if (srd.name.toLowerCase() === "shortsword") {
    return true;
  }
  const properties = srd.properties ?? [];
  return srd.category === "simple" && !properties.includes("two-handed") && !properties.includes("heavy");
}

// The bigger of a weapon's own die and the Martial Arts die, which the monk
// may roll in its place ("1d6" against "d8" gives "1d8").
function martialDice(weaponDice: string, martialDie: string): string {
  const own = /^1d(\d+)$/.exec(weaponDice);
  const martial = /^d(\d+)$/.exec(martialDie);
  if (!own || !martial) {
    return weaponDice;
  }
  return Number(martial[1]) > Number(own[1]) ? `1${martialDie}` : weaponDice;
}

// The off-hand swing leaves the ability modifier off its damage, unless the
// modifier is negative (SRD 5.1, Two-Weapon Fighting): a penalty stays.
function offHandModifier(mod: number, stance: AttackStance): number {
  if (!stance.offHand || stance.riders?.twoWeaponKeepsAbility) {
    return mod;
  }
  return Math.min(0, mod);
}

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
  const martialArtsDie = stance.martialArts === false ? null : (riders?.martialArtsDie ?? null);
  if (!srd) {
    // Unarmed strike (1 + STR, always proficient) or improvised 1d4 + STR.
    // A monk's Martial Arts turns the unarmed strike into a real weapon:
    // their own die, and DEX when it beats Strength.
    const martial = resolved.unarmed ? martialArtsDie : null;
    const useDex = Boolean(martial) && derived.abilityMods.dex > derived.abilityMods.str;
    const mod = useDex ? derived.abilityMods.dex : derived.abilityMods.str;
    const dice = martial ? `1${martial}` : resolved.unarmed ? "1" : "1d4";
    if (martial) {
      notes.push(`Martial Arts: 1${martial}${useDex ? " with DEX" : ""}`);
    }
    return {
      weapon: resolved.displayName,
      toHit: mod + (resolved.unarmed ? derived.proficiencyBonus : 0),
      damageExpression: withModifier(dice, offHandModifier(mod, stance)),
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
      ...(resolved.unarmed ? { unarmed: true } : {}),
      ...(martial ? { martialArts: true } : {}),
      riderNotes: notes,
    };
  }
  const properties = srd.properties ?? [];
  // A monk weapon in a monk's hands: DEX when it beats Strength and the
  // Martial Arts die when it beats the weapon's own (SRD 5.1, Martial Arts).
  const monkWeapon = Boolean(martialArtsDie) && isMonkWeapon(srd);
  const finesse = properties.includes("finesse") || monkWeapon;
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
  // the SRD magic-weapon rule: the bonus its name declares, or the one its
  // entry gives (a Holy Avenger's +3), whichever is higher.
  const magicBonus = Math.max(magicItemBonus(resolved.displayName), resolved.gear?.riders.bonus ?? 0);
  const gearParts = gearProfileParts(resolved.gear, resolved.displayName, type);
  notes.push(...gearParts.notes);

  const inherentlyTwoHanded = properties.includes("two-handed");
  const versatile = properties.includes("versatile");
  const twoHanded = inherentlyTwoHanded || (versatile && stance.twoHanded === true);
  const heldDice = versatile && twoHanded ? versatileDice(dice) : dice;
  if (versatile && twoHanded) {
    notes.push(`two-handed: ${heldDice}`);
  }
  const damageDice = monkWeapon && martialArtsDie ? martialDice(heldDice, martialArtsDie) : heldDice;
  if (monkWeapon) {
    notes.push(`Martial Arts: ${damageDice}${dex > str ? " with DEX" : ""}`);
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
    if (
      !ranged &&
      !twoHanded &&
      !stance.offHand &&
      !stance.otherWeaponInHand &&
      riders.oneHandedMeleeDamageBonus
    ) {
      damageBonus += riders.oneHandedMeleeDamageBonus;
      notes.push(`Dueling: +${riders.oneHandedMeleeDamageBonus} damage`);
    }
  }
  const abilityToDamage = offHandModifier(mod, stance);
  if (stance.offHand && riders?.twoWeaponKeepsAbility) {
    notes.push("Two-Weapon Fighting: off-hand keeps its modifier");
  }

  return {
    weapon: resolved.displayName,
    toHit: mod + magicBonus + toHitBonus + (proficient ? derived.proficiencyBonus : 0),
    damageExpression: `${withModifier(damageDice, abilityToDamage + magicBonus + damageBonus)}${gearParts.suffix}`,
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
    // Sneak Attack rides on finesse and ranged weapons only; a monk weapon
    // swung with DEX is not thereby a finesse weapon.
    sneakEligible: properties.includes("finesse") || ranged,
    heavy: properties.includes("heavy"),
    ...(srd.longRangeFt
      ? { longRangeTiles: Math.max(rangeTiles, Math.round(srd.longRangeFt / 5)) }
      : {}),
    properties,
    ...(monkWeapon ? { martialArts: true } : {}),
    riderNotes: notes,
    ...gearParts.fields,
    ...(magicBonus > 0 ? { magicWeapon: true } : {}),
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
  sheet: {
    conditions: string[];
    level: number;
    classes?: Array<{ id: string; level: number }>;
    equipment?: Array<{ name: string; equipped?: boolean }>;
  },
  profile: Pick<AttackProfile, "ranged" | "ability">,
): number {
  // Rage gives nothing to a barbarian in heavy armor (rageApplies).
  if (!rageApplies(sheet) || profile.ranged || profile.ability !== "str") {
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
