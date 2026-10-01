// The physical dice path of pc_attack: the to-hit roll is parked for the
// player, and when it lands resolvePendingPcAttack adjudicates it and, on a
// hit, parks the damage roll too. Split from pc-attack.ts, which has
// already refused or paid for everything the parked roll carries.

import { tryParry } from "@/lib/dm/enemy-reactions";
import { getCampaignById } from "@/lib/db/campaigns";
import {
  createPendingRoll,
  getDmTurn,
  publicPendingRoll,
  type PendingRoll,
} from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy } from "@/lib/db/encounters";
import type { StoredRoll } from "@/lib/db/rolls";
import { listSheets } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { adjudicateHit } from "@/lib/dm/attack-logic";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { liveTypedRiders, strikesAsMagic } from "@/lib/dm/pc-attack-damage";
import type { AttackPlan } from "@/lib/dm/pc-attack-plan";
import type { Strike } from "@/lib/dm/pc-attack-resolve";
import { clearHitSpent, spendOnHit, stunningStrikeSave, type ParkedAttack } from "@/lib/dm/pc-attack-riders";
import { authoredOnHit } from "@/lib/dm/authored-hooks";
import { applySpellHitCondition, spellAttackRider } from "@/lib/dm/spell-attack-riders";
import { gearCritRiders } from "@/lib/dm/gear-attack";
import { FOE_SLAYER, rescueMiss, STROKE_OF_LUCK } from "@/lib/dm/attack-features";
import {
  HURL_THROUGH_HELL,
  hurlThroughHell,
  openHandOnHit,
  poisonOnHit,
  spendFeatureUse,
} from "@/lib/dm/attack-onhit";
import { storeBudget } from "@/lib/dm/turn-budget";

// The parked roll's share of what rides the attack (src/lib/dm/pc-attack-plan.ts).
function parkedExtras(plan: AttackPlan): Pick<ParkedAttack, "extras"> | null {
  const { extras } = plan;
  const kept = {
    ...(extras.foeSlayer > 0 ? { foeSlayer: extras.foeSlayer } : {}),
    ...(extras.strokeOfLuck ? { strokeOfLuck: true } : {}),
    ...(extras.openHand ? { openHand: extras.openHand } : {}),
    ...(extras.hurl ? { hurl: true } : {}),
    ...(extras.poison ? { poison: true } : {}),
  };
  return Object.keys(kept).length ? { extras: kept } : null;
}

// Foe Slayer is once on each of the ranger's turns: the live turn remembers
// it. False when it was already used.
function claimParkedFoeSlayer(campaignId: string): boolean {
  const encounter = getActiveEncounter(campaignId);
  const budget = encounter?.turnBudget;
  if (!encounter || !budget || budget.oncePerTurn.includes(FOE_SLAYER)) {
    return false;
  }
  storeBudget(encounter, { ...budget, oncePerTurn: [...budget.oncePerTurn, FOE_SLAYER] });
  return true;
}

// Physical dice: park the to-hit roll for the player; the submit route
// adjudicates it and, on a hit, parks the damage roll too.
export function parkPcAttack(plan: AttackPlan, strike: Strike, toolCallId: string | null) {
  const { campaign, turn, sheet, enemy, profile, riders, context } = plan;
  const { critExtraDice } = strike;
  // The damage stage resolves the blow per type and with the magical flag,
  // as the digital path does, so both travel with the roll.
  const parkedRiders = liveTypedRiders(plan.typedRiders, plan.droppedRiders);
  const critGear = gearCritRiders(profile, enemy.stats.type);
  const parked: ParkedAttack = {
    magical: strikesAsMagic(plan),
    ...(plan.atRange ? {} : { melee: true }),
    ...(parkedRiders.length ? { riders: parkedRiders } : {}),
    ...(critExtraDice ? { critExtraDice } : {}),
    attacker: sheet.name,
    weapon: profile.weapon,
    targetEnemyId: enemy.id,
    targetAc: plan.effectiveAc,
    damageExpression: profile.damageExpression,
    critDamageExpression: critDamageExpression(profile.damageExpression, critExtraDice, strike.critOptions),
    damageType: profile.damageType,
    ...(context.autoCrit ? { autoCrit: true } : {}),
    ...(riders.critRange < 20 && plan.weaponAttack ? { critRange: riders.critRange } : {}),
    ...(strike.rerollBelow ? { rerollBelow: strike.rerollBelow } : {}),
    ...(strike.hasOnHit ? { onHit: strike.onHitSpends } : {}),
    ...(plan.options.nonlethal ? { nonlethal: true } : {}),
    ...(plan.hitSpent.length ? { hitSpent: plan.hitSpent } : {}),
    ...(plan.kind === "spell" && plan.args.spell ? { spell: plan.args.spell } : {}),
    ...(critGear.suffix ? { critGear } : {}),
    ...(parkedExtras(plan) ?? {}),
  };
  const pending = createPendingRoll({
    campaignId: campaign.id,
    turnId: turn.id,
    toolCallId,
    userId: sheet.userId,
    characterId: sheet.id,
    kind: "attack",
    detail: strike.detail,
    expression: strike.toHitExpression,
    advantage: plan.advantage,
    dc: null,
    reason: `${profile.weapon} attack against ${enemy.displayName}`,
    attack: parked,
  });
  publishPersisted(campaign.id, "roll_pending", { pendingRoll: publicPendingRoll(pending) });
}

// Physical-dice adjudication, called from the pending-rolls submit route
// when a parked pc_attack to-hit roll lands. Returns the combat note the
// resumed turn surfaces to the model; on a hit it parks the damage roll so
// the turn stays paused until the player rolls their damage dice (which the
// existing applyPendingDamageRoll path then applies).
export function resolvePendingPcAttack(pending: PendingRoll, roll: StoredRoll): string | null {
  const context = pending.attack;
  if (!context) {
    return null;
  }
  const campaign = getCampaignById(pending.campaignId);
  const turn = getDmTurn(pending.turnId);
  if (!campaign || !turn) {
    return null;
  }
  // A to-hit roll still parked when the turn moved on (the lead skipped it,
  // the order was edited) must not land on a later turn as though nothing
  // had happened: the player declared it on a turn that is over.
  const fight = getActiveEncounter(pending.campaignId);
  if (fight?.orderReady) {
    const current = fight.order[fight.turnIndex];
    if (!current || current.kind !== "pc" || current.characterId !== pending.characterId) {
      return `${context.attacker}'s ${context.weapon} attack was still unrolled when their turn ended, so it does not land. No damage roll happens; narrate the moment passing.`;
    }
  }
  const judged = adjudicateHit(roll.total, roll.breakdown.crit, context.targetAc, {
    natural: roll.breakdown.natural,
    critRange: context.critRange,
  });
  // Parry: the creature's reaction lifts its AC against a melee hit (enemy-reactions.ts).
  const parryFoe = fight && context.targetEnemyId ? getEnemy(context.targetEnemyId) : null;
  const parry = judged.hit && !judged.crit && fight && parryFoe && (context as ParkedAttack).melee
    ? tryParry({ encounter: fight, enemy: parryFoe, total: roll.total, natural20: false, ac: context.targetAc, melee: true, attackerUnseen: false })
    : null;
  const adjudicated = parry ? { ...judged, hit: false, crit: false } : judged;
  const extras = (context as ParkedAttack).extras;
  // Foe Slayer turns a near miss into a hit, and a declared Stroke of Luck
  // any miss (src/lib/dm/attack-features.ts).
  const rescued = adjudicated.hit
    ? null
    : rescueMiss({
        total: roll.total,
        ac: context.targetAc,
        natural1: roll.breakdown.crit === "nat1",
        foeSlayer: extras?.foeSlayer ?? 0,
        strokeOfLuck: extras?.strokeOfLuck === true,
      });
  const rescueNote =
    rescued === "foe slayer"
      ? claimParkedFoeSlayer(pending.campaignId) && `Foe Slayer: +${extras?.foeSlayer} turns the miss into a hit`
      : rescued === "stroke of luck" && spendFeatureUse(campaign, pending.characterId ?? "", STROKE_OF_LUCK, "Stroke of Luck")
        ? "Stroke of Luck: the miss becomes a hit"
        : null;
  const hit = adjudicated.hit || Boolean(rescueNote);
  const crit = adjudicated.crit || (hit && context.autoCrit === true);
  if (!hit) {
    return `${context.attacker}'s ${context.weapon} attack rolled ${roll.total} vs AC ${context.targetAc}: MISS${
      roll.breakdown.crit === "nat1" ? " (natural 1)" : ""
    }${parry ? ` (${parry.note})` : ""}. No damage roll happens; narrate the miss.`;
  }
  // Verify the target still stands before asking for damage dice (the lead
  // may have force-ended the encounter while the roll sat parked).
  const encounter = getActiveEncounter(pending.campaignId);
  const enemy = encounter ? resolveEnemyRef(encounter.id, context.targetEnemyId) : null;
  if (!enemy || enemy.status !== "alive") {
    return `${context.attacker}'s ${context.weapon} attack rolled ${roll.total} vs AC ${context.targetAc}: HIT, but the target is already gone; narrate around it.`;
  }
  const sheets = listSheets(pending.campaignId);
  const sheet = sheets.find((entry) => entry.id === pending.characterId);
  // The hit uses up the charges waiting for it (the smites), and an attack
  // spell's rider lands on it (spell-attack-riders.ts).
  const parked = context as ParkedAttack;
  if (sheet && parked.hitSpent?.length) {
    clearHitSpent(campaign, sheet.id, parked.hitSpent);
  }
  const spellRider = spellAttackRider(parked.spell);
  const spellLine = spellRider && sheet ? applySpellHitCondition(campaign, spellRider, enemy.id, sheet.id) : null;
  // Authored subclass features on a hit (a guardian's mark, Order's Wrath): authored-hooks.ts.
  const authoredLines = sheet && encounter ? authoredOnHit(campaign, { encounter, sheet, enemy, weapon: !parked.spell, weaponName: context.weapon, dead: false }) : [];
  // The player's own d20 said hit: now the smite slot and the maneuver's
  // die are spent, and their dice join the damage the player rolls.
  const onHit = (context as ParkedAttack).onHit;
  let damage = context.damageExpression;
  let critDamage = context.critDamageExpression;
  const spentNotes: string[] = [...authoredLines];
  if (onHit) {
    const paid = spendOnHit(
      campaign,
      turn.id,
      onHit,
      sheets,
      new Map(sheets.map((entry) => [entry.id, entry])),
    );
    spentNotes.push(...paid.notes);
    if (paid.stunPaid && onHit.stun) {
      spentNotes.push(stunningStrikeSave(campaign, enemy.encounterId, enemy.id, pending.characterId ?? "", onHit.stun.dc));
    }
    if (paid.suffix) {
      damage = `${onHit.baseDamage}${paid.suffix}`;
      critDamage = critDamageExpression(damage, onHit.critExtraDice, {
        powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
        multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
      });
    }
  }
  // A natural 20's magic weapon dice, and Foe Slayer's bonus on a hit it
  // did not have to rescue.
  const parkedGear = (context as ParkedAttack).critGear;
  if (roll.breakdown.crit === "nat20" && parkedGear?.suffix) {
    damage = `${damage}${parkedGear.suffix}`;
    critDamage = critDamageExpression(damage, context.critExtraDice ?? 0, {
      powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
      multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
    });
    spentNotes.push(...parkedGear.notes);
  }
  if (adjudicated.hit && (extras?.foeSlayer ?? 0) > 0 && claimParkedFoeSlayer(pending.campaignId)) {
    damage = `${damage}+${extras?.foeSlayer}`;
    critDamage = `${critDamage}+${extras?.foeSlayer}`;
    spentNotes.push(`Foe Slayer: +${extras?.foeSlayer} damage`);
  }
  if (rescueNote) {
    spentNotes.push(rescueNote);
  }
  // What the hit carries past its damage (src/lib/dm/attack-onhit.ts).
  if (extras?.poison && sheet) {
    spentNotes.push(poisonOnHit(campaign, sheet.id, enemy.id) ?? "");
  }
  if (extras?.openHand && sheet) {
    spentNotes.push(openHandOnHit(campaign, sheet.id, enemy.id, extras.openHand.choice, extras.openHand.dc));
  }
  if (extras?.hurl && sheet && spendFeatureUse(campaign, sheet.id, HURL_THROUGH_HELL, "Hurl Through Hell")) {
    spentNotes.push(hurlThroughHell(campaign, sheet.id, enemy.id));
  }
  const expression = crit ? critDamage : damage;
  // A smite the hit paid for rides as radiant, as on the digital path.
  const smiteDice = onHit?.smite ? `${onHit.smite.dice}d8` : null;
  const damageRiders = [
    ...(context.riders ?? []),
    ...(roll.breakdown.crit === "nat20" ? (parkedGear?.typed ?? []) : []),
    ...(smiteDice && damage.includes(`+${smiteDice}`) ? [{ dice: smiteDice, type: "radiant" }] : []),
  ];
  const damagePending = createPendingRoll({
    campaignId: pending.campaignId,
    turnId: pending.turnId,
    // No paired tool call: the resumed turn pushes this result without an
    // id, which the conversation loop tolerates; the combat notes on both
    // stages carry the full story.
    toolCallId: null,
    userId: pending.userId,
    characterId: pending.characterId,
    kind: "damage",
    detail: `${sheet?.name ?? context.attacker}: ${context.weapon} damage`,
    expression,
    advantage: "none",
    dc: null,
    reason: `${context.weapon} damage against ${enemy.displayName}`,
    targetEnemyId: enemy.id,
    // Carried so the damage stage keeps the types, the magical flag and the
    // critical for resistance math.
    attack: {
      ...context,
      ...(damageRiders.length ? { riders: damageRiders } : {}),
      ...(crit ? { crit: true } : {}),
    },
  });
  publishPersisted(pending.campaignId, "roll_pending", {
    pendingRoll: publicPendingRoll(damagePending),
  });
  return `${context.attacker}'s ${context.weapon} attack rolled ${roll.total} vs AC ${context.targetAc}: HIT${
    crit ? " (CRITICAL: damage dice are doubled)" : ""
  }.${spentNotes.length ? ` ${spentNotes.join("; ")}.` : ""}${spellLine ? ` ${spellLine}.` : ""} ${context.attacker} now rolls damage (${expression})${
    context.rerollBelow
      ? `, rerolling any die of ${context.rerollBelow} or less once for Great Weapon Fighting`
      : ""
  }; the server will apply it to ${enemy.displayName} automatically.`;
}
