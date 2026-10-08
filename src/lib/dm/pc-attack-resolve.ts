// The digital dice path of pc_attack: the to-hit expression is built, the
// server rolls it against the target's Armor Class, a hit pays for what it
// carries, the damage lands per type, and a maneuver's rider save resolves.
// Split from pc-attack.ts, which has already refused or paid for everything
// this rolls; nothing here refuses the attack.

import { GREAT_WEAPON_MASTER_READY } from "@/lib/srd/feat-combat";
import { holdsFeat } from "@/lib/srd/feat-effects";
import { tryParry } from "@/lib/dm/enemy-reactions";
import { allocateSeq } from "@/lib/db/campaigns";
import { recordEncounterTarget, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll, landRoll, type StoredRoll } from "@/lib/db/rolls";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { planAttackFx, type RollVisibility } from "@/lib/battlemap/fx-plan";
import { saveModFor } from "@/lib/bestiary/statblock";
import { attacksLeft } from "@/lib/dm/action-budget";
import { adjudicateHit } from "@/lib/dm/attack-logic";
import { rollDerivation } from "@/lib/dm/condition-logic";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { darkOnesBlessing } from "@/lib/dm/feature-hooks";
import { authoredOnHit } from "@/lib/dm/authored-hooks";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { gearCritRiders } from "@/lib/dm/gear-attack";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import { applyHitDamage, type strikeDamage } from "@/lib/dm/pc-attack-damage";
import type { AttackPlan, ManeuverPick } from "@/lib/dm/pc-attack-plan";
import {
  applyRiderCondition,
  clearHitSpent,
  riderBarred,
  spendOnHit,
  stunningStrikeSave,
} from "@/lib/dm/pc-attack-riders";
import { applySpellHitCondition, healCasterHalf, spellAttackRider } from "@/lib/dm/spell-attack-riders";
import { hasElvenAccuracy, hasHalflingLuck } from "@/lib/srd/feature-effects";
import { FOE_SLAYER, rescueMiss, STROKE_OF_LUCK } from "@/lib/dm/attack-features";
import {
  HURL_THROUGH_HELL,
  hurlThroughHell,
  openHandOnHit,
  poisonOnHit,
  spendFeatureUse,
} from "@/lib/dm/attack-onhit";
import { storeBudget } from "@/lib/dm/turn-budget";
import { untilTurnEnd } from "@/lib/dm/turn-end";
import { rollAgainst } from "@/lib/roll-labels";
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
  const detail = rollAgainst(profile.weapon, enemy.displayName);
  return { toHitExpression, detail };
}

// Digital path: roll, adjudicate, and apply in one pass.
export function rollPcAttack(plan: AttackPlan, strike: Strike): Record<string, unknown> {
  const { campaign, turn, encounter, sheet, enemy, budget, riders, special, context } = plan;
  const { critExtraDice, onHitSpends } = strike;
  let profile = plan.profile;
  let maneuver = plan.maneuver;
  const typedRiders = [...plan.typedRiders];

  const spellRider = plan.kind === "spell" ? spellAttackRider(plan.args.spell) : null;
  const hitOutcome = rollExpression(strike.toHitExpression);
  const hitRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "attack",
    detail: strike.detail,
    advantage: plan.advantage,
    result: hitOutcome,
    attacker: { kind: "sheet", id: sheet.id, name: sheet.name },
  });
  publishRoll(campaign.id, hitRoll);
  turn.rollIds.push(hitRoll.id);

  const judged = adjudicateHit(hitOutcome.total, hitOutcome.crit, plan.effectiveAc, {
    natural: hitOutcome.natural,
    // Improved and Superior Critical are written for weapon attacks.
    critRange: plan.weaponAttack ? riders.critRange : 20,
  });
  // Parry: the creature's reaction lifts its AC against a melee hit it sees (enemy-reactions.ts).
  const parry = judged.hit && !judged.crit
    ? tryParry({ encounter, enemy, total: hitOutcome.total, natural20: false, ac: plan.effectiveAc, melee: !plan.atRange, attackerUnseen: sheet.conditions.some((entry) => /^(invisible|hidden)$/i.test(entry.trim())) })
    : null;
  if (parry) {
    context.notes.push(parry.note);
  }
  const adjudicated = parry ? { ...judged, hit: false, crit: false } : judged;
  // Foe Slayer turns a near miss into a hit, and a declared Stroke of Luck
  // any miss (src/lib/dm/attack-features.ts).
  const rescued = adjudicated.hit
    ? null
    : rescueMiss({
        total: hitOutcome.total,
        ac: plan.effectiveAc,
        natural1: hitOutcome.crit === "nat1",
        foeSlayer: plan.extras.foeSlayer,
        strokeOfLuck: plan.extras.strokeOfLuck,
      });
  const hit = adjudicated.hit || (rescued !== null && payRescue(plan, rescued));
  const crit = adjudicated.crit || (hit && context.autoCrit);
  // Foe Slayer not needed on the roll rides the hit's damage.
  if (adjudicated.hit && plan.extras.foeSlayer > 0) {
    claimFoeSlayer(plan);
    profile = { ...profile, damageExpression: `${profile.damageExpression}+${plan.extras.foeSlayer}` };
    context.notes.push(`Foe Slayer: +${plan.extras.foeSlayer} damage against a favored enemy`);
  }
  const stage = attackStage(campaign.id, encounter, sheet, enemy);
  // The hit is known: now the smite slot and the maneuver's die are spent.
  let stunDc: number | null = null;
  if (hit && strike.hasOnHit) {
    const paid = spendOnHit(campaign, turn.id, onHitSpends, plan.sheets, plan.sheetsById);
    stunDc = paid.stunPaid && onHitSpends.stun ? onHitSpends.stun.dc : null;
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
    // Acid Arrow: a miss still deals half the damage.
    const grazed = spellRider?.halfOnMiss && hitOutcome.crit !== "nat1" ? missDamage(plan) : null;
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
      ...(grazed ?? {}),
      note: grazed
        ? `The attack misses, and the spell still deals half its damage; the server already applied it.`
        : "The attack misses; narrate the miss.",
    };
  }
  // The hit uses up the charges waiting for it (the smites).
  clearHitSpent(campaign, sheet.id, plan.hitSpent);

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

  // A magic weapon's dice on a natural 20 (src/lib/dm/gear-attack.ts).
  const critGear = hitOutcome.crit === "nat20" ? gearCritRiders(profile, enemy.stats.type) : null;
  if (critGear?.suffix) {
    profile = { ...profile, damageExpression: `${profile.damageExpression}${critGear.suffix}` };
    typedRiders.push(...critGear.typed);
    context.notes.push(...critGear.notes);
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
    detail: strike.detail,
    result: damageOutcome,
    attacker: { kind: "sheet", id: sheet.id, name: sheet.name },
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

  const applied = landRoll(damageRoll.id, enemy.id, () =>
    applyHitDamage({
      plan,
      typedRiders,
      damageOutcome,
      dealt,
      crit,
      critExtraDice,
    }),
  );

  // Great Weapon Master: a melee weapon crit or kill opens a bonus-action
  // melee attack this turn (pc-attack-options.ts reads the key).
  if (
    plan.weaponAttack && !profile.ranged && !plan.atRange && (crit || applied.dead) && budget &&
    holdsFeat(sheet, "Great Weapon Master") && !budget.oncePerTurn.includes(GREAT_WEAPON_MASTER_READY)
  ) {
    budget.oncePerTurn.push(GREAT_WEAPON_MASTER_READY);
    // The budget was stored before the roll; the key goes on the stored copy.
    storeBudget(encounter, budget);
    context.notes.push(`Great Weapon Master: ${crit ? "the critical hit" : "the kill"} opens a bonus-action melee attack this turn (bonusAttack "feature")`);
  }
  const maneuverOutcome: Record<string, unknown> =
    maneuver?.rider && !applied.dead && !applied.encounterOver
      ? maneuverRiderSave(plan, maneuver)
      : {};
  if (stunDc !== null && !applied.encounterOver) {
    maneuverOutcome.stunningStrike = stunningStrikeSave(campaign, encounter.id, enemy.id, sheet.id, stunDc);
  }
  Object.assign(maneuverOutcome, hitExtras(plan, Boolean(applied.dead), Boolean(applied.encounterOver)));
  // Dark One's Blessing: a kill gives a Fiend warlock temporary hit points.
  const blessing = applied.dead ? darkOnesBlessing(campaign, sheet.id) : null;
  if (blessing) {
    maneuverOutcome.darkOnesBlessing = blessing;
  }
  // Authored subclass features on a hit (a guardian's mark, Order's Wrath, Touch of Death): authored-hooks.ts.
  const authoredLines = authoredOnHit(campaign, { encounter, sheet, enemy, melee: !profile.ranged, weapon: plan.weaponAttack, weaponName: profile.weapon, dead: Boolean(applied.dead) });
  if (authoredLines.length) {
    maneuverOutcome.subclassFeatures = authoredLines;
  }
  // What an attack spell leaves beyond its damage (spell-attack-riders.ts).
  if (spellRider && !applied.encounterOver) {
    const lines = [
      applySpellHitCondition(campaign, spellRider, enemy.id, sheet.id),
      spellRider.healHalf
        ? healCasterHalf(campaign, sheet.id, Number(applied.damageApplied ?? dealt) || 0, profile.weapon)
        : null,
    ].filter((line): line is string => Boolean(line));
    if (lines.length) {
      maneuverOutcome.spellEffect = lines.join("; ");
    }
  }
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
      : applied.knockedOut
        ? `${enemy.displayName} is knocked out, unconscious at 0 hit points and out of the fight; the server already applied this. Narrate it falling senseless, not dying.`
      : dealt === 0
        ? `The blow lands and does no harm: its damage came to 0. Narrate a hit that fails to hurt ${enemy.displayName}.`
        : `The server already applied this damage to ${enemy.displayName}. Do NOT call damage_enemy for this hit; narrate from this state.`,
  };
}

// Pays for a rescued miss: Foe Slayer's once a turn, or Stroke of Luck's use.
function payRescue(plan: AttackPlan, rescued: "foe slayer" | "stroke of luck"): boolean {
  if (rescued === "foe slayer") {
    claimFoeSlayer(plan);
    plan.context.notes.push(`Foe Slayer: +${plan.extras.foeSlayer} to the attack roll turns the miss into a hit`);
    return true;
  }
  if (!spendFeatureUse(plan.campaign, plan.sheet.id, STROKE_OF_LUCK, "Stroke of Luck")) {
    return false;
  }
  plan.context.notes.push("Stroke of Luck: the miss becomes a hit (the use is spent)");
  return true;
}

// Foe Slayer is once on each of the ranger's turns: the turn remembers it.
function claimFoeSlayer(plan: AttackPlan) {
  const live = plan.encounter.turnBudget ?? plan.budget;
  if (live && !live.oncePerTurn.includes(FOE_SLAYER)) {
    storeBudget(plan.encounter, { ...live, oncePerTurn: [...live.oncePerTurn, FOE_SLAYER] });
  }
}

// What the hit carries past its damage: a coat of poison, Open Hand
// Technique, Hurl Through Hell (src/lib/dm/attack-onhit.ts).
export function hitExtras(plan: AttackPlan, dead: boolean, over: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const { campaign, sheet, enemy, extras } = plan;
  if (extras.poison) {
    const line = over ? null : poisonOnHit(campaign, sheet.id, enemy.id);
    if (line) {
      out.poison = line;
    }
  }
  if (over || dead) {
    return out;
  }
  if (extras.openHand) {
    out.openHand = openHandOnHit(campaign, sheet.id, enemy.id, extras.openHand.choice, extras.openHand.dc);
  }
  if (extras.hurl && spendFeatureUse(campaign, sheet.id, HURL_THROUGH_HELL, "Hurl Through Hell")) {
    out.hurlThroughHell = hurlThroughHell(campaign, sheet.id, enemy.id);
  }
  return out;
}

// Half of a missed spell's damage (Acid Arrow), rolled and applied like a
// hit's, rounded down.
function missDamage(plan: AttackPlan): Record<string, unknown> | null {
  const { campaign, turn, sheet, enemy, profile } = plan;
  const outcome = rollExpression(profile.damageExpression);
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "damage",
    detail: rollAgainst(`${profile.weapon} (half on a miss)`, enemy.displayName),
    result: outcome,
    attacker: { kind: "sheet", id: sheet.id, name: sheet.name },
  });
  publishRoll(campaign.id, roll);
  turn.rollIds.push(roll.id);
  const half = Math.floor(Math.max(0, outcome.total) / 2);
  if (half <= 0) {
    return { damage: 0 };
  }
  const applied = landRoll(roll.id, plan.enemy.id, () =>
    applyHitDamage({ plan, typedRiders: [], damageOutcome: outcome, dealt: half, crit: false, critExtraDice: 0 }),
  );
  return { ...applied, damage: half };
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
      // Prone lasts until the creature stands. Menacing Attack's fright and
      // Goading Attack's goad last until the end of the attacker's next turn
      // (SRD 5.1, src/lib/dm/turn-end.ts); a disarm is a moment.
      ...(rider.condition === "prone"
        ? {}
        : rider.condition === "frightened" || rider.condition === "goaded"
          ? { meta: untilTurnEnd(plan.sheet.id, { source: plan.sheet.id }) }
          : { rounds: 1 }),
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
