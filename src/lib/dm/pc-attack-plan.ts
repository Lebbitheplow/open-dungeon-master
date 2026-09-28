// Everything that can refuse a player's attack, asked in one place and in
// one order, and then what the attack carries once nothing can: its
// profile and damage dice, the notes and advantage of the roll, and the
// turn budget it will spend. Split from pc-attack.ts, which spends what
// this plans and rolls it. Nothing is spent here: the cast is a dry run,
// the quiver is only counted, the maneuver's pool and the smite's slot are
// only looked at, and the budget is a copy until pc-attack.ts stores it.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import type { Advantage } from "@/lib/dice";
import { attacksLeft, spendAction, spendAttack, type TurnBudget } from "@/lib/dm/action-budget";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import {
  isUndeadOrFiend,
  loadingProblem,
  offHandProblem,
  resourceLeft,
  slotFree,
  smiteDice,
  withLoadingFired,
} from "@/lib/dm/attack-rules";
import { actingCombatantId, canAct } from "@/lib/dm/can-act";
import type { TypedRider } from "@/lib/dm/damage-parts";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { checkPcAttackRange } from "@/lib/dm/map-tools";
import type { PcAttackArgs } from "@/lib/dm/pc-attack";
import {
  claimOncePerTurnRiders,
  foldDamageRiders,
  withSneakAttack,
} from "@/lib/dm/pc-attack-damage";
import { buildAttackProfile, type BuiltAttack } from "@/lib/dm/pc-attack-profile";
import { MANEUVER_RIDERS, superiorityDie, type OnHitSpends } from "@/lib/dm/pc-attack-riders";
import { attackGeometry, attackSituation } from "@/lib/dm/pc-attack-situation";
import { checkAttackSpell } from "@/lib/dm/pc-attack-spell";
import { attacksAllowedFor, budgetFor } from "@/lib/dm/turn-budget";
import { acBreakdownFor } from "@/lib/srd";
import type { AmmoSpend } from "@/lib/srd/ammunition";
import { spendAmmo } from "@/lib/srd/ammunition";
import { conditionBlocksReactions, conditionExtraActions } from "@/lib/srd/condition-effects";
import type { ConditionRollRiders } from "@/lib/srd/condition-effects";
import { classLevelFor } from "@/lib/srd/multiclass";
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
  advantage: Advantage;
  budget: TurnBudget | null;
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

  // On their own turn a character attacks with their action. Off it they
  // have one reaction, and an attack made then is that reaction (an
  // opportunity attack, a readied strike): one, until their turn comes round.
  const onTurn = actingCombatantId(encounter) === sheet.id;
  const allowed = canAct({ sheet, encounter, kind: onTurn ? "attack" : "reaction" });
  if (!allowed.ok) {
    return { refused: { error: allowed.error } };
  }
  if (!onTurn) {
    const blocked = conditionBlocksReactions(sheet.conditions);
    if (blocked) {
      return { refused: { error: `${sheet.name} is ${blocked} and cannot take reactions, so they cannot attack off their own turn.` } };
    }
    if (encounter.reactionsUsed.includes(sheet.id)) {
      return {
        refused: {
          error: `It is not ${sheet.name}'s turn, and they have already used their reaction. Off their own turn a character attacks only with their reaction; it comes back at the start of their next turn.`,
        },
      };
    }
    if (args.offHand) {
      return {
        refused: {
          error: `The off-hand attack is a bonus action on ${sheet.name}'s own turn; it is not their turn.`,
        },
      };
    }
  }
  const enemy = resolveEnemyRef(encounter.id, args.targetEnemyId);
  if (!enemy) {
    return { refused: { error: "Unknown targetEnemyId; use one from GAME STATE." } };
  }
  if (enemy.status !== "alive") {
    return { refused: { error: `${enemy.displayName} is already ${enemy.status}.` } };
  }
  // A charmed creature cannot attack the one who charmed it.
  const charmedAs = sheet.conditions.find((entry) => entry.trim().toLowerCase() === "charmed");
  const charmer = charmedAs ? (sheet.conditionMeta as ConditionMetaMap)[charmedAs]?.source : undefined;
  if (charmer && charmer === enemy.id) {
    return {
      refused: {
        error: `${sheet.name} is charmed by ${enemy.displayName} and cannot attack it. They can attack another target, or act once the charm ends.`,
      },
    };
  }

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
  if (rangeError) {
    return { refused: { error: rangeError } };
  }
  const geometry = attackGeometry(campaign.id, encounter.id, sheet.id, enemy, profile);
  const { atRange } = geometry;

  // A Battle Master maneuver riding this swing. The pick and the pool are
  // checked here; the die is spent on the roll for Precision Attack and on
  // the hit for every other maneuver.
  let maneuver: ManeuverPick | null = null;
  if (args.maneuver?.trim()) {
    if (!weaponAttack) {
      return { refused: { error: "Maneuvers ride weapon attacks, not spells." } };
    }
    const term = args.maneuver.trim().toLowerCase();
    const picks = sheet.features
      .map((feature) => feature.name)
      .filter((name) => name.toLowerCase().startsWith("maneuver"));
    const known = picks.some((name) => {
      const bare = name.toLowerCase().replace(/^maneuver:\s*/, "");
      return bare.includes(term) || term.includes(bare);
    });
    if (!known) {
      return {
        refused: {
          error: `${sheet.name} knows no maneuver "${args.maneuver}".${
            picks.length ? ` Their maneuvers: ${picks.join(", ")}.` : " They have no maneuver picks."
          }`,
        },
      };
    }
    const pool = resourceLeft(sheet, "Superiority Dice");
    if (pool === null || pool.left < 1) {
      return {
        refused: {
          error:
            pool === null
              ? `${sheet.name} has no Superiority Dice.`
              : `${sheet.name} has 0/${pool.max} Superiority Dice left; ${args.maneuver.trim()} is not available until they rest. They can make the attack without it.`,
        },
      };
    }
    // Multiclass: the superiority die grows with FIGHTER levels.
    const die = superiorityDie(classLevelFor(sheet, "fighter") || sheet.level);
    maneuver = {
      name: args.maneuver.trim(),
      die,
      precision: /precision/i.test(term),
      rider: MANEUVER_RIDERS.find((entry) => entry.match.test(term)) ?? null,
    };
  }

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
  if (args.offHand && !grantedBonusAction) {
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
  let spendNote: string | undefined;
  if (budget) {
    const usesAttackAction = !grantedBonusAction && !args.offHand && kind !== "spell";
    if (usesAttackAction) {
      const loading = loadingProblem({ who: sheet.name, profile, budget, feats: sheet.feats });
      // A new action (Action Surge, Haste) reloads; only a swing that would
      // ride the action already fired from is refused.
      if (loading && attacksLeft(budget) > 0 && budget.attacksMade > 0) {
        return { refused: { error: loading } };
      }
    }
    const spend = grantedBonusAction
      ? spendAction(budget, "bonus", `the ${profile.weapon} attack`, sheet.name)
      : args.offHand
        ? spendAction(budget, "bonus", "an off-hand attack", sheet.name)
        : kind === "spell"
          ? // The cast guard charges the casting time in pc-attack.ts.
            { ok: true as const, budget }
          : spendAttack(budget, sheet.name);
    if (!spend.ok) {
      return { refused: { error: spend.error } };
    }
    budget = spend.budget;
    if (usesAttackAction) {
      budget = withLoadingFired(budget, profile);
      if (!profile.ranged && (profile.properties ?? []).includes("light")) {
        budget = { ...budget, lightMeleeAttack: true };
      }
    }
    spendNote = spend.note;
  }

  // ---- what the attack carries: nothing below refuses it ----

  const folded = foldDamageRiders({ campaignId: campaign.id, sheet, profile, riders, kind });
  profile = folded.profile;
  const situation = attackSituation({
    campaign,
    encounter,
    sheet,
    enemy,
    requested: args.advantage,
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
  });
  const context = situation.context;
  const sneak = withSneakAttack({
    encounterId: encounter.id,
    sheetId: sheet.id,
    enemyId: enemy.id,
    profile,
    riders,
    advantage: situation.advantage,
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
  let droppedRiders: string[] = [];
  if (budget) {
    const claimed = claimOncePerTurnRiders({
      budget,
      profile,
      notes: context.notes,
      sneak: sneak.sneak,
      sneakAttackDice: riders.sneakAttackDice,
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
    derived: built.derived,
    riders,
    kind,
    special: built.special,
    profile,
    castsSpell: spell.castsSpell,
    spellSlotLevel: spell.spellSlotLevel,
    weaponAttack,
    ammo,
    typedRiders: folded.typedRiders,
    droppedRiders,
    effectiveAc: geometry.effectiveAc,
    atRange,
    context,
    helped: situation.helped,
    attackRiders: situation.attackRiders,
    maneuver,
    smite,
    advantage: situation.advantage,
    budget,
  };
}
