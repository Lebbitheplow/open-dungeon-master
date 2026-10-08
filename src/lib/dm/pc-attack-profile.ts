// Which attack a pc_attack call is, and its numbers: a weapon from the pack,
// an attack-roll spell, a beast form's natural attack, or an attack a
// condition grants. Split from pc-attack.ts, which resolves the attack this
// module describes. Nothing is spent here and nothing is rolled: every
// return is either a refusal or a profile.

import { brawlerUnarmed } from "@/lib/srd/feat-combat";
import { getMounts } from "@/lib/db/mounts";
import { isValidExpression } from "@/lib/dice";
import { acBreakdownFor, computeSheetDerived, spellAttackFor, type SheetDerived } from "@/lib/srd";
import { spellDamageFor, spellFactsFor, spellMechanicsFor, spellSchoolFor } from "@/lib/content";
import { spellDamageRiders } from "@/lib/srd/spell-damage-riders";
import { isMeleeSpellAttack } from "@/lib/dm/spell-attack-riders";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { lastCastSlot } from "@/lib/dm/spell-effects";
import { castRedirect } from "@/lib/dm/cast-tools";
import {
  resolveAttackWeapon,
  spellAttackProfile,
  weaponAttackProfile,
  type AttackProfile,
} from "@/lib/dm/attack-logic";
import { handsRuling, otherHandArmed } from "@/lib/dm/attack-rules";
import { martialArtsApplies } from "@/lib/dm/pc-attack-options";
import { shillelaghSwing } from "@/lib/dm/attack-features";
import { combatRiders, type CombatRiders } from "@/lib/srd/feature-effects";
import { grantedAttackDice, grantedAttackFor } from "@/lib/srd/granted-attacks";
import { authoredNaturalWeapon, authoredReachBonus, naturalWeaponGated } from "@/lib/srd/authored-effects-more";
import { allSpellNames } from "@/lib/srd/spell-lists";
import { SPECIAL_WEAPONS } from "@/lib/srd/weapons";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { summonAttackProfile } from "@/lib/dm/summon-rules";

export type AttackKind = "weapon" | "spell" | "natural" | "granted";

export type BuiltAttack = {
  profile: AttackProfile;
  derived: SheetDerived;
  // Everything the character's features add to an attack: fighting styles,
  // Martial Arts, Sneak Attack, crit range, Brutal Critical, Divine Smite.
  riders: CombatRiders;
  // Set when the server derived the spell's dice itself, for the notes.
  scalingNote: string | null;
  // An attack a condition grants that rides a bonus action.
  grantedBonusAction: boolean;
  kind: AttackKind;
  // The two SRD weapons with a rule of their own.
  special: "net" | "lance" | null;
};

export function buildAttackProfile(
  campaignId: string,
  sheet: CharacterSheet,
  args: {
    weapon?: string;
    spell?: string;
    damage?: string;
    damageType?: string;
    twoHanded?: boolean;
    offHand?: boolean;
  },
): BuiltAttack | { error: string } {
  const derived = computeSheetDerived(sheet);
  const riders = combatRiders(sheet);
  let profile: AttackProfile;
  let scalingNote: string | null = null;
  let kind: AttackKind = "weapon";
  let special: BuiltAttack["special"] = null;
  // An attack option a condition grants (Starry Form's Archer, Spiritual
  // Weapon): the server owns its dice and it rides a bonus action.
  const grantedTerm = [args.weapon, args.spell].filter(Boolean).join(" ").trim();
  const granted = grantedTerm ? grantedAttackFor(sheet.conditions, grantedTerm) : null;
  let grantedBonusAction = false;
  const natural = !granted && !args.spell?.trim() ? authoredNaturalWeapon(sheet, args.weapon, derived.abilityMods) : null;
  if (granted) {
    if (derived.spellAttack === null) {
      return { error: `${sheet.name} has no spell attack bonus for ${granted.attack.name}.` };
    }
    // Cast from a higher slot, a scaling attack (Spiritual Weapon) rolls the
    // slot's dice: the level the condition carries, else the caster's last
    // casting of the spell on the audit trail.
    const slotLevel =
      (sheet.conditionMeta as ConditionMetaMap)[granted.condition]?.slotLevel ??
      (granted.attack.upcast ? lastCastSlot(sheet.id, granted.attack.name) : null);
    const dice = grantedAttackDice(granted.attack, sheet.level, slotLevel);
    const abilityMod =
      granted.attack.abilityToDamage && sheet.spellcasting
        ? derived.abilityMods[sheet.spellcasting.ability]
        : 0;
    profile = {
      weapon: granted.attack.name,
      toHit: derived.spellAttack,
      damageExpression:
        abilityMod > 0 ? `${dice}+${abilityMod}` : abilityMod < 0 ? `${dice}${abilityMod}` : dice,
      damageType: granted.attack.type,
      ranged: granted.attack.ranged,
      thrown: false,
      reachTiles: 1,
      rangeTiles: 12,
      proficient: true,
      improvised: false,
      ability: "dex",
      magicBonus: 0,
      twoHanded: false,
      sneakEligible: false,
      heavy: false,
      riderNotes: [
        `${granted.condition}: ${dice}${granted.attack.type ? ` ${granted.attack.type}` : ""}${
          granted.attack.bonusAction ? ", a bonus action" : ""
        }`,
      ],
    };
    grantedBonusAction = granted.attack.bonusAction;
    kind = "granted";
  } else if (args.spell?.trim()) {
    const spellName = args.spell.trim();
    if (!sheet.spellcasting) {
      return { error: `${sheet.name} cannot cast spells.` };
    }
    // The content pack knows how a known spell resolves; a save or buff
    // spell aimed through pc_attack is redirected to the right tool.
    const resolvedMech = spellMechanicsFor({ spell: spellName, userId: sheet.userId });
    const redirect = castRedirect(resolvedMech, "attack");
    if (redirect) {
      return { error: redirect };
    }
    const mechDamageType = resolvedMech?.mech.damageType;
    const spellList = allSpellNames(sheet.spellcasting);
    const onList = spellList.some(
      (entry) => entry.toLowerCase().includes(spellName.toLowerCase()) ||
        spellName.toLowerCase().includes(entry.toLowerCase()),
    );
    if (!onList) {
      return {
        error: `${spellName} is not on ${sheet.name}'s spell list; they cannot cast it.`,
      };
    }
    // The content pack knows what this spell rolls at this level, including
    // cantrip scaling the model routinely forgets. Its answer wins; the
    // model's dice are the fallback for spells that do not parse.
    const scaled = spellDamageFor({
      spell: spellName,
      userId: sheet.userId,
      casterLevel: sheet.level,
    });
    // A spell attack that deals no damage (Ray of Enfeeblement) rolls none.
    const damageArg = scaled?.dice ?? ((args.damage ?? "").trim() || (resolvedMech?.mech.noDamage ? "0" : ""));
    if (!damageArg || !isValidExpression(damageArg)) {
      return {
        error: `Spell attacks need the spell's damage dice, e.g. damage="1d10". Send pc_attack again with a damage expression.`,
      };
    }
    if (scaled) {
      scalingNote = scaled.note;
    }
    // Multiclass: the to-hit follows the class whose list carries the spell.
    const spellProfile = spellAttackProfile(
      { spellAttack: spellAttackFor(sheet, spellName) ?? derived.spellAttack },
      spellName,
      damageArg,
      // A known spell deals its own damage type; the caller's word counts
      // only for a spell the content does not know (SRD 5.1).
      (mechDamageType || args.damageType || "").trim().toLowerCase(),
    );
    if (!spellProfile) {
      return { error: `${sheet.name} has no spell attack bonus.` };
    }
    // A melee spell attack (a touch) is a melee attack: it reaches only the
    // creature beside the caster, and the rules for ranged attacks do not
    // apply to it.
    const melee = isMeleeSpellAttack(spellName, spellFactsFor(spellName, sheet.userId)?.range.kind);
    profile = melee ? { ...spellProfile, ranged: false, reachTiles: 1, rangeTiles: 1 } : spellProfile;
    kind = "spell";
    // Option riders on named attack spells (Agonizing Blast: +CHA per
    // Eldritch Blast beam).
    for (const rider of riders.cantripAbilityRiders) {
      if (spellName.toLowerCase().includes(rider.spell)) {
        const mod =
          derived.abilityMods[rider.ability as keyof typeof derived.abilityMods] ?? 0;
        if (mod > 0) {
          profile = {
            ...profile,
            damageExpression: `${profile.damageExpression}+${mod}`,
            riderNotes: [...profile.riderNotes, `${rider.feature}: +${mod} damage`],
          };
        }
      }
    }
    // Empowered Evocation, Elemental Affinity (src/lib/srd/spell-damage-riders.ts).
    const facts = spellFactsFor(spellName, sheet.userId);
    const spellRiders = spellDamageRiders(sheet, { school: spellSchoolFor(spellName, sheet.userId), damageType: mechDamageType || args.damageType, level: facts?.level ?? 0, classes: facts?.classes });
    if (spellRiders.flat > 0 || spellRiders.dice.length) {
      const extra = [...spellRiders.dice, ...(spellRiders.flat > 0 ? [String(spellRiders.flat)] : [])].join("+");
      profile = { ...profile, damageExpression: `${profile.damageExpression}+${extra}`, riderNotes: [...profile.riderNotes, ...spellRiders.notes] };
    }
  } else if (sheet.summon && !sheet.wildShape) {
    // A creature a spell made fights with its stat block (summon-rules.ts).
    const summoned = summonAttackProfile(sheet, args.weapon);
    if (!summoned || "error" in summoned) {
      return summoned ?? { error: `${sheet.name} has no attack.` };
    }
    profile = summoned;
    kind = "natural";
  } else if (!sheet.wildShape?.attacks?.length && (natural || naturalWeaponGated(sheet, args.weapon))) {
    // A weapon a subclass feature is (Form of the Beast's claws, the
    // Soulknife's psychic blade, Radiant Sun Bolt): a proficient weapon of
    // its kind, with no item behind it (src/lib/srd/authored-effects-more.ts).
    if (!natural) {
      return { error: `${sheet.name}'s ${args.weapon} exists only while raging (${naturalWeaponGated(sheet, args.weapon)}). They rage first (use_resource Rage), or attack with a weapon they carry.` };
    }
    // The bonus-action second blade keeps its modifier and rolls its own die.
    const srd = args.offHand && natural.second ? { ...natural.srd, damage: `${natural.second} ${natural.weapon.type}` } : natural.srd;
    profile = weaponAttackProfile(derived, [...sheet.proficiencies.weapons, "simple", srd.name.toLowerCase()], { displayName: srd.name, srd, unarmed: false, carried: true }, {
      riders,
      martialArts: false,
    });
    profile = { ...profile, proficient: true, riderNotes: [...profile.riderNotes, `${natural.feature}: ${srd.damage}`] };
    kind = "weapon";
  } else if (sheet.wildShape?.attacks?.length) {
    // Transformed: the form's natural attacks replace the sheet's weapons,
    // with the statblock's own to-hit and damage. A named attack matches
    // loosely ("bite the goblin" -> Bite); no name takes the first attack.
    const wantedAttack = (args.weapon ?? "").trim().toLowerCase();
    const natural =
      sheet.wildShape.attacks.find(
        (attack) =>
          wantedAttack &&
          (attack.name.toLowerCase().includes(wantedAttack) ||
            wantedAttack.includes(attack.name.toLowerCase())),
      ) ?? sheet.wildShape.attacks[0];
    profile = {
      weapon: `${sheet.wildShape.form} ${natural.name}`,
      toHit: natural.toHit,
      damageExpression: natural.damage,
      damageType: natural.type,
      ranged: false,
      thrown: false,
      reachTiles: 1,
      rangeTiles: 1,
      proficient: true,
      improvised: false,
      ability: "str",
      magicBonus: 0,
      twoHanded: false,
      sneakEligible: false,
      heavy: false,
      riderNotes: [`natural attack while transformed (${sheet.wildShape.form})`],
    };
    kind = "natural";
  } else {
    const resolved = resolveAttackWeapon(sheet.equipment, sheet.proficiencies.weapons, args.weapon);
    if (resolved.carried === false) {
      return {
        error: `${sheet.name} carries no ${resolved.displayName}. They attack with a weapon from their equipment, with an unarmed strike, or with something they pick up (an improvised weapon, named for what it is).`,
      };
    }
    // Hands: a shield on the arm leaves one free.
    const properties = resolved.srd?.properties ?? [];
    const shieldName = acBreakdownFor(sheet).shieldName;
    const lance = resolved.srd?.name === SPECIAL_WEAPONS.lance;
    const hands = handsRuling({
      who: sheet.name,
      weapon: resolved.displayName,
      properties,
      lance,
      mounted: Boolean(getMounts(campaignId)[sheet.id]),
      twoHandedAsked: args.twoHanded === true,
      shieldName,
    });
    if ("error" in hands) {
      return hands;
    }
    // Shillelagh: a club or quarterstaff swings with the spellcasting
    // ability and a d8, and is magical (src/lib/dm/attack-features.ts).
    const shillelagh = shillelaghSwing(sheet, resolved, derived);
    profile = weaponAttackProfile(shillelagh?.derived ?? derived, sheet.proficiencies.weapons, shillelagh?.resolved ?? resolved, {
      riders,
      martialArts: martialArtsApplies(sheet),
      brawler: brawlerUnarmed(sheet),
      twoHanded: hands.twoHanded,
      offHand: args.offHand,
      otherWeaponInHand: otherHandArmed({
        equipment: sheet.equipment,
        weapon: resolved.displayName,
        shieldName,
      }),
    });
    if (hands.note) {
      profile = { ...profile, riderNotes: [...profile.riderNotes, hands.note] };
    }
    if (shillelagh) {
      profile = { ...profile, magicWeapon: true, riderNotes: [...profile.riderNotes, shillelagh.note] };
    }
    kind = "weapon";
    special = lance ? "lance" : resolved.srd?.name === SPECIAL_WEAPONS.net ? "net" : null;
  }
  // Demiurgic Colossus: a raging giant's melee reach grows by 5 feet.
  const reach = kind === "weapon" && !profile.ranged ? authoredReachBonus(sheet) : null;
  if (reach) {
    profile = { ...profile, reachTiles: profile.reachTiles + reach.tiles, riderNotes: [...profile.riderNotes, `${reach.feature}: ${reach.tiles * 5} more feet of reach`] };
  }
  return { profile, derived, riders, scalingNote, grantedBonusAction, kind, special };
}
