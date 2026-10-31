// A controlled mount in a fight: its own action, and attacks aimed at it.
//
// A mount was only a speed written on its rider (db/mounts.ts), so it could
// neither Disengage nor Dodge, and nothing could be aimed at it. The SRD
// gives a controlled mount "only three action options: Dash, Disengage, and
// Dodge", and lets the attacker of a mounted rider "target you or the
// mount" (SRD 5.1, Controlling a Mount). The mount stays on its rider's
// record, now with its stat block's Armor Class and hit points: its action
// is a mark on the rider's turn, its Dodge a mark on the rider until their
// next turn, and an enemy_attack with targetMount strikes it.

import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getMounts, setMount } from "@/lib/db/mounts";
import { insertRoll } from "@/lib/db/rolls";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { speedToTiles } from "@/lib/battlemap/movement";
import { rollAgainst } from "@/lib/roll-labels";
import type { EnemyAttack } from "@/lib/bestiary/statblock";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { claimOncePerTurn, dashCount } from "@/lib/dm/action-budget";
import { addSheetCondition } from "@/lib/dm/action-common";
import { attackSight, enemySenses, fearAsRolled, lightOnAttack } from "@/lib/dm/attack-light";
import { attackContext, DODGING, mergeAdvantage, type AdvantageState } from "@/lib/dm/condition-logic";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { handleDismount } from "@/lib/dm/mount-tools";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { MOUNT_ACTIONS, MOUNT_DODGING, mountActionKey, mountActionTaken, mountDashRidden, type MountAction, type MountState } from "@/lib/srd/mounts";
import type { ToolResult } from "@/lib/dm/tool-errors";

// take_action with mount: the controlled mount's own action, on its rider's
// turn, beside the rider's action and spending none of it.
export function handleMountAction(campaign: Campaign, sheet: CharacterSheet, action: string): ToolResult {
  const mount = getMounts(campaign.id)[sheet.id];
  if (!mount) {
    return { error: `${sheet.name} is not riding a mount; the action is theirs to take without mount.`, retry: true };
  }
  if (!mount.controlled) {
    return { error: `${mount.name} is not a controlled mount: it acts on its own initiative, as the GM runs it.`, refused: "rules" };
  }
  const chosen = MOUNT_ACTIONS.find((entry) => entry === action);
  if (!chosen) {
    return { error: `A controlled mount can take only the Dash, Disengage and Dodge actions (SRD 5.1, Controlling a Mount); ${action} is ${sheet.name}'s own to take.`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
  if (!encounter || !budget) {
    return { error: `${mount.name} acts on ${sheet.name}'s turn in a fight, sharing their initiative.`, refused: "rules" };
  }
  const taken = mountActionTaken(budget.oncePerTurn);
  if (taken) {
    return { error: `${mount.name} already took the ${taken} action this turn; it has one.`, refused: "limit" };
  }
  // The ride past the mount's one move (and the rider's own Dashes) was its
  // Dash: it cannot take another action instead.
  const map = getBattleMapForEncounter(encounter.id);
  const token = map ? getTokenByRef(map.id, sheet.id) : null;
  if (chosen !== "dash" && token && mountDashRidden(token.movedThisRound, speedToTiles(mount.speed), dashCount(budget))) {
    return { error: `${mount.name} has already ridden its Dash this turn; it has one action.`, refused: "limit" };
  }
  const claimed = claimOncePerTurn(budget, mountActionKey(chosen)) ?? budget;
  // Disengage: the ride draws no opportunity attacks for the rest of the turn.
  storeBudget(encounter, chosen === "disengage" ? { ...claimed, disengaged: true } : claimed);
  if (chosen === "dodge") {
    addSheetCondition(campaign, sheet, MOUNT_DODGING, { untilTurnOf: sheet.id }, mount.name);
  }
  return { ok: true, mount: mount.name, action: chosen, applied: mountActionLine(mount, chosen) };
}

function mountActionLine(mount: MountState, action: MountAction): string {
  if (action === "dash") {
    return `${mount.name} dashes: the ride may go its speed again this turn.`;
  }
  if (action === "disengage") {
    return `${mount.name} disengages: the ride draws no opportunity attacks for the rest of the turn, and it has no Dash this turn.`;
  }
  return `${mount.name} dodges: attacks aimed at it roll at disadvantage until the rider's next turn, and it has no Dash this turn.`;
}

// Why an attack cannot be aimed at a rider's mount, or null when it can.
export function mountTargetProblem(campaignId: string, rider: CharacterSheet): string | null {
  const mount = getMounts(campaignId)[rider.id];
  if (!mount) {
    return `${rider.name} is not riding a mount.`;
  }
  if (mount.ac === undefined || mount.hp === undefined) {
    return `${mount.name} has no Armor Class or hit points on record (a mount written by hand); attack ${rider.name} instead.`;
  }
  return null;
}

// The swings of an enemy's attack aimed at the rider's mount: its own AC
// (with the cover its rider has, the square being one), its hit points, and
// its Dodge, which counts against an attacker it can see. A mount brought to
// 0 goes down, and the rider jumps clear with their reaction or falls prone
// (mount-tools.ts, cause mount-prone).
export function strikeMount(input: {
  campaign: Campaign;
  turn: DmTurn;
  encounterId: string;
  enemy: EncounterEnemy;
  rider: CharacterSheet;
  swings: Array<{ attack: EnemyAttack; ranged: boolean } | { attack: EnemyAttack; skipped: string }>;
  distance: number | null;
  cover: number;
  requested: AdvantageState;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
}): ToolResult {
  const { campaign, turn, enemy, rider } = input;
  const mount = getMounts(campaign.id)[rider.id];
  if (!mount || mount.ac === undefined || mount.hp === undefined) {
    return { error: mountTargetProblem(campaign.id, rider) ?? "No mount to strike.", retry: true };
  }
  let hp = mount.hp;
  const dodging = rider.conditions.some((entry) => isConditionNamed(entry, MOUNT_DODGING));
  // The mount stands where its rider does: the same light and the same line.
  const sight = attackSight({
    campaignId: campaign.id,
    encounterId: input.encounterId,
    attacker: { refId: enemy.id, senses: enemySenses(enemy) },
    target: { refId: rider.id, senses: { darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0, devilsSight: 0 } },
  });
  const light = lightOnAttack(sight, { attacker: enemy.displayName, target: mount.name });
  const rows: Array<Record<string, unknown>> = [];
  for (const swing of input.swings) {
    if (hp <= 0) {
      break;
    }
    if ("skipped" in swing) {
      rows.push({ attack: swing.attack.name, skipped: swing.skipped });
      continue;
    }
    const { attack, ranged } = swing;
    const context = attackContext({
      attackerConditions: fearAsRolled(input.encounterId, enemy.id, enemy.conditions, enemy.conditionMeta),
      targetConditions: dodging ? [DODGING] : [],
      melee: !ranged,
      adjacent: input.distance === null ? !ranged : input.distance <= 1,
      requested: input.requested,
      attackerType: enemy.stats.type,
      targetSeesAttacker: sight?.targetSees !== false,
    });
    const advantage = mergeAdvantage([...context.sources, ...light.sources]);
    const toHit = rollExpression(d20Expression(attack.toHit, advantage));
    const hitRoll = insertRoll({
      campaignId: campaign.id,
      characterId: rider.id,
      requestedBy: "dm",
      kind: "attack",
      detail: rollAgainst(attack.name, mount.name),
      advantage,
      result: toHit,
      attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName },
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll: hitRoll, source: "digital" });
    turn.rollIds.push(hitRoll.id);
    const ac = mount.ac + input.cover;
    const hit = toHit.crit !== "nat1" && (toHit.crit === "nat20" || toHit.total >= ac);
    if (!hit) {
      rows.push({ attack: attack.name, rolled: toHit.total, vsAc: ac, hit: false });
      continue;
    }
    const crit = toHit.crit === "nat20" || context.autoCrit;
    const variants = campaign.gameSettings.variantRules;
    const damage = rollExpression(
      crit ? critDamageExpression(attack.damage, 0, { powerfulCritical: variants.powerfulCritical, multiplyNumeric: variants.criticalDamageMods }) : attack.damage,
    );
    const damageRoll = insertRoll({
      campaignId: campaign.id,
      characterId: rider.id,
      requestedBy: "dm",
      kind: "damage",
      detail: rollAgainst(attack.name, mount.name),
      result: damage,
      attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName },
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll: damageRoll, source: "digital" });
    turn.rollIds.push(damageRoll.id);
    hp = Math.max(0, hp - damage.total);
    rows.push({ attack: attack.name, rolled: toHit.total, vsAc: ac, hit: true, ...(crit ? { crit: true } : {}), damage: damage.total });
  }
  const notes = [...light.notes, ...(dodging ? [`${mount.name} is dodging: disadvantage`] : [])];
  if (hp > 0) {
    setMount(campaign.id, rider.id, { ...mount, hp });
    publishPersisted(campaign.id, "mounts_updated", { mounts: getMounts(campaign.id) });
    return { ok: true, attack: rows[0]?.attack, target: mount.name, rider: rider.name, swings: rows, mountHp: `${hp}/${mount.maxHp ?? mount.hp}`, ...(notes.length ? { notes } : {}) };
  }
  // Down at 0: the rider comes off as from a mount knocked prone.
  setMount(campaign.id, rider.id, { ...mount, hp: 0 });
  const fall = handleDismount(campaign, JSON.stringify({ characterId: rider.id, cause: "mount-prone" }), input.sheets, input.sheetsById, turn);
  return { ok: true, attack: rows[0]?.attack, target: mount.name, rider: rider.name, swings: rows, mountDown: `${mount.name} drops to 0 hit points.`, fall, ...(notes.length ? { notes } : {}) };
}
