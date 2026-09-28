// The physical dice path of pc_attack: the to-hit roll is parked for the
// player, and when it lands resolvePendingPcAttack adjudicates it and, on a
// hit, parks the damage roll too. Split from pc-attack.ts, which has
// already refused or paid for everything the parked roll carries.

import { getCampaignById } from "@/lib/db/campaigns";
import {
  createPendingRoll,
  getDmTurn,
  publicPendingRoll,
  type PendingRoll,
} from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import type { StoredRoll } from "@/lib/db/rolls";
import { listSheets } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { adjudicateHit } from "@/lib/dm/attack-logic";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { liveTypedRiders, strikesAsMagic } from "@/lib/dm/pc-attack-damage";
import type { AttackPlan } from "@/lib/dm/pc-attack-plan";
import type { Strike } from "@/lib/dm/pc-attack-resolve";
import { spendOnHit, type ParkedAttack } from "@/lib/dm/pc-attack-riders";

// Physical dice: park the to-hit roll for the player; the submit route
// adjudicates it and, on a hit, parks the damage roll too.
export function parkPcAttack(plan: AttackPlan, strike: Strike, toolCallId: string | null) {
  const { campaign, turn, sheet, enemy, profile, riders, context } = plan;
  const { critExtraDice } = strike;
  // The damage stage resolves the blow per type and with the magical flag,
  // as the digital path does, so both travel with the roll.
  const parkedRiders = liveTypedRiders(plan.typedRiders, plan.droppedRiders);
  const parked: ParkedAttack = {
    magical: strikesAsMagic(plan),
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
    ...(riders.critRange < 20 ? { critRange: riders.critRange } : {}),
    ...(strike.rerollBelow ? { rerollBelow: strike.rerollBelow } : {}),
    ...(strike.hasOnHit ? { onHit: strike.onHitSpends } : {}),
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
  const adjudicated = adjudicateHit(roll.total, roll.breakdown.crit, context.targetAc, {
    natural: roll.breakdown.natural,
    critRange: context.critRange,
  });
  const hit = adjudicated.hit;
  const crit = adjudicated.crit || (hit && context.autoCrit === true);
  if (!hit) {
    return `${context.attacker}'s ${context.weapon} attack rolled ${roll.total} vs AC ${context.targetAc}: MISS${
      roll.breakdown.crit === "nat1" ? " (natural 1)" : ""
    }. No damage roll happens; narrate the miss.`;
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
  // The player's own d20 said hit: now the smite slot and the maneuver's
  // die are spent, and their dice join the damage the player rolls.
  const onHit = (context as ParkedAttack).onHit;
  let damage = context.damageExpression;
  let critDamage = context.critDamageExpression;
  const spentNotes: string[] = [];
  if (onHit) {
    const paid = spendOnHit(
      campaign,
      turn.id,
      onHit,
      sheets,
      new Map(sheets.map((entry) => [entry.id, entry])),
    );
    spentNotes.push(...paid.notes);
    if (paid.suffix) {
      damage = `${onHit.baseDamage}${paid.suffix}`;
      critDamage = critDamageExpression(damage, onHit.critExtraDice, {
        powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
        multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
      });
    }
  }
  const expression = crit ? critDamage : damage;
  // A smite the hit paid for rides as radiant, as on the digital path.
  const smiteDice = onHit?.smite ? `${onHit.smite.dice}d8` : null;
  const damageRiders = [
    ...(context.riders ?? []),
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
  }.${spentNotes.length ? ` ${spentNotes.join("; ")}.` : ""} ${context.attacker} now rolls damage (${expression})${
    context.rerollBelow
      ? `, rerolling any die of ${context.rerollBelow} or less once for Great Weapon Fighting`
      : ""
  }; the server will apply it to ${enemy.displayName} automatically.`;
}
