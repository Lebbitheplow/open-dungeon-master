// The digital dice path of pc_attack: the to-hit expression is built, the
// server rolls it against the target's Armor Class, a hit pays for what it
// carries, the damage lands per type, and a maneuver's rider save resolves.
// Split from pc-attack.ts, which has already refused or paid for everything
// this rolls; nothing here refuses the attack.

import { allocateSeq } from "@/lib/db/campaigns";
import { recordEncounterTarget, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll, markRollApplied, type StoredRoll } from "@/lib/db/rolls";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { planAttackFx, type RollVisibility } from "@/lib/battlemap/fx-plan";
import { saveModFor } from "@/lib/bestiary/statblock";
import { attacksLeft } from "@/lib/dm/action-budget";
import { adjudicateHit } from "@/lib/dm/attack-logic";
import { rollDerivation } from "@/lib/dm/condition-logic";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import { applyHitDamage, type strikeDamage } from "@/lib/dm/pc-attack-damage";
import type { AttackPlan, ManeuverPick } from "@/lib/dm/pc-attack-plan";
import { applyRiderCondition, riderBarred, spendOnHit } from "@/lib/dm/pc-attack-riders";
import { hasElvenAccuracy, hasHalflingLuck } from "@/lib/srd/feature-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The roll the attack makes and the damage it carries, built once the
// attack is paid for and shared by both dice paths.
export type Strike = ReturnType<typeof strikeToHit> & ReturnType<typeof strikeDamage>;

export function publishRoll(campaignId: string, roll: StoredRoll) {
  publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", {
    roll,
    source: "digital",
  });
}

export function strikeToHit(plan: AttackPlan) {
  const { sheet, enemy, profile, advantage, maneuver, context } = plan;
  const toHitRiderSuffix = `${plan.attackRiders.diceSuffix}${
    maneuver?.precision ? `+1${maneuver.die}` : ""
  }`;

  // Elven Accuracy: advantage on a DEX/INT/WIS/CHA attack rolls a third d20
  // and keeps the highest. Spell attacks report their ability as "dex", so
  // excluding only Strength matches the feat's DEX/INT/WIS/CHA scope.
  const elvenAccuracy =
    advantage === "advantage" && profile.ability !== "str" && hasElvenAccuracy(sheet);
  if (elvenAccuracy) {
    context.notes.push("Elven Accuracy: rolls a third d20 and keeps the highest");
  }
  // Halfling Lucky rerolls a natural 1 on the attack roll once, so it rides
  // the leading d20 term as the grammar's "r1" suffix, before any rider dice.
  const lucky = hasHalflingLuck(sheet);
  if (lucky) {
    context.notes.push("Lucky: a natural 1 on the attack roll is rerolled once");
  }
  const toHitD20 = d20Expression(profile.toHit, advantage)
    .replace(/^2d20kh1/, elvenAccuracy ? "3d20kh1" : "2d20kh1")
    .replace(/^(\d+d20(?:k[hl]\d+)?)/, lucky ? "$1r1" : "$1");
  const toHitExpression = `${toHitD20}${toHitRiderSuffix}`;
  const detail = `${sheet.name}: ${profile.weapon} vs ${enemy.displayName}`;
  return { toHitExpression, detail };
}

// Digital path: roll, adjudicate, and apply in one pass.
export function rollPcAttack(plan: AttackPlan, strike: Strike): Record<string, unknown> {
  const { campaign, turn, encounter, sheet, enemy, budget, riders, special, context } = plan;
  const { critExtraDice, onHitSpends } = strike;
  let profile = plan.profile;
  let maneuver = plan.maneuver;
  const typedRiders = [...plan.typedRiders];

  const hitOutcome = rollExpression(strike.toHitExpression);
  const hitRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "attack",
    detail: strike.detail,
    advantage: plan.advantage,
    result: hitOutcome,
  });
  publishRoll(campaign.id, hitRoll);
  turn.rollIds.push(hitRoll.id);

  const adjudicated = adjudicateHit(hitOutcome.total, hitOutcome.crit, plan.effectiveAc, {
    natural: hitOutcome.natural,
    critRange: riders.critRange,
  });
  const hit = adjudicated.hit;
  const crit = adjudicated.crit || (hit && context.autoCrit);
  const stage = attackStage(campaign.id, encounter, sheet, enemy);
  // The hit is known: now the smite slot and the maneuver's die are spent.
  if (hit && strike.hasOnHit) {
    const paid = spendOnHit(campaign, turn.id, onHitSpends, plan.sheets, plan.sheetsById);
    if (onHitSpends.smite && paid.suffix.includes(`+${onHitSpends.smite.dice}d8`)) {
      typedRiders.push({ dice: `${onHitSpends.smite.dice}d8`, type: "radiant" });
    }
    profile = { ...profile, damageExpression: `${profile.damageExpression}${paid.suffix}` };
    context.notes.push(...paid.notes);
    if (onHitSpends.maneuver && !paid.suffix.includes(onHitSpends.maneuver.die)) {
      maneuver = null;
    }
  }
  const base = {
    attacker: sheet.name,
    weapon: profile.weapon,
    rolled: hitOutcome.total,
    vsAc: plan.effectiveAc,
    target: enemy.displayName,
    ...(profile.improvised ? { improvised: true } : {}),
    ...(budget ? {} : { reaction: true }),
    ...(context.notes.length ? { conditionEffects: context.notes } : {}),
    // Extra Attack: the model has no way to know a level-5 fighter swings
    // twice unless the engine says so on every swing.
    ...(budget && attacksLeft(budget) > 0 && budget.attacksMade > 0
      ? {
          attacksRemaining: attacksLeft(budget),
          extraAttack: `${sheet.name} has ${attacksLeft(budget)} more attack${
            attacksLeft(budget) === 1 ? "" : "s"
          } this turn; call pc_attack again for each before ending their turn.`,
        }
      : {}),
  };
  if (!hit) {
    emitAttackFx(campaign.id, stage, {
      hit: false,
      crit: false,
      fumble: hitOutcome.crit === "nat1",
      ranged: profile.ranged,
      damageType: profile.damageType,
      visibility: hitRoll.visibility,
    });
    return {
      ...base,
      hit: false,
      ...(hitOutcome.crit === "nat1" ? { fumble: true } : {}),
      note: "The attack misses; narrate the miss.",
    };
  }

  // The net deals no damage: a hit restrains a creature that is Large or
  // smaller and can be restrained at all.
  if (special === "net") {
    emitAttackFx(campaign.id, stage, {
      hit: true,
      crit: false,
      ranged: true,
      damageType: "",
      visibility: hitRoll.visibility,
    });
    const held = applyRiderCondition(campaign, enemy, "restrained", { maxSize: "Large" });
    return {
      ...base,
      hit: true,
      damage: 0,
      note: held.applied
        ? `The net lands: ${enemy.displayName} is restrained until it is freed (a DC 10 Strength check, or 5 slashing damage to the net). The server applied the condition; a net deals no damage.`
        : `The net lands and slides off: ${held.reason} A net deals no damage.`,
    };
  }

  const damageExpression = crit
    ? critDamageExpression(profile.damageExpression, critExtraDice, strike.critOptions)
    : profile.damageExpression;
  const damageOutcome = rollExpression(damageExpression, undefined, {
    rerollBelow: strike.rerollBelow,
  });
  const damageRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "damage",
    detail: `${sheet.name}: ${profile.weapon} damage`,
    result: damageOutcome,
  });
  publishRoll(campaign.id, damageRoll);
  turn.rollIds.push(damageRoll.id);
  // A penalty can bring a hit's damage to 0, never below it.
  const dealt = Math.max(0, damageOutcome.total);
  emitAttackFx(campaign.id, stage, {
    hit: true,
    crit,
    ranged: profile.ranged,
    damage: dealt,
    damageType: profile.damageType,
    visibility: hitRoll.visibility,
  });

  const applied = applyHitDamage({
    plan,
    typedRiders,
    damageOutcome,
    dealt,
    crit,
    critExtraDice,
  });
  if (!("error" in applied)) {
    markRollApplied(damageRoll.id, enemy.id);
  }

  const maneuverOutcome =
    maneuver?.rider && !applied.dead && !applied.encounterOver
      ? maneuverRiderSave(plan, maneuver)
      : {};
  return {
    ...maneuverOutcome,
    ...base,
    ...(context.notes.length ? { conditionEffects: context.notes } : {}),
    hit: true,
    ...(crit ? { crit: true } : {}),
    damage: dealt,
    ...(profile.damageType ? { damageType: profile.damageType } : {}),
    ...applied,
    note: applied.dead
      ? `${enemy.displayName} is slain; the server already applied this damage. Narrate the killing blow.`
      : dealt === 0
        ? `The blow lands and does no harm: its damage came to 0. Narrate a hit that fails to hurt ${enemy.displayName}.`
        : `The server already applied this damage to ${enemy.displayName}. Do NOT call damage_enemy for this hit; narrate from this state.`,
  };
}

// A maneuver's rider save (Trip -> prone, Menacing -> frightened) resolves
// against the enemy's real stat block once the hit lands.
function maneuverRiderSave(plan: AttackPlan, maneuver: ManeuverPick): Record<string, unknown> {
  const { campaign, turn, encounter, enemy, derived } = plan;
  const maneuverOutcome: Record<string, unknown> = {};
  const fresh = resolveEnemyRef(encounter.id, enemy.id);
  const rider = maneuver.rider;
  if (!rider || !fresh || fresh.status !== "alive") {
    return maneuverOutcome;
  }
  const dc =
    8 +
    derived.proficiencyBonus +
    Math.max(derived.abilityMods.str, derived.abilityMods.dex);
  const barred = riderBarred(fresh, rider.condition, rider.condition === "prone" ? "Large" : null);
  if (barred) {
    maneuverOutcome.maneuver = `${maneuver.name}: ${barred} The extra damage still lands.`;
    return maneuverOutcome;
  }
  const saveOutcome = rollExpression(
    d20Expression(
      saveModFor(fresh.stats, rider.save),
      rollDerivation(fresh.conditions, "saving_throw", rider.save).advantage,
    ),
  );
  const saveRoll = insertRoll({
    campaignId: campaign.id,
    characterId: null,
    requestedBy: "dm",
    kind: "saving_throw",
    detail: `${fresh.displayName}: ${rider.save.toUpperCase()} save vs ${maneuver.name}`,
    dc,
    result: saveOutcome,
  });
  turn.rollIds.push(saveRoll.id);
  publishRoll(campaign.id, saveRoll);
  if (saveOutcome.total < dc) {
    applyRiderCondition(campaign, fresh, rider.condition, {
      // Prone lasts until the creature stands; the rest fade fast.
      rounds: rider.condition === "prone" ? undefined : 1,
    });
    maneuverOutcome.maneuver = `${maneuver.name}: ${fresh.displayName} fails the ${rider.save.toUpperCase()} save (${saveOutcome.total} vs DC ${dc}) and is ${rider.condition}.`;
  } else {
    maneuverOutcome.maneuver = `${maneuver.name}: ${fresh.displayName} holds (${saveOutcome.total} vs DC ${dc}); no ${rider.condition}.`;
  }
  return maneuverOutcome;
}

// Where attacker and target stand on the live board, and the target line
// every client draws for the round. Null when there is no board, which is
// a theatre-of-the-mind fight with nothing to draw on.
type AttackStage = {
  from: { x: number; y: number };
  to: { x: number; y: number };
  fromTokenId: string;
  toTokenId: string;
} | null;

function attackStage(
  campaignId: string,
  encounter: Encounter,
  sheet: CharacterSheet,
  enemy: EncounterEnemy,
): AttackStage {
  const from = tokenPosition(campaignId, sheet.id);
  const to = tokenPosition(campaignId, enemy.id);
  if (!from || !to) {
    return null;
  }
  recordEncounterTarget(encounter.id, encounter.round, sheet.id, enemy.id);
  return { from: from.at, to: to.at, fromTokenId: from.tokenId, toTokenId: to.tokenId };
}

function emitAttackFx(
  campaignId: string,
  stage: AttackStage,
  outcome: {
    hit: boolean;
    crit: boolean;
    fumble?: boolean;
    ranged: boolean;
    damage?: number;
    damageType?: string;
    visibility: RollVisibility;
  },
) {
  if (!stage) {
    return;
  }
  publishFx(
    campaignId,
    planAttackFx({
      ...stage,
      ...outcome,
      // Damage to an enemy is a DM secret; the client strips the number
      // for seats without real enemy numbers.
      secretNumbers: true,
    }),
  );
}
