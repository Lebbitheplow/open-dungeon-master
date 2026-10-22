// Which attack a pc_attack call is, and its numbers: a weapon from the pack,
// an attack-roll spell, a beast form's natural attack, or an attack a
// condition grants. Split from pc-attack.ts, which resolves the attack this
// module describes. Nothing is spent here and nothing is rolled: every
// return is either a refusal or a profile.

import { sheetSpellAuthors } from "@/lib/dm/spell-authors";
import { brawlerUnarmed } from "@/lib/srd/feat-combat";
import { getMounts } from "@/lib/db/mounts";
import { isValidExpression } from "@/lib/dice";
import { acBreakdownFor, computeSheetDerived, spellAttackFor, type SheetDerived, castsSpells } from "@/lib/srd";
import { spellDamageFor, spellEngineName, spellFactsFor, spellMechanicsFor, spellSchoolFor } from "@/lib/content";
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
import { handsRuling, otherHandArmed, thrownAtRange } from "@/lib/dm/attack-rules";
import { martialArtsApplies } from "@/lib/dm/pc-attack-options";
import { shillelaghSwing, hexWarriorSwing } from "@/lib/dm/attack-features";
import { combatRiders, type CombatRiders } from "@/lib/srd/feature-effects";
import { grantedAttackConditions, grantedAttackDice, grantedAttackFor } from "@/lib/srd/granted-attacks";
import { authoredNaturalWeapon, authoredReachBonus, naturalWeaponGated } from "@/lib/srd/authored-effects-more";
import { racialNaturalWeapon } from "@/lib/srd/racial-weapons";
import { allSpellNames } from "@/lib/srd/spell-lists";
import { matchWeapon, SPECIAL_WEAPONS } from "@/lib/srd/weapons";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { summonAttackProfile } from "@/lib/dm/summon-rules";
import { naturalAttackProfile, pickNaturalAttack } from "@/lib/dm/natural-attack";
import { findBeastForm } from "@/lib/srd/beast-forms";
import type { CreatureAttack } from "@/lib/srd/creature-attacks";
import { noneNamed, type ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { weaponMaterial } from "@/lib/dm/damage-logic";
import { hasName, namesOf } from "@/lib/dm/cast-rules";

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
  // The granted attack that may ride its activation's bonus action, by name.
  grantedWithActivation: string | null;
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
    improvised?: boolean;
  },
  // How many tiles lie between the attacker and the target, when the board
  // knows (a thrown weapon past its reach is a ranged attack).
  target: { apart: number | null } = { apart: null },
): BuiltAttack | ToolError {
  const derived = computeSheetDerived(sheet);
  const riders = combatRiders(sheet);
  let profile: AttackProfile;
  let scalingNote: string | null = null;
  let kind: AttackKind = "weapon";
  let special: BuiltAttack["special"] = null;
  // An attack option a condition grants (Starry Form's Archer, Spiritual
  // Weapon): the server owns its dice and it rides a bonus action.
  const weaponName = args.weapon ?? "";
  const granted = grantedAttackFor(sheet.conditions, args.weapon ?? "", args.spell ?? "");
  let grantedBonusAction = false;
  let grantedWithActivation: string | null = null;
  const natural = !granted && !args.spell?.trim() ? authoredNaturalWeapon(sheet, weaponName, derived.abilityMods) : null;
  // A beast form's natural attacks (an empty list for a form with none), or
  // null for a form the table does not know.
  const shapedAttacks = shapeAttacks(sheet.wildShape);
  // A lineage's bite or claws (src/lib/srd/racial-weapons.ts).
  const racial = !granted && !natural && !args.spell?.trim() && !sheet.wildShape ? racialNaturalWeapon(sheet.features, weaponName) : null;
  if (granted) {
    if (derived.spellAttack === null) {
      return { error: `${sheet.name}'s sheet has no spell attack bonus (no spellcasting ability), so ${granted.attack.name} cannot be rolled.`, refused: "rules" };
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
    // The attack that comes with the activation (its condition still at its
    // full duration, so laid this turn) rides the activation's own bonus
    // action; pc-attack-spend.ts decides once it sees the turn.
    const whole = granted.attack.withActivation;
    grantedWithActivation = whole && ((sheet.conditionMeta as ConditionMetaMap)[granted.condition]?.rounds ?? 0) >= whole ? granted.attack.name : null;
    kind = "granted";
  } else if (args.spell?.trim()) {
    const spellName = args.spell.trim();
    if (!castsSpells(sheet)) {
      return { error: `${sheet.name} cannot cast spells.`, refused: "rules" };
    }
    // The content pack knows how a known spell resolves; a save or buff
    // spell aimed through pc_attack is redirected to the right tool.
    const resolvedMech = spellMechanicsFor({ spell: spellName, userIds: sheetSpellAuthors(sheet) });
    const redirect = castRedirect(resolvedMech, "attack");
    if (redirect) {
      return redirect;
    }
    const mechDamageType = resolvedMech?.mech.damageType;
    const spellList = allSpellNames(sheet.spellcasting);
    const spellNames = namesOf(spellName, spellFactsFor(spellName, sheetSpellAuthors(sheet)));
    const onList = hasName(spellList, spellNames);
    if (!onList) {
      // A spell the rules know is one they lack; a name nobody knows is the
      // call's to fix, from their list.
      return spellFactsFor(spellName, sheetSpellAuthors(sheet))
        ? { error: `${spellName} is not on ${sheet.name}'s spell list; they cannot cast it.`, refused: "rules" }
        : {
            error: `No spell called "${spellName}" is known. ${sheet.name}'s spells are ${spellList.join(", ") || "none"}: send the one meant, by the name on the sheet.`,
            retry: true,
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
        retry: true,
      };
    }
    if (scaled) {
      scalingNote = scaled.note;
    }
    // Multiclass: the to-hit follows the class whose list carries the spell.
    const spellProfile = spellAttackProfile(
      { spellAttack: spellAttackFor(sheet, spellName) },
      spellName,
      damageArg,
      // A known spell deals its own damage type; the caller's word counts
      // only for a spell the content does not know (SRD 5.1).
      (mechDamageType || args.damageType || "").trim().toLowerCase(),
    );
    // A melee spell attack (a touch) is a melee attack: it reaches only the
    // creature beside the caster, and the rules for ranged attacks do not
    // apply to it.
    const melee = isMeleeSpellAttack(spellEngineName(spellName, sheetSpellAuthors(sheet)), spellFactsFor(spellName, sheetSpellAuthors(sheet))?.range.kind);
    profile = melee ? { ...spellProfile, ranged: false, reachTiles: 1, rangeTiles: 1 } : spellProfile;
    kind = "spell";
    // Option riders on named attack spells (Agonizing Blast: +CHA per
    // Eldritch Blast beam).
    for (const rider of riders.cantripAbilityRiders) {
      if (spellNames.has(textKey(rider.spell))) {
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
    const facts = spellFactsFor(spellName, sheetSpellAuthors(sheet));
    const spellRiders = spellDamageRiders(sheet, { school: spellSchoolFor(spellName, sheetSpellAuthors(sheet)), damageType: mechDamageType || args.damageType, level: facts?.level ?? 0, classes: facts?.classes });
    if (spellRiders.flat > 0 || spellRiders.dice.length) {
      const extra = [...spellRiders.dice, ...(spellRiders.flat > 0 ? [String(spellRiders.flat)] : [])].join("+");
      profile = { ...profile, damageExpression: `${profile.damageExpression}+${extra}`, riderNotes: [...profile.riderNotes, ...spellRiders.notes] };
    }
  } else if (sheet.summon && !sheet.wildShape) {
    // A creature a spell made fights with its stat block (summon-rules.ts).
    const summoned = summonAttackProfile(sheet, args.weapon);
    if (!summoned || "error" in summoned) {
      return summoned ?? { error: `${sheet.name}'s stat block has no attack.`, refused: "rules" };
    }
    profile = summoned;
    kind = "natural";
  } else if (shapedAttacks && !shapedAttacks.length) {
    // A form whose stat block has no attack (a frog, a sea horse): the
    // character's weapons melded into it, so there is nothing to swing.
    return { error: `${sheet.name}'s ${sheet.wildShape?.form} form has no attack: its stat block has none, and ${sheet.name}'s own weapons merged into the form. Nothing was rolled.`, refused: "rules" };
  } else if (racial) {
    profile = weaponAttackProfile(derived, [...sheet.proficiencies.weapons, "simple", racial.srd.name.toLowerCase()], { displayName: racial.srd.name, srd: racial.srd, unarmed: false, carried: true }, {
      riders,
      martialArts: false,
    });
    profile = { ...profile, proficient: true, riderNotes: [...profile.riderNotes, `${racial.feature}: ${racial.srd.damage}`] };
    kind = "weapon";
  } else if (!shapedAttacks?.length && (natural || naturalWeaponGated(sheet, weaponName))) {
    // A weapon a subclass feature is (Form of the Beast's claws, the
    // Soulknife's psychic blade, Radiant Sun Bolt): a proficient weapon of
    // its kind, with no item behind it (src/lib/srd/authored-effects-more.ts).
    if (!natural) {
      return { error: `${sheet.name}'s ${args.weapon} exists only while raging (${naturalWeaponGated(sheet, weaponName)}). They rage first (use_resource Rage), or attack with a weapon they carry.`, refused: "rules" };
    }
    // The bonus-action second blade keeps its modifier and rolls its own die.
    const srd = args.offHand && natural.second ? { ...natural.srd, damage: `${natural.second} ${natural.weapon.type}` } : natural.srd;
    profile = weaponAttackProfile(derived, [...sheet.proficiencies.weapons, "simple", srd.name.toLowerCase()], { displayName: srd.name, srd, unarmed: false, carried: true }, {
      riders,
      martialArts: false,
    });
    profile = { ...profile, proficient: true, riderNotes: [...profile.riderNotes, `${natural.feature}: ${srd.damage}`] };
    kind = "weapon";
  } else if (shapedAttacks?.length && sheet.wildShape) {
    // Transformed: the form's natural attacks replace the sheet's weapons,
    // with the statblock's own to-hit, damage, riders and reach. The attack
    // is named whole, or is the form's only one.
    const form = sheet.wildShape.form;
    const natural = pickNaturalAttack(shapedAttacks, args.weapon);
    if (!natural) {
      const names = shapedAttacks.map((attack) => attack.name);
      return args.weapon?.trim()
        ? noneNamed(`${sheet.name}'s ${form} form has no attack called`, args.weapon.trim(), names)
        : { error: `${sheet.name}'s ${form} form has several attacks; name one in weapon: ${names.join(", ")}.`, retry: true };
    }
    profile = naturalAttackProfile(natural, { weapon: `${form} ${natural.name}`, note: `natural attack while transformed (${form})` });
    kind = "natural";
  } else {
    // Hands: a shield on the arm leaves one free, and the off-hand swing
    // has the other weapon in the other hand. An unnamed weapon is picked
    // with the shield in mind.
    const shieldName = acBreakdownFor(sheet).shieldName;
    const resolved = resolveAttackWeapon(sheet.equipment, sheet.proficiencies.weapons, args.weapon, {
      shieldOnArm: shieldName !== null,
      improvised: args.improvised === true,
    });
    if (resolved.carried === false) {
      const weapons = sheet.equipment
        .filter((item) => !resolveAttackWeapon([item], [], undefined).unarmed)
        .map((item) => item.name);
      const carried = weapons.length ? `Their weapons: ${weapons.join(", ")}.` : "They carry no weapon.";
      // A weapon of the table on nobody's back is the game's no; a name that
      // is no weapon at all is the call's mistake, resent with improvised.
      const alike = resolved.srd ? sheet.equipment.filter((item) => matchWeapon(item) === resolved.srd).map((item) => item.name) : [];
      if (alike.length > 1) {
        return { error: `${sheet.name} carries more than one ${resolved.srd?.name}: ${alike.join(", ")}. Send the one they swing by its name. Nothing was rolled.`, retry: true };
      }
      if (resolved.srd || resolved.gear) {
        return {
          error: `${sheet.name} carries no ${resolved.displayName}. ${carried} They attack with one of those, with an unarmed strike, or with an object they pick up (improvised true).`,
          refused: "rules",
        };
      }
      const refusal = noneNamed(`${sheet.name} carries no weapon called`, args.weapon ?? "", [...weapons, ...grantedAttackConditions(sheet.conditions), "unarmed strike"]);
      return { ...refusal, error: `${refusal.error} An object they pick up and swing is sent by what it is with improvised true. Nothing was rolled.` };
    }
    const properties = resolved.srd?.properties ?? [];
    const lance = resolved.srd?.name === SPECIAL_WEAPONS.lance;
    const hands = handsRuling({
      who: sheet.name,
      weapon: resolved.displayName,
      properties,
      lance,
      mounted: Boolean(getMounts(campaignId)[sheet.id]),
      twoHandedAsked: args.twoHanded === true,
      shieldName,
      offHand: args.offHand === true,
    });
    if ("error" in hands) {
      return hands;
    }
    // Shillelagh: a club or quarterstaff swings with the spellcasting
    // ability and a d8, and is magical (src/lib/dm/attack-features.ts).
    const shillelagh = shillelaghSwing(sheet, resolved, derived);
    // Hex Warrior: the bound weapon swings with Charisma (attack-features.ts).
    const hexed = shillelagh ? null : hexWarriorSwing(sheet, resolved, derived);
    const material = weaponMaterial(sheet.equipment.find((item) => item.name === resolved.displayName));
    const swing = (twoHanded: boolean) => ({
      ...weaponAttackProfile(shillelagh?.derived ?? hexed?.derived ?? derived, sheet.proficiencies.weapons, shillelagh?.resolved ?? resolved, {
        riders,
        martialArts: martialArtsApplies(sheet),
        brawler: brawlerUnarmed(sheet),
        twoHanded,
        offHand: args.offHand,
        otherWeaponInHand: otherHandArmed({
          equipment: sheet.equipment,
          weapon: resolved.displayName,
          shieldName,
        }),
      }),
      material,
    });
    profile = swing(hands.twoHanded);
    let handsNote = hands.note;
    // SRD 5.1 Versatile: the bigger die is for a melee attack. A spear thrown
    // past its reach (counting the reach Demiurgic Colossus adds below) is a
    // ranged attack, as attackGeometry will find, so it rolls the one-handed
    // die and gives Great Weapon Fighting nothing to reroll.
    if (profile.twoHanded && profile.thrown && !profile.ranged && !properties.includes("two-handed")) {
      const reachTiles = profile.reachTiles + (authoredReachBonus(sheet)?.tiles ?? 0);
      if (thrownAtRange({ thrown: true, reachTiles }, target.apart)) {
        profile = swing(false);
        handsNote = `${resolved.displayName} is thrown: one-handed die`;
      }
    }
    if (handsNote) {
      profile = { ...profile, riderNotes: [...profile.riderNotes, handsNote] };
    }
    if (shillelagh) {
      profile = { ...profile, magicWeapon: true, riderNotes: [...profile.riderNotes, shillelagh.note] };
    }
    if (hexed) {
      profile = { ...profile, riderNotes: [...profile.riderNotes, hexed.note] };
    }
    kind = "weapon";
    special = lance ? "lance" : resolved.srd?.name === SPECIAL_WEAPONS.net ? "net" : null;
  }
  // Demiurgic Colossus: a raging giant's melee reach grows by 5 feet.
  const reach = kind === "weapon" && !profile.ranged ? authoredReachBonus(sheet) : null;
  if (reach) {
    profile = { ...profile, reachTiles: profile.reachTiles + reach.tiles, riderNotes: [...profile.riderNotes, `${reach.feature}: ${reach.tiles * 5} more feet of reach`] };
  }
  return { profile, derived, riders, scalingNote, grantedBonusAction, grantedWithActivation, kind, special };
}

// The natural attacks a beast form fights with: the record's own, or for a
// record written before forms carried them, the table's form of that name.
// Null for a form the table does not hold (a beast the caller described).
export function shapeAttacks(wildShape: CharacterSheet["wildShape"] | undefined): CreatureAttack[] | null {
  if (!wildShape) {
    return null;
  }
  return wildShape.attacks ?? findBeastForm(wildShape.form)?.attacks ?? null;
}
