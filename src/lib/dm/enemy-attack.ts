// enemy_attack: an enemy's action against a character, resolved from the
// enemy's real stat block against the target's real Armor Class. Split from
// encounter-tools.ts, which dispatches to it and whose auto-act fallback
// calls it for the enemies a turn skipped. Must not import encounter-tools.

import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import {
  getActiveEncounter,
  recordEncounterTarget,
  saveEncounter,
  type EncounterEnemy,
} from "@/lib/db/encounters";
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import type { DmTurn } from "@/lib/db/dm-turns";
import { insertRoll } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { d20Expression, rollExpression, type Advantage } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { synthesizeStats } from "@/lib/bestiary/synthesize";
import type { EnemyAttack } from "@/lib/bestiary/statblock";
import { planAttackFx } from "@/lib/battlemap/fx-plan";
import { acWithEffects } from "@/lib/dm/ac-effects";
import { normalizeAdvantage } from "@/lib/dm/arg-coerce";
import { coverFor, enemyFlanks, enemyShootsInMelee, tilesBetween } from "@/lib/dm/attack-spatial";
import { normalizeClock } from "@/lib/dm/calendar";
import { canEnemyAct, markEnemyActed } from "@/lib/dm/can-act";
import { attackContext, mergeAdvantage } from "@/lib/dm/condition-logic";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import { approachForAttack, isRangedAttackName } from "@/lib/dm/map-tools";
import { applyDmMutation } from "@/lib/dm/mutations";
import { withLiveDodge } from "@/lib/dm/opportunity";
import { conditionsOf } from "@/lib/dm/vitals-logic";
import { weatherRangedRider } from "@/lib/srd/weather";
import { conditionRollRiders } from "@/lib/srd/condition-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const attackArgsSchema = z.object({
  enemyId: z.string(),
  targetCharacterId: z.string(),
  attack: z.string().optional(),
  advantage: z.preprocess(
    normalizeAdvantage,
    z.enum(["none", "advantage", "disadvantage"]).optional(),
  ),
});

function pickAttack(enemy: EncounterEnemy, requested: string | undefined): EnemyAttack | null {
  const attacks = enemy.stats.attacks.length
    ? enemy.stats.attacks
    : synthesizeStats(enemy.cr).attacks;
  if (!attacks.length) {
    return null;
  }
  const wanted = (requested ?? "").trim().toLowerCase();
  if (wanted) {
    const match = attacks.find(
      (attack) =>
        attack.name.toLowerCase() === wanted || attack.name.toLowerCase().includes(wanted),
    );
    if (match) {
      return match;
    }
  }
  return attacks[0];
}

export function handleEnemyAttack(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter." };
  }
  let args: z.infer<typeof attackArgsSchema>;
  try {
    args = attackArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: enemy_attack needs enemyId and targetCharacterId." };
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return { error: "Unknown enemyId; use one from GAME STATE." };
  }
  // One guard for the enemy side (src/lib/dm/can-act.ts): the dead, the
  // incapacitated and the surprised do nothing, and an action is one a round.
  const allowed = canEnemyAct({ enemy, encounter, kind: "action" });
  if (!allowed.ok) {
    return { error: allowed.error };
  }
  const staleTarget =
    sheetsById.get(args.targetCharacterId.trim()) ??
    sheets.find(
      (sheet) => sheet.name.toLowerCase() === args.targetCharacterId.trim().toLowerCase(),
    );
  const target = staleTarget ? getSheetById(staleTarget.id) : null;
  if (!target) {
    return { error: "Unknown targetCharacterId; use one from GAME STATE." };
  }
  const attack = pickAttack(enemy, args.attack);
  if (!attack) {
    return { error: `${enemy.displayName} has no usable attacks; narrate a different action.` };
  }

  // Battle-map positions are authoritative: a melee attacker out of reach
  // auto-approaches along a legal path, and the attack is refused when the
  // target is still beyond range, so narration can never teleport enemies.
  const spatial = approachForAttack(campaign, encounter.id, enemy.id, target.id, attack.name);
  if (spatial?.blocked) {
    return spatial.blocked;
  }
  // The walk may have drawn an opportunity attack that killed it.
  const standing = resolveEnemyRef(encounter.id, enemy.id);
  if (!standing || standing.status !== "alive") {
    return {
      ok: true,
      attack: attack.name,
      target: target.name,
      swings: [],
      hit: false,
      opportunityAttacks: spatial?.opportunityAttacks ?? [],
      note: `${enemy.displayName} was struck down on its way to ${target.name} and never made the attack.`,
    };
  }
  // Where the two stand after the approach, for the effect and the target
  // line every client draws (src/lib/battlemap/fx-plan.ts).
  const attackerPos = tokenPosition(campaign.id, enemy.id);
  const targetPos = tokenPosition(campaign.id, target.id);
  if (attackerPos && targetPos) {
    recordEncounterTarget(encounter.id, encounter.round, enemy.id, target.id);
  }
  // A gale over an outdoor board: disadvantage on ranged attacks past 30 ft,
  // for the monsters exactly as for the party.
  const boardForWeather = getBattleMapForEncounter(encounter.id);
  const gale =
    attackerPos && targetPos && boardForWeather?.outdoors
      ? weatherRangedRider(
          normalizeClock(campaign.clock).weather,
          isRangedAttackName(attack.name),
          Math.max(
            Math.abs(attackerPos.at.x - targetPos.at.x),
            Math.abs(attackerPos.at.y - targetPos.at.y),
          ),
        )
      : { disadvantage: false, note: null };

  // Conditions on both sides drive advantage and auto-crits; the model's
  // situational claim merges in as one more source.
  const ranged = isRangedAttackName(attack.name);
  const apart = tilesBetween(encounter.id, enemy.id, target.id);
  const conditionContext = attackContext({
    attackerConditions: enemy.conditions,
    // Dodge is lost with the dodger's speed, and a character at 0 hit points
    // is unconscious and prone whatever wrote the 0.
    targetConditions: withLiveDodge(conditionsOf(target)),
    melee: !ranged,
    adjacent: apart === null ? !ranged : apart <= 1,
    requested: args.advantage ?? "none",
  });
  // A shot with a character at the shooter's elbow, and the Flanking
  // variant, for the monsters exactly as for the party.
  const crowded = ranged && enemyShootsInMelee(encounter.id, enemy.id, enemy.conditions);
  if (crowded) {
    conditionContext.notes.push("a hostile creature is within 5 feet: disadvantage on ranged attacks");
  }
  const flanking =
    campaign.gameSettings.variantRules.flanking &&
    !ranged &&
    enemyFlanks(encounter.id, enemy.id, target.id);
  if (flanking) {
    conditionContext.notes.push("flanking: advantage");
  }
  // Cover protects whoever stands behind it.
  const cover = coverFor(encounter.id, enemy.id, target.id);
  if (cover) {
    conditionContext.notes.push(
      `${target.name} has ${cover === 2 ? "half" : "three-quarters"} cover: +${cover} AC`,
    );
  }
  const targetAc = () => {
    const fresh = getSheetById(target.id) ?? target;
    return acWithEffects(campaign.id, fresh) + cover;
  };

  // Multiattack: the full routine executes in this ONE call, each swing its
  // own to-hit and damage dice cards, stopping early if the target drops.
  // A spell a character left on the creature (Bane's d4 off, Bless's d4 on)
  // counts on every swing, as it would on a character's attack.
  const riders = conditionRollRiders(enemy.conditions, "attack");
  const advantage: Advantage = mergeAdvantage([
    conditionContext.advantage,
    ...(gale.disadvantage ? ["disadvantage" as const] : []),
    ...(crowded ? ["disadvantage" as const] : []),
    ...(flanking ? ["advantage" as const] : []),
    ...riders.advantageSources,
  ]);
  if (gale.note) {
    conditionContext.notes.push(gale.note);
  }
  conditionContext.notes.push(...riders.notes);
  // As many swings as the stat block's Multiattack gives. The ceiling is a
  // guard against a corrupt block, not a rule.
  const totalSwings = Math.max(1, Math.min(10, Math.floor(enemy.stats.attacksPerTurn ?? 1)));
  // The action is spent by taking it, hit or miss. Read fresh: the walk up
  // to the target may have spent a character's reaction on this same row.
  const live = getActiveEncounter(campaign.id) ?? encounter;
  markEnemyActed(live, enemy.id);
  saveEncounter(live);
  const swings: Array<Record<string, unknown>> = [];
  let dropped = false;
  let totalDamage = 0;
  let targetHp: string | undefined;
  for (let swing = 0; swing < totalSwings && !dropped; swing += 1) {
    const hitOutcome = rollExpression(`${d20Expression(attack.toHit, advantage)}${riders.diceSuffix}`);
    const hitRoll = insertRoll({
      campaignId: campaign.id,
      characterId: target.id,
      requestedBy: "dm",
      kind: "attack",
      detail: `${enemy.displayName}: ${attack.name}`,
      advantage,
      result: hitOutcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: hitRoll,
      source: "digital",
    });
    turn.rollIds.push(hitRoll.id);

    const natCrit = hitOutcome.crit === "nat20";
    const hit =
      hitOutcome.crit !== "nat1" &&
      (natCrit || hitOutcome.total >= targetAc());
    const crit = natCrit || (hit && conditionContext.autoCrit);
    if (!hit) {
      swings.push({
        rolled: hitOutcome.total,
        hit: false,
        ...(hitOutcome.crit === "nat1" ? { fumble: true } : {}),
      });
      if (attackerPos && targetPos && !attackerPos.hidden) {
        publishFx(
          campaign.id,
          planAttackFx({
            from: attackerPos.at,
            to: targetPos.at,
            fromTokenId: attackerPos.tokenId,
            toTokenId: targetPos.tokenId,
            hit: false,
            crit: false,
            fumble: hitOutcome.crit === "nat1",
            ranged,
            damageType: attack.type,
            visibility: hitRoll.visibility,
          }),
        );
      }
      continue;
    }

    const damageExpression = crit
      ? critDamageExpression(attack.damage, 0, {
          powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
          multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
        })
      : attack.damage;
    const damageOutcome = rollExpression(damageExpression);
    const damageRoll = insertRoll({
      campaignId: campaign.id,
      characterId: target.id,
      requestedBy: "dm",
      kind: "damage",
      detail: `${enemy.displayName}: ${attack.name} damage`,
      result: damageOutcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: damageRoll,
      source: "digital",
    });
    turn.rollIds.push(damageRoll.id);

    // A penalty can bring a hit's damage to 0, never below it; a hit for
    // nothing has nothing to apply.
    const dealt = Math.max(0, damageOutcome.total);
    // Damage lands through the standard mutation: temp HP, clamps, audit,
    // and the live sheet_updated publish all come for free.
    const applied: Record<string, unknown> = dealt <= 0 ? {} : applyDmMutation(
      campaign,
      turn.id,
      "apply_damage",
      JSON.stringify({
        characterId: target.id,
        amount: dealt,
        type: attack.type,
        // Crits against a dying target count double death-save failures.
        ...(crit ? { crit: true } : {}),
        reason: `${enemy.displayName}'s ${attack.name}`,
      }),
      sheets,
      sheetsById,
    ).result;
    totalDamage += dealt;
    if (attackerPos && targetPos && !attackerPos.hidden) {
      publishFx(
        campaign.id,
        planAttackFx({
          from: attackerPos.at,
          to: targetPos.at,
          fromTokenId: attackerPos.tokenId,
          toTokenId: targetPos.tokenId,
          hit: true,
          crit,
          ranged,
          damage: dealt,
          damageType: attack.type,
          visibility: hitRoll.visibility,
        }),
      );
    }
    if (typeof applied.hp === "string") {
      targetHp = applied.hp;
    }
    if (applied.dropped) {
      dropped = true;
    }
    swings.push({
      rolled: hitOutcome.total,
      hit: true,
      ...(crit ? { crit: true } : {}),
      damage: dealt,
    });
  }

  // The auto-act fallback in advanceAfterTurn skips enemies that already
  // took their turn here.
  if (!turn.actedEnemyIds.includes(enemy.id)) {
    turn.actedEnemyIds.push(enemy.id);
  }

  return {
    attack: attack.name,
    vsAc: targetAc(),
    target: target.name,
    ...(spatial?.opportunityAttacks?.length
      ? { opportunityAttacks: spatial.opportunityAttacks }
      : {}),
    ...(totalSwings > 1 ? { multiattack: `${totalSwings} attacks` } : {}),
    swings,
    hit: swings.some((entry) => entry.hit),
    ...(totalDamage > 0 ? { totalDamage, damageType: attack.type } : {}),
    ...(conditionContext.notes.length ? { conditionEffects: conditionContext.notes } : {}),
    ...(targetHp ? { targetHp } : {}),
    ...(dropped ? { dropped: true, note: `${target.name} falls to 0 HP.` } : {}),
  };
}
