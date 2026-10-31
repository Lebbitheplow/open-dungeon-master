import {
  damageScore,
  isWeaponProficient,
  matchWeapon,
  weaponNamed,
  type SrdWeapon,
} from "@/lib/srd/weapons";
import { lineNamed, magicItemBonus, withoutBonus } from "@/lib/srd/item-row";
import { wearingIsExplicit } from "@/lib/srd/armor";
import {
  gearProfileParts,
  isMagicWeaponName,
  magicWeaponOfRow,
  type WeaponGear,
} from "@/lib/dm/gear-attack";
import type { TypedRider } from "@/lib/dm/damage-parts";
import type { CreatureOnHit } from "@/lib/srd/creature-attacks";
import type { GearDice } from "@/lib/srd/magic-gear";
import type { WornWeaponRider } from "@/lib/srd/magic-items";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import { rageDamageBonus } from "@/lib/srd/class-resources";
import { rageApplies, type WeaponMaterial } from "@/lib/dm/damage-logic";
import type { EquipmentItem } from "@/lib/schemas/sheet";
import type { SheetDerived } from "@/lib/srd";
import { textKey } from "@/lib/language/text-logic";
import { gearWeaponFor, type GearWeapon } from "@/lib/srd/gear-weapons";

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
  // A real weapon used as an improvised one (SRD 5.1 Weapons, Improvised
  // Weapons): a melee weapon without the thrown property thrown, or a
  // ranged weapon swung in melee. `srd` is then null and this is the
  // weapon it is, for its damage type.
  improvisedFrom?: SrdWeapon;
  // The object swung as any object: a gear entry's own hit does not apply
  // (a torch thrown, not swung: its 1 fire is for a melee attack).
  bareObject?: boolean;
};

export type AttackProfile = {
  weapon: string;
  // The SRD weapon it swings as, by its row's name (a Flame Tongue is a
  // Longsword): what the ammunition and the feats keyed to a weapon read,
  // never the name it is carried under. Absent for an unarmed strike or an
  // improvised weapon.
  base?: string;
  // The wielded item's material, for the resistances that name it
  // (damage-logic.ts weaponMaterial).
  material?: WeaponMaterial;
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
  // A creature's natural attack (a beast form, a summoned creature): what
  // its hit does besides the damage (src/lib/dm/natural-onhit.ts), and the
  // "one prone creature" its hooves and stomps strike only.
  creatureOnHit?: CreatureOnHit;
  proneTargetsOnly?: boolean;
  // A flask thrown or a torch swung (src/lib/srd/gear-weapons.ts): the
  // flask spent, holy water's targets, what the hit leaves.
  gearWeapon?: GearWeapon;
};

// The weapon block a homebrew item snapshotted onto its equipment line, if
// it has one.
export function weaponOf(item: EquipmentItem | undefined): SrdWeapon | null {
  const weapon = item?.gear?.weapon as SrdWeapon | undefined;
  return weapon && typeof weapon.damage === "string" ? weapon : null;
}

// Which weapon the character attacks with. A named weapon is the carried
// line that name picks out (src/lib/srd/item-row.ts lineNamed), and
// "unarmed strike" is the rules' own; no name picks the best proficient
// carried weapon; nothing usable falls back to an unarmed strike. A name
// that is no carried line is "carried: false" unless the attack says it is
// an improvised object, and a weapon of the table is never improvised.
// `shieldOnArm`: a two-handed weapon cannot be used with a shield on the arm
// (attack-rules.ts handsRuling), so the unnamed pick prefers one that can.
export function resolveAttackWeapon(
  equipment: EquipmentItem[],
  weaponProfs: string[],
  weaponArg: string | undefined,
  options: { shieldOnArm?: boolean; improvised?: boolean } = {},
): ResolvedWeapon {
  const arg = (weaponArg ?? "").trim();
  if (arg) {
    if (textKey(arg) === "unarmed strike") {
      return { displayName: "Unarmed strike", srd: null, unarmed: true, carried: true };
    }
    // Sent with a bonus its weapon lacks ("+3 Longsword" of a plain one),
    // the attack is the weapon carried, at that weapon's own bonus; sent as
    // the table's weapon by another spelling it answers to ("long sword"),
    // the line whose row it is, when only one line is, or one is called by
    // the row's own name.
    const named = weaponNamed(arg);
    const ofWeapon = named ? equipment.filter((item) => matchWeapon(item) === named) : [];
    const carriedItem =
      equipment[lineNamed(equipment, arg)] ??
      equipment[lineNamed(equipment, withoutBonus(arg))] ??
      (named ? equipment[lineNamed(equipment, named.name)] : undefined) ??
      (new Set(ofWeapon.map((item) => textKey(item.name))).size === 1 ? ofWeapon[0] : undefined);
    // A carried homebrew weapon carries its own block (src/lib/homebrew/
    // gear.ts) and wins over a name that happens to resemble an SRD one. A
    // carried magic weapon swings as its base weapon (src/lib/dm/
    // gear-attack.ts): a Flame Tongue is a longsword.
    const magic = carriedItem ? magicWeaponOfRow(carriedItem) : null;
    const srd =
      (magic?.gear ? magic.srd : null) ??
      weaponOf(carriedItem) ??
      named ??
      (carriedItem ? matchWeapon(carriedItem) : null);
    return {
      displayName: carriedItem?.name ?? srd?.name ?? arg,
      srd,
      unarmed: false,
      // A name that is a weapon on the table and on nobody's back is not
      // theirs to swing. A name that is no weapon at all is whatever they
      // picked up, when the attack says so.
      carried: Boolean(carriedItem) || (options.improvised === true && srd === null && !isMagicWeaponName(arg)),
      ...(magic?.gear ? { gear: magic.gear } : {}),
    };
  }
  // No name given: best carried weapon, one the hands can use first, then
  // the one in hand (issue #424: a character holding a mace was played with
  // the crossbow in the pack), then proficient ones, then the most damage.
  // With only two-handed weapons beside a shield the best of them still
  // stands, and the hands rule says why it cannot swing. A sheet that marks
  // nothing as equipped holds everything, as the armor engine reads it.
  const explicit = wearingIsExplicit(equipment);
  let best: {
    item: EquipmentItem;
    srd: SrdWeapon;
    usable: boolean;
    held: boolean;
    proficient: boolean;
    gear: WeaponGear | null;
  } | null = null;
  for (const item of equipment) {
    const magic = magicWeaponOfRow(item);
    const srd = (magic.gear ? magic.srd : null) ?? weaponOf(item) ?? magic.srd ?? null;
    if (!srd) {
      continue;
    }
    const usable = !(options.shieldOnArm && (srd.properties ?? []).includes("two-handed"));
    const held = !explicit || item.equipped === true;
    const proficient = isWeaponProficient(weaponProfs, srd);
    const better = (() => {
      if (!best) return true;
      if (usable !== best.usable) return usable;
      if (held !== best.held) return held;
      if (proficient !== best.proficient) return proficient;
      return damageScore(srd) > damageScore(best.srd);
    })();
    if (better) {
      best = { item, srd, usable, held, proficient, gear: magic?.gear ?? null };
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

// SRD 5.1 Weapons, Improvised Weapons: "If a character uses a ranged weapon
// to make a melee attack, or throws a melee weapon that does not have the
// thrown property, it also deals 1d4 damage." A carried weapon sent with
// improvised true is that use: a ranged weapon (not one made to be thrown,
// a dart or a net) always, and a melee weapon without the thrown property
// unless the board shows the target in its reach, where the swing is the
// weapon's own (issue #570, EQP-11: the improvised flag was read only for a
// name that is no weapon, so a longsword thrown 15 feet was refused for
// melee reach). Null when the weapon is used as itself.
export function improvisedUse(resolved: ResolvedWeapon, apart: number | null): ResolvedWeapon | null {
  const srd = resolved.srd;
  if (!srd || resolved.unarmed || resolved.carried === false) {
    return null;
  }
  const properties = srd.properties ?? [];
  if (properties.includes("thrown")) {
    return null;
  }
  const reach = properties.includes("reach") ? 2 : 1;
  if (srd.kind === "melee" && apart !== null && apart <= reach) {
    return null;
  }
  return { displayName: resolved.displayName, srd: null, unarmed: false, carried: true, improvisedFrom: srd };
}

// The profile of a flask thrown or a torch swung, as the gear's own entry
// reads (src/lib/srd/gear-weapons.ts): an improvised weapon, so no
// proficiency bonus; a flask is a ranged attack thrown up to 20 feet with no
// long range, so Dexterity, and the torch a melee one with Strength; the
// damage is the entry's, with no ability modifier.
function gearWeaponProfile(
  derived: Pick<SheetDerived, "abilityMods" | "proficiencyBonus">,
  resolved: ResolvedWeapon,
  gear: GearWeapon,
): AttackProfile {
  const ability = gear.thrown ? "dex" : "str";
  const what = gear.dice ? `${gear.dice}${gear.type ? ` ${gear.type}` : ""}` : gear.leaves === "burning" ? "1d4 fire at the start of each of its turns" : "covers the target in oil";
  return {
    weapon: resolved.displayName,
    toHit: derived.abilityMods[ability],
    damageExpression: gear.dice ?? "0",
    damageType: gear.type,
    ranged: gear.thrown,
    // A torch can still be thrown, as any object (pc-attack-profile.ts
    // swaps in the bare object's profile past its reach).
    thrown: !gear.thrown,
    reachTiles: 1,
    rangeTiles: 4,
    longRangeTiles: gear.thrown ? 4 : 12,
    proficient: false,
    improvised: true,
    ability,
    magicBonus: 0,
    twoHanded: false,
    sneakEligible: false,
    heavy: false,
    riderNotes: [`${gear.name}: ${gear.thrown ? "thrown up to 20 ft, " : ""}${what}${gear.fiendsAndUndeadOnly ? " against a fiend or undead only" : ""}${gear.spent ? ", spent whatever the roll" : ""}`],
    gearWeapon: gear,
  };
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
  // Tavern Brawler: the unarmed strike deals 1d4 (src/lib/srd/feat-combat.ts).
  brawler?: boolean;
  // What worn items add to attacks with some weapons (Bracers of Archery),
  // from src/lib/srd/magic-items.ts magicItemRiders(...).weaponRiders.
  worn?: WornWeaponRider[];
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
    const gear = resolved.unarmed || resolved.improvisedFrom || resolved.bareObject ? null : gearWeaponFor(resolved.displayName);
    if (gear) {
      return gearWeaponProfile(derived, resolved, gear);
    }
    // Unarmed strike (1 + STR, always proficient) or improvised 1d4 + STR.
    // A monk's Martial Arts turns the unarmed strike into a real weapon:
    // their own die, and DEX when it beats Strength.
    const martial = resolved.unarmed ? martialArtsDie : null;
    const useDex = Boolean(martial) && derived.abilityMods.dex > derived.abilityMods.str;
    const mod = useDex ? derived.abilityMods.dex : derived.abilityMods.str;
    const dice = martial ? `1${martial}` : resolved.unarmed ? (stance.brawler ? "1d4" : "1") : "1d4";
    if (martial) {
      notes.push(`Martial Arts: 1${martial}${useDex ? " with DEX" : ""}`);
    } else if (resolved.unarmed && stance.brawler) {
      notes.push("Tavern Brawler: the unarmed strike deals 1d4");
    }
    // A thrown melee weapon keeps its own type (a longsword's edge still
    // cuts); a bow or a crossbow swung in melee is a club.
    const from = resolved.improvisedFrom;
    const damageType = from?.kind === "melee" ? splitDamage(from.damage).type || "bludgeoning" : "bludgeoning";
    return {
      weapon: resolved.displayName,
      toHit: mod + (resolved.unarmed ? derived.proficiencyBonus : 0),
      damageExpression: withModifier(dice, offHandModifier(mod, stance)),
      damageType,
      ranged: false,
      thrown: !resolved.unarmed,
      reachTiles: 1,
      rangeTiles: 4,
      // "An improvised thrown weapon has a normal range of 20 feet and a
      // long range of 60 feet."
      ...(resolved.unarmed ? {} : { longRangeTiles: 12 }),
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
  // SRD 5.1, Bracers of Archery: "you have proficiency with the longbow and
  // shortbow, and you gain a +2 bonus to damage rolls on ranged attacks made
  // with such weapons".
  const wornRiders = (stance.worn ?? []).filter((rider) => rider.weapons.includes(textKey(srd.name)) && (!rider.ranged || srd.kind === "ranged"));
  const proficient = isWeaponProficient(weaponProfs, srd) || wornRiders.some((rider) => rider.proficient);
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
  for (const rider of wornRiders) {
    if (rider.damage) {
      damageBonus += rider.damage;
      notes.push(`${rider.source}: +${rider.damage} damage`);
    }
  }
  const abilityToDamage = offHandModifier(mod, stance);
  if (stance.offHand && riders?.twoWeaponKeepsAbility) {
    notes.push("Two-Weapon Fighting: off-hand keeps its modifier");
  }

  return {
    weapon: resolved.displayName,
    base: srd.name,
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
export function spellAttackProfile(derived: { spellAttack: number }, spellName: string, damageExpression: string, damageType: string): AttackProfile;
export function spellAttackProfile(derived: Pick<SheetDerived, "spellAttack">, spellName: string, damageExpression: string, damageType: string): AttackProfile | null;
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
