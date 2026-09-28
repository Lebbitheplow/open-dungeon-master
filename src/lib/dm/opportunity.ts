import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import {
  getActiveEncounter,
  listEnemies,
  patchEnemyHp,
  saveEncounter,
} from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { chebyshev } from "@/lib/battlemap/types";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import {
  adjudicateHit,
  ragingMeleeBonus,
  resolveAttackWeapon,
  weaponAttackProfile,
  weaponOf,
} from "@/lib/dm/attack-logic";
import { RAGING } from "@/lib/srd/class-resources";
import { computeSheetDerived } from "@/lib/srd";
import { matchWeapon } from "@/lib/srd/weapons";
import { combatRiders } from "@/lib/srd/feature-effects";
import { conditionBlocksReactions } from "@/lib/srd/condition-effects";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { healthState } from "@/lib/bestiary/health";

import { applyDamageMath } from "@/lib/dm/mutation-math";
import { applyDamageDeathHook } from "@/lib/dm/death";
import {
  DODGING,
  attackContext,
  damageAdjust,
  effectiveSpeed,
  exhaustionRollState,
  mergeAdvantage,
  pcResistances,
  type ConditionMetaMap,
} from "@/lib/dm/condition-logic";
import { acWithEffects, enemyAcWithEffects } from "@/lib/dm/ac-effects";
import { canAct, canEnemyAct } from "@/lib/dm/can-act";
import { conditionsOf } from "@/lib/dm/vitals-logic";

// Opportunity attacks: walking out of an enemy's reach is not free. Before
// this, a player could stroll away from a troll with no consequence at all,
// which is the single most-noticed missing rule in 5e combat.
//
// Resolved here rather than through handleEnemyAttack because the trigger
// fires from the player's own token-move route, which has no DM turn to
// hang tool calls on. The outcome posts as a table note, exactly like the
// death saves the server rolls between turns.
//
// The move is walked square by square: what provokes is LEAVING a reach,
// wherever the move began and ended, so a runner who passes a guard in a
// corridor is struck as they go by.

type XY = { x: number; y: number };

function tableNote(campaign: Campaign, content: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    content,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

export type OpportunityOutcome = {
  notes: string[];
  downed: boolean;
  // Where the mover fell, when an attack on the way brought them to 0: the
  // last square they stood on inside the reach they were leaving.
  downedAt?: XY;
};

// Reach is 1 tile for almost everything; the stat block's own reach wording
// ("10 ft.") widens it.
function enemyReachTiles(speedOrAttack: string): number {
  return /reach 1[05] ft/i.test(speedOrAttack) ? 2 : 1;
}

// The square a walker stood on when they left this reach, or null when the
// walk never leaves it. `steps` is every square of the walk in order, the
// starting one first.
export function leavesReachAt(steps: XY[], reactor: XY, reach: number): XY | null {
  for (let index = 0; index + 1 < steps.length; index += 1) {
    const here = steps[index];
    const next = steps[index + 1];
    if (
      chebyshev(reactor.x, reactor.y, here.x, here.y) <= reach &&
      chebyshev(reactor.x, reactor.y, next.x, next.y) > reach
    ) {
      return here;
    }
  }
  return null;
}

const lowered = (conditions: string[]) => conditions.map((entry) => entry.toLowerCase());
const cannotSee = (conditions: string[]) => lowered(conditions).includes("blinded");
const cannotBeSeen = (conditions: string[]) =>
  lowered(conditions).some((entry) => entry === "invisible" || entry === "hidden");

// Dodge is lost with the dodger's speed (SRD 5.1, Dodge): a grappled or
// restrained dodger puts nobody at disadvantage.
export function withLiveDodge(conditions: string[]): string[] {
  if (effectiveSpeed(conditions, 30) > 0) {
    return conditions;
  }
  return conditions.filter((entry) => entry.toLowerCase() !== DODGING);
}

// Resolves the opportunity attacks a character's move provokes, applying
// damage and posting table notes. `disengaged` suppresses all of them.
// `path` is the walk, square by square after the starting one; without it
// the move is read as one step from `from` to `to`.
export function resolveOpportunityAttacks(
  campaign: Campaign,
  characterId: string,
  from: XY,
  to: XY,
  disengaged: boolean,
  path?: XY[],
): OpportunityOutcome {
  const empty: OpportunityOutcome = { notes: [], downed: false };
  if (disengaged) {
    return empty;
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return empty;
  }
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return empty;
  }
  const steps = [from, ...(path?.length ? path : [to])];
  const notes: string[] = [];
  let downed = false;
  let downedAt: XY | undefined;

  for (const enemy of listEnemies(encounter.id)) {
    // The reacting side must be able to react, and to see who is leaving.
    if (!canEnemyAct({ enemy, encounter, kind: "reaction" }).ok || cannotSee(enemy.conditions)) {
      continue;
    }
    if (encounter.reactionsUsed.includes(enemy.id)) {
      continue;
    }
    const token = getTokenByRef(map.id, enemy.id);
    if (!token) {
      continue;
    }
    const attack = enemy.stats.attacks[0];
    if (!attack) {
      continue;
    }
    const reach = enemyReachTiles(`${attack.name} ${enemy.stats.traits.join(" ")}`);
    const leftFrom = leavesReachAt(steps, token, reach);
    if (!leftFrom) {
      continue;
    }

    const sheet = getSheetById(characterId);
    if (!sheet || sheet.currentHp <= 0) {
      break;
    }
    if (cannotBeSeen(sheet.conditions)) {
      continue;
    }
    // The reaction is spent whether or not the swing lands.
    encounter.reactionsUsed = [...encounter.reactionsUsed, enemy.id];
    saveEncounter(encounter);

    // An attack roll like any other: both sides' conditions decide it.
    const context = attackContext({
      attackerConditions: enemy.conditions,
      targetConditions: withLiveDodge(conditionsOf(sheet)),
      melee: true,
      adjacent: reach <= 1,
      requested: "none",
    });
    const targetAc = acWithEffects(campaign.id, sheet);
    const hitOutcome = rollExpression(d20Expression(attack.toHit, context.advantage));
    const hitRoll = insertRoll({
      campaignId: campaign.id,
      characterId: null,
      requestedBy: "dm",
      kind: "attack",
      detail: `${enemy.displayName}: opportunity attack on ${sheet.name}`,
      advantage: context.advantage,
      result: hitOutcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: hitRoll,
      source: "digital",
    });
    const adjudicated = adjudicateHit(hitOutcome.total, hitOutcome.crit, targetAc);
    if (!adjudicated.hit) {
      notes.push(
        `${enemy.displayName} takes an opportunity attack as ${sheet.name} pulls away and misses (${hitOutcome.total} vs AC ${targetAc}).`,
      );
      continue;
    }
    const crit = adjudicated.crit || context.autoCrit;

    const damageOutcome = rollExpression(
      crit
        ? critDamageExpression(attack.damage, 0, {
            powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
            multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
          })
        : attack.damage,
    );
    const damageRoll = insertRoll({
      campaignId: campaign.id,
      characterId: null,
      requestedBy: "dm",
      kind: "damage",
      detail: `${enemy.displayName}: opportunity attack damage`,
      result: damageOutcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: damageRoll,
      source: "digital",
    });

    // The character's own resistances apply exactly as they would to any
    // other hit (rage, dwarven poison resistance, tiefling fire).
    const rolled = Math.max(0, damageOutcome.total);
    const adjusted =
      rolled > 0
        ? damageAdjust(rolled, attack.type, pcResistances(sheet), "", "")
        : { amount: 0, note: null };
    const math = applyDamageMath(sheet.currentHp, sheet.tempHp, adjusted.amount);
    const patch = { currentHp: math.currentHp, tempHp: math.tempHp };
    patchSheet(sheet.id, patch);
    const entry = insertSheetAudit({
      campaignId: campaign.id,
      characterId: sheet.id,
      turnId: null,
      kind: "damage",
      delta: patch,
      reason: `opportunity attack from ${enemy.displayName}`,
      seq: allocateSeq(campaign.id),
      before: sheet,
      patch,
    });
    publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
    // The death engine owns what happens at 0 HP.
    applyDamageDeathHook(campaign, null, sheet, math, crit);
    const updated = getSheetById(sheet.id);
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    if (math.currentHp <= 0) {
      downed = true;
      downedAt = leftFrom;
    }
    notes.push(
      `${enemy.displayName} takes an opportunity attack as ${sheet.name} pulls away: ${
        crit ? "a critical hit for " : "hit for "
      }${adjusted.amount} damage${adjusted.note ? ` (${adjusted.note})` : ""}.`,
    );
    if (downed) {
      break;
    }
  }

  for (const note of notes) {
    tableNote(campaign, note);
  }
  return { notes, downed, ...(downedAt ? { downedAt } : {}) };
}

function stokeRage(sheet: NonNullable<ReturnType<typeof getSheetById>>) {
  const ragingAs = sheet.conditions.find((entry) => entry.trim().toLowerCase() === RAGING);
  if (!ragingAs) {
    return;
  }
  const meta = sheet.conditionMeta as ConditionMetaMap;
  patchSheet(sheet.id, {
    conditionMeta: { ...meta, [ragingAs]: { ...meta[ragingAs], stoked: true } },
  });
}

// The melee weapon a character strikes with when something walks away from
// them: the best one they carry. A character carrying only a bow has no
// opportunity attack to make.
function meleeWeaponFor(sheet: NonNullable<ReturnType<typeof getSheetById>>) {
  const melee = sheet.equipment.filter((item) => {
    const weapon = weaponOf(item) ?? matchWeapon(item.name);
    return weapon !== null && weapon.kind === "melee";
  });
  const carriesWeapon = sheet.equipment.some(
    (item) => (weaponOf(item) ?? matchWeapon(item.name)) !== null,
  );
  if (!melee.length && carriesWeapon) {
    return null;
  }
  return resolveAttackWeapon(melee, sheet.proficiencies.weapons, undefined);
}

// The other side of the same rule: an enemy that walks out of a character's
// reach eats a melee attack from them. Fires wherever an enemy walks (the
// DM's move_token and the approach enemy_attack makes), and spends the
// character's reaction out of the same list the enemy side uses.
export function resolvePcOpportunityAttacks(
  campaign: Campaign,
  enemyId: string,
  from: XY,
  to: XY,
  path?: XY[],
): string[] {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return [];
  }
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return [];
  }
  const steps = [from, ...(path?.length ? path : [to])];
  const notes: string[] = [];

  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    if (
      !canAct({ sheet, encounter, kind: "reaction" }).ok ||
      conditionBlocksReactions(sheet.conditions) ||
      cannotSee(sheet.conditions)
    ) {
      continue;
    }
    if (encounter.reactionsUsed.includes(sheet.id)) {
      continue;
    }
    const token = getTokenByRef(map.id, sheet.id);
    if (!token) {
      continue;
    }
    const resolved = meleeWeaponFor(sheet);
    if (!resolved) {
      continue;
    }
    const derived = computeSheetDerived(sheet);
    const riders = combatRiders(sheet);
    const profile = weaponAttackProfile(derived, sheet.proficiencies.weapons, resolved, { riders });
    if (profile.ranged) {
      continue;
    }
    if (!leavesReachAt(steps, token, profile.reachTiles)) {
      continue;
    }

    const enemy = listEnemies(encounter.id).find((entry) => entry.id === enemyId);
    if (!enemy || enemy.status !== "alive") {
      break;
    }
    if (cannotBeSeen(enemy.conditions)) {
      continue;
    }
    encounter.reactionsUsed = [...encounter.reactionsUsed, sheet.id];
    saveEncounter(encounter);
    // SRD 5.1, Rage: an attack on a hostile creature since the barbarian's
    // last turn keeps the rage going, and this swing is one, hit or miss.
    // The turn budget only knows the barbarian's own turn, so the rage is
    // marked the way an off-turn pc_attack marks it (condition-tick.ts
    // endTurnRage reads the mark).
    stokeRage(sheet);

    const context = attackContext({
      attackerConditions: sheet.conditions,
      targetConditions: withLiveDodge(enemy.conditions),
      melee: true,
      adjacent: profile.reachTiles <= 1,
      requested: "none",
    });
    const advantage = mergeAdvantage([
      context.advantage,
      exhaustionRollState(sheet.exhaustion ?? 0, "attack").advantage,
    ]);
    const targetAc = enemyAcWithEffects(campaign.id, enemy);
    const hitOutcome = rollExpression(d20Expression(profile.toHit, advantage));
    const hitRoll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "attack",
      detail: `${sheet.name}: opportunity attack on ${enemy.displayName}`,
      advantage,
      result: hitOutcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: hitRoll,
      source: "digital",
    });
    const adjudicated = adjudicateHit(hitOutcome.total, hitOutcome.crit, targetAc, {
      natural: hitOutcome.natural,
      critRange: riders.critRange,
    });
    if (!adjudicated.hit) {
      notes.push(
        `${sheet.name} swings at ${enemy.displayName} as it breaks away and misses (${hitOutcome.total} vs AC ${targetAc}).`,
      );
      continue;
    }
    const crit = adjudicated.crit || context.autoCrit;

    // Rage's bonus rides a Strength melee swing, this one as any other.
    const rageBonus = ragingMeleeBonus(sheet, profile);
    const damageExpression = rageBonus ? `${profile.damageExpression}+${rageBonus}` : profile.damageExpression;
    const damageOutcome = rollExpression(
      crit
        ? critDamageExpression(damageExpression, riders.critExtraDice, {
            powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
            multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
          })
        : damageExpression,
    );
    const damageRoll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "damage",
      detail: `${sheet.name}: opportunity attack damage`,
      result: damageOutcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: damageRoll,
      source: "digital",
    });

    // Applied directly rather than through applyEnemyDamage: that path owns
    // ending the encounter and awarding XP, which needs a DM turn this
    // trigger does not have. A killing blow here is reported and the model
    // ends the fight on its next turn.
    const rolled = Math.max(0, damageOutcome.total);
    const adjusted =
      rolled > 0
        ? damageAdjust(
            rolled,
            profile.damageType,
            enemy.stats.resist,
            enemy.stats.immune,
            enemy.stats.vulnerable,
          )
        : { amount: 0, note: null };
    const nextHp = Math.max(0, enemy.currentHp - adjusted.amount);
    const dropped = enemy.currentHp > 0 && nextHp === 0;
    patchEnemyHp(enemy.id, nextHp, dropped ? "dead" : "alive");
    publishPersisted(campaign.id, "encounter_updated", { encounterId: encounter.id });
    notes.push(
      `${sheet.name} catches ${enemy.displayName} with an opportunity attack as it breaks away: ${
        crit ? "a critical hit, " : ""
      }${adjusted.amount} damage${adjusted.note ? ` (${adjusted.note})` : ""}. ${
        dropped ? `${enemy.displayName} drops.` : `It is now ${healthState(nextHp, enemy.maxHp)}.`
      }`,
    );
    if (dropped) {
      break;
    }
  }

  for (const note of notes) {
    tableNote(campaign, note);
  }
  return notes;
}
