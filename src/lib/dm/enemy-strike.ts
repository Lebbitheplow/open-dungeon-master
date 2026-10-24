// One stat-block creature striking another (issue 503, Phase 6): a dominated
// ogre clubbing the goblin it fought beside, a confused wolf biting whatever
// is nearest, a summon turned on its maker's side swinging at an enemy the
// party still faces. enemy_attack sends an attack whose target is an enemy
// row here (enemy-attack.ts); a target that is a character keeps the
// character path, with all a sheet's defences.
//
// The routine is the block's (its Multiattack, or the attack named), each
// swing an attack roll against the target's Armor Class with both sides'
// conditions (condition-logic.ts attackContext), the blow by type, and the
// damage through applyEnemyDamage: the target's resistances, Undead
// Fortitude, its concentration, its death and the end of the fight. The
// attacker walks in first when it can (enemy-approach.ts).
//
// Must not import encounter-tools.

import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, recordEncounterTarget, saveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll, landRoll } from "@/lib/db/rolls";
import type { EnemyAttack } from "@/lib/bestiary/statblock";
import { synthesizeStats } from "@/lib/bestiary/synthesize";
import { planAttackFx } from "@/lib/battlemap/fx-plan";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { rollAgainst } from "@/lib/roll-labels";
import { enemyAcWithEffects } from "@/lib/dm/ac-effects";
import { markEnemyActed } from "@/lib/dm/can-act";
import { attackContext, mergeAdvantage } from "@/lib/dm/condition-logic";
import { applyEnemyDamage } from "@/lib/dm/enemy-damage";
import { approachTarget, spendEnemyAction, standUpIfProne } from "@/lib/dm/enemy-approach";
import { blowByType } from "@/lib/dm/enemy-hit";
import { alternativeBlow, attackNamed, enemyAttackProfile, plannedSwings, swingMode, type EnemyAttackProfile } from "@/lib/dm/enemy-profile";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import { hasTrait } from "@/lib/dm/monster-abilities";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { noneNamed, type ToolResult } from "@/lib/dm/tool-errors";

function leadProfile(profiles: EnemyAttackProfile[]): EnemyAttackProfile {
  const melee = profiles.filter((profile) => profile.melee);
  if (melee.length) {
    return melee.reduce((best, profile) => (profile.reachTiles < best.reachTiles ? profile : best));
  }
  return profiles.reduce((best, profile) => (profile.rangeTiles < best.rangeTiles ? profile : best));
}

export function enemyStrikesEnemy(
  campaign: Campaign,
  turn: DmTurn,
  attacker: EncounterEnemy,
  target: EncounterEnemy,
  input: {
    attack?: string;
    advantage?: "none" | "advantage" | "disadvantage";
    // One swing, not the routine (a slowed creature, a bonus action's
    // attack, Confusion's attack on a random creature).
    single?: boolean;
    bonus?: boolean;
    sheets: CharacterSheet[];
    sheetsById: Map<string, CharacterSheet>;
  },
): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter: an attack needs a fight.", retry: true };
  }
  const attacks = attacker.stats.attacks.length ? attacker.stats.attacks : synthesizeStats(attacker.cr).attacks;
  const asked = input.attack ? attackNamed(attacks, input.attack) : null;
  if (input.attack && !asked) {
    return noneNamed(`${attacker.displayName} has no attack called`, input.attack, attacks.map((attack) => attack.name));
  }
  const pool = input.bonus ? attacks : attacks.filter((attack) => !attack.bonusAction);
  if (!pool.length && !asked) {
    return { error: `${attacker.displayName} has no attack to make; narrate a different action.`, retry: true };
  }
  const planned = plannedSwings(attacker.stats, pool.length ? pool : attacks, asked, { single: input.single });
  const profiles = planned.map((attack) => enemyAttackProfile(attack, attacker.stats.traits ?? []));
  // A prone creature stands first, then walks into reach.
  const { enemy, stood } = standUpIfProne(encounter.id, attacker);
  const spatial = approachTarget(campaign, encounter.id, enemy, target.id, leadProfile(profiles));
  if (spatial.blocked) {
    return spatial.blocked;
  }
  const live = getActiveEncounter(campaign.id) ?? encounter;
  if (input.single || input.bonus) {
    markEnemyActed(live, enemy.id);
  } else {
    spendEnemyAction(live, enemy.id);
  }
  saveEncounter(live);
  const attackerPos = tokenPosition(campaign.id, enemy.id);
  const targetPos = tokenPosition(campaign.id, target.id);
  if (attackerPos && targetPos) {
    recordEncounterTarget(encounter.id, encounter.round, enemy.id, target.id);
  }
  const notes: string[] = stood ? [`${enemy.displayName} stands up (half its speed)`] : [];
  const swings: Array<Record<string, unknown>> = [];
  let totalDamage = 0;
  let last: Record<string, unknown> = {};
  for (const [index, plannedAttack] of planned.entries()) {
    const now = getEnemy(target.id);
    if (!now || now.status !== "alive" || last.dead || last.down) {
      break;
    }
    const mode = swingMode(profiles[index], spatial.distance);
    if (!mode) {
      swings.push({ attack: plannedAttack.name, skipped: `${now.displayName} is out of this attack's reach` });
      continue;
    }
    const attack: EnemyAttack = alternativeBlow(plannedAttack, { ranged: mode.ranged, bloodied: enemy.currentHp <= enemy.maxHp / 2 });
    const context = attackContext({
      attackerConditions: enemy.conditions,
      targetConditions: now.conditions,
      melee: !mode.ranged,
      adjacent: spatial.distance === null || spatial.distance <= 1,
      requested: input.advantage ?? "none",
      attackerType: enemy.stats.type,
    });
    const advantage = mergeAdvantage(context.sources);
    notes.push(...context.notes.filter((note) => !notes.includes(note)));
    const vsAc = enemyAcWithEffects(campaign.id, now);
    const toHit = rollExpression(d20Expression(attack.toHit, advantage));
    const hitRoll = insertRoll({
      campaignId: campaign.id,
      characterId: null,
      requestedBy: "dm",
      kind: "attack",
      detail: rollAgainst(attack.name, now.displayName),
      advantage,
      result: toHit,
      attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName },
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll: hitRoll, source: "digital" });
    turn.rollIds.push(hitRoll.id);
    const natCrit = toHit.crit === "nat20";
    const hit = toHit.crit !== "nat1" && (natCrit || toHit.total >= vsAc);
    const crit = natCrit || (hit && context.autoCrit);
    if (attackerPos && targetPos && !attackerPos.hidden) {
      publishFx(campaign.id, planAttackFx({ from: attackerPos.at, to: targetPos.at, fromTokenId: attackerPos.tokenId, toTokenId: targetPos.tokenId, hit, crit, ranged: mode.ranged, damageType: attack.type, visibility: hitRoll.visibility }));
    }
    if (!hit) {
      swings.push({ attack: attack.name, rolled: toHit.total, hit: false, ...(toHit.crit === "nat1" ? { fumble: true } : {}) });
      continue;
    }
    const expression = crit
      ? critDamageExpression(attack.damage, 0, {
          powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
          multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
        })
      : attack.damage;
    const damage = rollExpression(expression);
    const damageRoll = insertRoll({
      campaignId: campaign.id,
      characterId: null,
      requestedBy: "dm",
      kind: "damage",
      detail: rollAgainst(attack.name, now.displayName),
      result: damage,
      attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName },
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll: damageRoll, source: "digital" });
    turn.rollIds.push(damageRoll.id);
    const blow = blowByType(attack, damage, crit);
    const dealt = Math.max(0, blow.amount);
    // Stamped on the roll as it lands, so the after-fight card counts it.
    last = dealt > 0
      ? landRoll(damageRoll.id, now.id, () =>
          applyEnemyDamage(campaign, turn, live, now, dealt, input.sheets, input.sheetsById, blow.type, {
            crit,
            magical: hasTrait(enemy.stats, "magicWeapons") || attack.spellAttack === true || attack.magical === true,
          }),
        )
      : {};
    totalDamage += dealt;
    swings.push({ attack: attack.name, rolled: toHit.total, hit: true, ...(crit ? { crit: true } : {}), damage: dealt, ...last });
  }
  const names = [...new Set(planned.map((attack) => attack.name))];
  return {
    ok: true,
    attack: names.join(", "),
    target: target.displayName,
    vsAc: enemyAcWithEffects(campaign.id, getEnemy(target.id) ?? target),
    swings,
    hit: swings.some((swing) => swing.hit),
    ...(totalDamage > 0 ? { totalDamage } : {}),
    ...(spatial.opportunityAttacks?.length ? { opportunityAttacks: spatial.opportunityAttacks } : {}),
    ...(notes.length ? { conditionEffects: notes } : {}),
    ...(last.dead ? { dead: true, note: `${target.displayName} is slain. You may now narrate its death.` } : {}),
    ...(last.down && !last.dead ? { down: true, note: String(last.note ?? `${target.displayName} falls.`) } : {}),
    ...(last.encounterOver ? { encounterOver: true, outcome: last.outcome } : {}),
  };
}
