// Which attack a pc_attack call is, and its numbers: a weapon from the pack,
// an attack-roll spell, a beast form's natural attack, or an attack a
// condition grants. Split from pc-attack.ts, which resolves the attack this
// module describes. Nothing is spent here and nothing is rolled: every
// return is either a refusal or a profile.

import { getMounts } from "@/lib/db/mounts";
import { isValidExpression } from "@/lib/dice";
import { acBreakdownFor, computeSheetDerived, spellAttackFor, type SheetDerived } from "@/lib/srd";
import { spellDamageFor, spellMechanicsFor } from "@/lib/content";
import { castRedirect } from "@/lib/dm/cast-tools";
import {
  resolveAttackWeapon,
  spellAttackProfile,
  weaponAttackProfile,
  type AttackProfile,
} from "@/lib/dm/attack-logic";
import { handsRuling, otherHandArmed } from "@/lib/dm/attack-rules";
import { combatRiders, type CombatRiders } from "@/lib/srd/feature-effects";
import { grantedAttackDice, grantedAttackFor } from "@/lib/srd/condition-effects";
import { allSpellNames } from "@/lib/srd/spell-lists";
import { SPECIAL_WEAPONS } from "@/lib/srd/weapons";
import type { CharacterSheet } from "@/lib/schemas/sheet";

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
  if (granted) {
    if (derived.spellAttack === null) {
      return { error: `${sheet.name} has no spell attack bonus for ${granted.attack.name}.` };
    }
    const dice = grantedAttackDice(granted.attack, sheet.level);
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
    const damageArg = scaled?.dice ?? (args.damage ?? "").trim();
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
      (args.damageType ?? mechDamageType ?? "").trim().toLowerCase(),
    );
    if (!spellProfile) {
      return { error: `${sheet.name} has no spell attack bonus.` };
    }
    profile = spellProfile;
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
    profile = weaponAttackProfile(derived, sheet.proficiencies.weapons, resolved, {
      riders,
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
    kind = "weapon";
    special = lance ? "lance" : resolved.srd?.name === SPECIAL_WEAPONS.net ? "net" : null;
  }
  return { profile, derived, riders, scalingNote, grantedBonusAction, kind, special };
}
