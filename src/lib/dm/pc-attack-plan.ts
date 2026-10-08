// Everything that can refuse a player's attack, asked in one place and in
// one order, and then what the attack carries once nothing can: its
// profile and damage dice, the notes and advantage of the roll, and the
// turn budget it will spend. Split from pc-attack.ts, which spends what
// this plans and rolls it. Nothing is spent here: the cast is a dry run,
// the quiver is only counted, the maneuver's pool and the smite's slot are
// only looked at, and the budget is a copy until pc-attack.ts stores it.

import { elementalAdeptApplies, floorDamageDice, POWER_ATTACK_DAMAGE, POWER_ATTACK_TO_HIT, powerAttackFeat, shotIgnoresCover, shotIgnoresLongRange, spellIgnoresCover } from "@/lib/srd/feat-combat";
import { underwaterRangeProblem } from "@/lib/dm/underwater";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { listEnemies, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import type { Advantage } from "@/lib/dice";
import { spendAction, type TurnBudget } from "@/lib/dm/action-budget";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { isUndeadOrFiend, offHandProblem, slotFree, smiteDice } from "@/lib/dm/attack-rules";
import { planMarks, type MarkPlan } from "@/lib/dm/attack-marks";
import type { TypedRider } from "@/lib/dm/damage-parts";
import { itemRidersAgainst } from "@/lib/dm/gear-attack";
import { checkPcAttackRange } from "@/lib/dm/map-tools";
import type { PcAttackArgs } from "@/lib/dm/pc-attack";
import {
  claimOncePerTurnRiders,
  foldDamageRiders,
  withSneakAttack,
} from "@/lib/dm/pc-attack-damage";
import { gatePcAttack } from "@/lib/dm/pc-attack-gate";
import { checkAttackOptions, claimedAdvantage, type AttackOptions } from "@/lib/dm/pc-attack-options";
import { spendAttackEconomy } from "@/lib/dm/pc-attack-spend";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { buildAttackProfile, type BuiltAttack } from "@/lib/dm/pc-attack-profile";
import { pickManeuver, type OnHitSpends } from "@/lib/dm/pc-attack-riders";
import { attackGeometry, attackSituation } from "@/lib/dm/pc-attack-situation";
import { globeProblemFor, missileProblem } from "@/lib/dm/zone-rules";
import { checkAttackSpell } from "@/lib/dm/pc-attack-spell";
import { attacksAllowedFor, budgetFor } from "@/lib/dm/turn-budget";
import { acBreakdownFor } from "@/lib/srd";
import { foeSlayerBonus } from "@/lib/dm/attack-features";
import { carriesPoison, type OpenHandChoice } from "@/lib/dm/attack-onhit";
import { rapidStrike, secondWeaponProblem } from "@/lib/dm/authored-attacks";
import { curseRider } from "@/lib/dm/spell-retort";
import type { AmmoSpend } from "@/lib/srd/ammunition";
import { spendAmmo } from "@/lib/srd/ammunition";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import { conditionsSpentAgainst } from "@/lib/srd/condition-effect-queries";
import type { ConditionRollRiders } from "@/lib/srd/condition-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A Battle Master maneuver riding the swing.
export type ManeuverPick = {
  name: string;
  die: string;
  precision: boolean;
  rider: { condition: string; save: "str" | "wis" } | null;
};

// One attack, checked and assembled. `profile`, `maneuver` and the notes
// change as the attack is paid for and rolled.
export type AttackPlan = {
  campaign: Campaign;
  turn: DmTurn;
  encounter: Encounter;
  sheet: CharacterSheet;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
  args: PcAttackArgs;
  enemy: EncounterEnemy;
  derived: BuiltAttack["derived"];
  riders: BuiltAttack["riders"];
  kind: BuiltAttack["kind"];
  special: BuiltAttack["special"];
  profile: AttackProfile;
  castsSpell: boolean;
  spellSlotLevel: number | null;
  weaponAttack: boolean;
  ammo: AmmoSpend | null;
  typedRiders: TypedRider[];
  // Once-per-turn riders already used this turn: they left the expression.
  droppedRiders: string[];
  effectiveAc: number;
  atRange: boolean;
  context: { advantage: Advantage; autoCrit: boolean; notes: string[] };
  helped: string | null;
  attackRiders: ConditionRollRiders;
  maneuver: ManeuverPick | null;
  smite: OnHitSpends["smite"];
  // The feature options the attack carries (src/lib/dm/pc-attack-options.ts).
  options: AttackOptions;
  // Hunter's Mark and Hex: whose die rides this hit, and the marks it places.
  marks: MarkPlan;
  // The attacker's conditions the first hit uses up (the smites).
  hitSpent: string[];
  // The target's conditions this attack roll uses up (Guiding Bolt).
  targetSpent: string[];
  advantage: Advantage;
  budget: TurnBudget | null;
  // Elemental Adept covers this attack spell's damage type (feat-combat.ts).
  elementalAdept: boolean;
  // The features and effects that ride this attack beyond its damage
  // (src/lib/dm/attack-features.ts, attack-onhit.ts).
  extras: AttackExtras;
};

export type AttackExtras = {
  // Inspiration spent for the roll's advantage.
  inspired: boolean;
  // Stroke of Luck declared: a miss becomes a hit and spends the use.
  strokeOfLuck: boolean;
  // Foe Slayer's bonus open to this attack (0 when none).
  foeSlayer: number;
  // Open Hand Technique on this Flurry of Blows strike, and its ki DC.
  openHand: { choice: OpenHandChoice; dc: number } | null;
  // Hurl Through Hell on the hit.
  hurl: boolean;
  // The weapon carries a coat of basic poison.
  poison: boolean;
  // The reaction attack is Giant Killer's.
  giantKiller: boolean;
};

export function planPcAttack(input: {
  campaign: Campaign;
  turn: DmTurn;
  encounter: Encounter;
  sheet: CharacterSheet;
  args: PcAttackArgs;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
}): AttackPlan | { refused: Record<string, unknown> } {
  const { campaign, turn, encounter, sheet, args, sheets, sheetsById } = input;

  // ---- refusals: everything that can stop this attack, before any spend ----

  // Whether the attacker may attack now and the target can be attacked at
  // all (src/lib/dm/pc-attack-gate.ts).
  const gate = gatePcAttack({ campaign, encounter, sheet, args });
  if ("refused" in gate) {
    return gate;
  }
  const { enemy, giantKiller } = gate;

  const built = buildAttackProfile(campaign.id, sheet, args);
  if ("error" in built) {
    return { refused: built };
  }
  const { riders, kind, grantedBonusAction } = built;

  // An attack-roll spell is a cast: the guard's dry run (src/lib/dm/pc-attack-spell.ts).
  const spell = checkAttackSpell({
    campaign,
    turn,
    sheet,
    args,
    kind,
    profile: built.profile,
    sheets,
    sheetsById,
  });
  if ("refused" in spell) {
    return spell;
  }
  let profile = spell.profile;
  const weaponAttack = kind === "weapon" || kind === "natural";

  // Ammunition, when the table asked for it: an empty quiver is a refused
  // attack, not a missed one. Only looked at here; the round leaves the
  // quiver in pc-attack.ts, once nothing else can refuse the shot.
  const ammo =
    campaign.gameSettings.variantRules.ammunition && profile.weapon
      ? spendAmmo(sheet.equipment, profile.weapon, sheet.name)
      : null;
  if (ammo && !ammo.ok) {
    return { refused: { error: ammo.error } };
  }

  // Battle-map positions are authoritative; players move their own tokens,
  // so an out-of-reach attack is refused rather than auto-approached.
  const rangeError = checkPcAttackRange(encounter.id, sheet.id, enemy.id, {
    ranged: profile.ranged,
    rangeTiles: profile.rangeTiles,
    reachTiles: profile.reachTiles,
    thrown: profile.thrown,
    longRangeTiles: profile.longRangeTiles,
  });
  // Wind Wall turns arrows and bolts shot through it (zone-rules.ts).
  const blown =
    rangeError ??
    (profile.ranged && weaponAttack ? missileProblem(encounter.id, sheet.id, enemy.id, enemy.displayName) : null) ??
    (kind === "spell" ? globeProblemFor(encounter.id, sheet.id, enemy.id, enemy.displayName, args.spell, args.level) : null) ??
    // Underwater, a shot past normal range misses (underwater.ts).
    (weaponAttack ? underwaterRangeProblem(campaign.id, encounter.id, sheet.id, profile, enemy) : null);
  if (blown) {
    return { refused: { error: blown } };
  }
  let geometry = attackGeometry(campaign.id, encounter.id, sheet.id, enemy, profile);
  const { atRange } = geometry;
  const featNotes: string[] = [];
  // Sharpshooter's shot and Spell Sniper's spell pass half and
  // three-quarters cover; Sharpshooter's shot takes no disadvantage at long
  // range (src/lib/srd/feat-combat.ts).
  const ignoresCover = (weaponAttack && atRange && shotIgnoresCover(sheet)) || (kind === "spell" && spellIgnoresCover(sheet));
  if (ignoresCover && geometry.cover) {
    featNotes.push(`${kind === "spell" ? "Spell Sniper" : "Sharpshooter"}: ${enemy.displayName}'s ${geometry.cover === 2 ? "half" : "three-quarters"} cover does not count`);
    geometry = { ...geometry, effectiveAc: geometry.effectiveAc - geometry.cover, cover: 0, screen: null };
  }
  if (weaponAttack && atRange && geometry.spatials.longRange && shotIgnoresLongRange(sheet)) {
    featNotes.push("Sharpshooter: no disadvantage at long range");
    geometry = { ...geometry, spatials: { ...geometry.spatials, longRange: false } };
  }
  // The -5/+10 trade of Great Weapon Master and Sharpshooter, asked for
  // before the roll.
  if (args.powerAttack) {
    const power = powerAttackFeat(sheet, { weaponAttack, ranged: atRange, heavy: profile.heavy, proficient: profile.proficient });
    if ("refused" in power) {
      return { refused: { error: `${sheet.name}: ${power.refused} Nothing was spent.` } };
    }
    profile = { ...profile, toHit: profile.toHit + POWER_ATTACK_TO_HIT, damageExpression: `${profile.damageExpression}+${POWER_ATTACK_DAMAGE}` };
    featNotes.push(`${power.feat}: -5 to hit, +10 damage`);
  }
  // Elemental Adept on an attack-roll spell of its type: every 1 on the
  // damage dice counts as 2, and the target's resistance is ignored.
  const elementalAdept = kind === "spell" && elementalAdeptApplies(sheet, profile.damageType);
  if (elementalAdept) {
    profile = { ...profile, damageExpression: floorDamageDice(profile.damageExpression) };
    featNotes.push(`Elemental Adept: ${profile.damageType} ignores resistance and every 1 on the dice is a 2`);
  }

  // A Battle Master maneuver riding this swing. The pick and the pool are
  // checked here; the die is spent on the roll for Precision Attack and on
  // the hit for every other maneuver.
  const picked = pickManeuver(sheet, args.maneuver, weaponAttack);
  if ("refused" in picked) {
    return { refused: { error: picked.refused } };
  }
  const maneuver = picked.maneuver;

  // Divine Smite: checked here, paid for on the hit. 2d8 at 1st level, 1d8
  // more per slot level above to 5d8, and 1d8 more against undead and fiends.
  let smite: OnHitSpends["smite"];
  if (args.smite) {
    if (!riders.canSmite) {
      return { refused: { error: `${sheet.name} has no Divine Smite.` } };
    }
    if (atRange || !weaponAttack) {
      return { refused: { error: "Divine Smite rides on a melee weapon attack, not a ranged one or a spell." } };
    }
    if (!slotFree(sheet, args.smite)) {
      return {
        refused: {
          error: `${sheet.name} has no free level ${args.smite} spell slot to smite with. They can make the attack without Divine Smite, or name a slot level they still have.`,
        },
      };
    }
    const undeadOrFiend = isUndeadOrFiend(enemy);
    smite = { slot: args.smite, dice: smiteDice(args.smite, undeadOrFiend), undeadOrFiend };
  }

  // The action economy: the first swing spends the Attack action, the rest
  // come out of Extra Attack, the off-hand swing is a bonus action, a spell
  // is the whole action, and off their own turn the attack is the reaction.
  let budget = budgetFor(
    encounter,
    sheet.id,
    attacksAllowedFor(sheet),
    conditionExtraActions(sheet.conditions),
  );
  // The second blade a feature's weapon grants (authored-attacks.ts).
  const secondWeapon = args.offHand ? secondWeaponProblem(sheet, args.weapon, budget) : undefined;
  if (secondWeapon) {
    return { refused: { error: secondWeapon } };
  }
  if (args.offHand && !grantedBonusAction && secondWeapon === undefined) {
    const problem = offHandProblem({
      who: sheet.name,
      profile,
      budget,
      inFight: true,
      equipment: sheet.equipment,
      feats: sheet.feats,
      shieldName: acBreakdownFor(sheet).shieldName,
    });
    if (problem) {
      return { refused: { error: problem } };
    }
  }
  // The feature options riding the swing: a bonus attack a feature grants,
  // Stunning Strike, Reckless Attack, a knockout blow.
  const checked = checkAttackOptions({
    sheet,
    args,
    profile,
    kind,
    atRange,
    derived: built.derived,
    budget,
    targetId: enemy.id,
    besideEarlierTarget: (earlierId) => {
      const apart = tilesBetween(encounter.id, earlierId, enemy.id);
      return apart === null || apart <= 1;
    },
  });
  if ("refused" in checked) {
    return { refused: { error: checked.refused } };
  }
  const options = checked.options;
  // The part of the turn the attack spends (src/lib/dm/pc-attack-spend.ts).
  const spent = spendAttackEconomy({
    sheet,
    args,
    profile,
    kind,
    atRange,
    weaponAttack,
    budget,
    options,
    grantedBonusAction,
    encounterId: encounter.id,
    enemyId: enemy.id,
  });
  if ("refused" in spent) {
    return { refused: { error: spent.refused } };
  }
  budget = spent.budget;
  const { spendNote, notes: context0 } = spent;

  // Hunter's Mark and Hex ride hits on their marked creature only; moving a
  // mark off a fallen creature is the bonus action (attack-marks.ts).
  let marks = planMarks({ sheet, enemy, encounterEnemies: listEnemies(encounter.id), budget });
  if (marks.movesMark && budget) {
    const moved = spendAction(budget, "bonus", "moving the mark", sheet.name);
    if (moved.ok) {
      budget = moved.budget;
    } else {
      marks = { applies: new Set(), assign: [], movesMark: false, notes: [] };
    }
  }

  // ---- what the attack carries: nothing below refuses it ----

  // The advantage the caller claims for the roll: the AI names a
  // circumstance the engine does not already decide (pc-attack-options.ts).
  const claim = claimedAdvantage({
    requested: args.advantage,
    reason: args.advantageReason,
    byAi: turn.actor === "ai",
  });
  const folded = foldDamageRiders({
    campaignId: campaign.id,
    sheet,
    profile,
    riders,
    kind,
    enemy,
    marked: marks.applies,
  });
  // A magic weapon's dice against this target (src/lib/dm/gear-attack.ts).
  const gear = itemRidersAgainst(folded.profile, enemy.stats.type, atRange);
  profile = gear.profile;
  // Bestow Curse's necrotic rides its caster's hits on the cursed (spell-retort.ts).
  const curse = curseRider(enemy, sheet.id);
  if (curse) {
    profile = { ...profile, damageExpression: `${profile.damageExpression}+${curse.dice}` };
  }
  const situation = attackSituation({
    campaign,
    encounter,
    sheet,
    enemy,
    requested: claim.requested,
    geometry,
    profile,
    kind,
    special: built.special,
    scalingNote: built.scalingNote,
    riders,
    rageBonus: folded.rageBonus,
    attackEffect: folded.attackEffect,
    damageEffect: folded.damageEffect,
    onHitNotes: folded.onHitNotes,
    featureRiders: folded.featureRiders,
    maneuver,
    recklessAdvantage: options.recklessAdvantage,
    claimNote: claim.note,
    inspired: args.useInspiration === true,
  });
  const context = situation.context;
  context.notes.push(...context0, ...featNotes);
  // Rapid Strike: the advantage of this attack traded for one more attack of
  // the action, once a turn (src/lib/dm/authored-attacks.ts).
  let advantage = situation.advantage;
  if (args.rapidStrike) {
    const traded = rapidStrike({ sheet, budget, advantage, weaponAttack, bonus: Boolean(options.bonusAttack || args.offHand || grantedBonusAction) });
    if ("refused" in traded) {
      return { refused: { error: traded.refused } };
    }
    advantage = "none";
    budget = traded.budget;
    context.notes.push(traded.note);
  }
  const sneak = withSneakAttack({
    encounterId: encounter.id,
    sheetId: sheet.id,
    enemyId: enemy.id,
    profile,
    riders,
    advantage,
    notes: context.notes,
  });
  profile = sneak.profile;
  if (smite) {
    context.notes.push(
      `Divine Smite (level ${smite.slot} slot): +${smite.dice}d8 radiant on a hit${
        smite.undeadOrFiend ? ", against an undead or fiend" : ""
      }; a miss spends nothing`,
    );
  }
  if (spendNote) {
    context.notes.push(spendNote);
  }
  context.notes.push(...marks.notes);
  let droppedRiders: string[] = [];
  if (budget) {
    const claimed = claimOncePerTurnRiders({
      budget,
      profile,
      notes: context.notes,
      sneak: sneak.sneak,
      sneakAttackDice: sneak.dice,
      featureRiders: folded.featureRiders,
    });
    budget = claimed.budget;
    profile = claimed.profile;
    context.notes = claimed.notes;
    droppedRiders = claimed.droppedRiders;
  }

  return {
    campaign,
    turn,
    encounter,
    sheet,
    sheets,
    sheetsById,
    args,
    enemy,
    elementalAdept,
    derived: built.derived,
    riders,
    kind,
    special: built.special,
    profile,
    castsSpell: spell.castsSpell,
    spellSlotLevel: spell.spellSlotLevel,
    weaponAttack,
    ammo,
    typedRiders: [...folded.typedRiders, ...gear.typed, ...(curse ? [curse] : [])],
    droppedRiders,
    effectiveAc: geometry.effectiveAc,
    atRange,
    context,
    helped: situation.helped,
    attackRiders: situation.attackRiders,
    marks,
    hitSpent: folded.hitSpent,
    targetSpent: conditionsSpentAgainst(enemy.conditions),
    maneuver,
    smite,
    options,
    advantage,
    budget,
    extras: {
      inspired: args.useInspiration === true,
      strokeOfLuck: args.strokeOfLuck === true,
      foeSlayer: weaponAttack || kind === "spell" ? foeSlayerBonus(sheet, built.derived, enemy, budget?.oncePerTurn ?? null) : 0,
      openHand: args.openHand
        ? { choice: args.openHand, dc: 8 + built.derived.proficiencyBonus + built.derived.abilityMods.wis }
        : null,
      hurl: args.hurlThroughHell === true,
      poison: carriesPoison(sheet, weaponAttack, profile.damageType),
      giantKiller,
    },
  };
}
