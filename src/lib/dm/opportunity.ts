import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getActiveEncounter, listEnemies, saveEncounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { chebyshev } from "@/lib/battlemap/types";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import {
  adjudicateHit,
  resolveAttackWeapon,
  weaponAttackProfile,
} from "@/lib/dm/attack-logic";
import { computeSheetDerived } from "@/lib/srd";
import { combatRiders } from "@/lib/srd/feature-effects";
import { enemyDamageMath } from "@/lib/dm/encounter-logic";
import { patchEnemyHp } from "@/lib/db/encounters";
import { healthState } from "@/lib/bestiary/health";

import { applyDamageMath } from "@/lib/dm/mutation-math";
import { applyDamageDeathHook } from "@/lib/dm/death";
import {
  DODGING,
  damageAdjust,
  isIncapacitated,
  pcResistances,
} from "@/lib/dm/condition-logic";

// Opportunity attacks: walking out of an enemy's reach is not free. Before
// this, a player could stroll away from a troll with no consequence at all,
// which is the single most-noticed missing rule in 5e combat.
//
// Resolved here rather than through handleEnemyAttack because the trigger
// fires from the player's own token-move route, which has no DM turn to
// hang tool calls on. The outcome posts as a table note, exactly like the
// death saves the server rolls between turns.

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
};

// Every living enemy that had the mover within reach before the step and
// does not after it. Reach is 1 tile for almost everything; the stat block's
// own reach wording ("10 ft.") widens it.
function enemyReachTiles(speedOrAttack: string): number {
  return /reach 1[05] ft/i.test(speedOrAttack) ? 2 : 1;
}

// Resolves the opportunity attacks a character's move provokes, applying
// damage and posting table notes. `disengaged` suppresses all of them.
export function resolveOpportunityAttacks(
  campaign: Campaign,
  characterId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  disengaged: boolean,
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
  const notes: string[] = [];
  let downed = false;

  for (const enemy of listEnemies(encounter.id)) {
    if (enemy.status !== "alive" || isIncapacitated(enemy.conditions)) {
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
    const wasInReach = chebyshev(token.x, token.y, from.x, from.y) <= reach;
    const stillInReach = chebyshev(token.x, token.y, to.x, to.y) <= reach;
    if (!wasInReach || stillInReach) {
      continue;
    }

    const sheet = getSheetById(characterId);
    if (!sheet || sheet.currentHp <= 0) {
      break;
    }
    // The reaction is spent whether or not the swing lands.
    encounter.reactionsUsed = [...encounter.reactionsUsed, enemy.id];
    saveEncounter(encounter);

    const dodging = sheet.conditions.some((entry) => entry.toLowerCase() === DODGING);
    const hitOutcome = rollExpression(
      d20Expression(attack.toHit, dodging ? "disadvantage" : "none"),
    );
    const hitRoll = insertRoll({
      campaignId: campaign.id,
      characterId: null,
      requestedBy: "dm",
      kind: "attack",
      detail: `${enemy.displayName}: opportunity attack on ${sheet.name}`,
      advantage: dodging ? "disadvantage" : "none",
      result: hitOutcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: hitRoll,
      source: "digital",
    });
    const adjudicated = adjudicateHit(hitOutcome.total, hitOutcome.crit, sheet.ac);
    if (!adjudicated.hit) {
      notes.push(
        `${enemy.displayName} takes an opportunity attack as ${sheet.name} pulls away and misses (${hitOutcome.total} vs AC ${sheet.ac}).`,
      );
      continue;
    }

    const damageOutcome = rollExpression(
      adjudicated.crit ? `${attack.damage}+${attack.damage.split("+")[0]}` : attack.damage,
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
    const adjusted = damageAdjust(
      Math.max(1, damageOutcome.total),
      attack.type,
      pcResistances(sheet),
      "",
      "",
    );
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
    applyDamageDeathHook(campaign, null, sheet, math, adjudicated.crit);
    const updated = getSheetById(sheet.id);
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    if (math.currentHp <= 0) {
      downed = true;
    }
    notes.push(
      `${enemy.displayName} takes an opportunity attack as ${sheet.name} pulls away: ${
        adjudicated.crit ? "a critical hit for " : "hit for "
      }${adjusted.amount} damage${adjusted.note ? ` (${adjusted.note})` : ""}.`,
    );
  }

  for (const note of notes) {
    tableNote(campaign, note);
  }
  return { notes, downed };
}


// The other side of the same rule: an enemy that walks out of a character's
// reach eats a melee attack from them. Fires from handleMoveToken, which is
// where every enemy step goes through, and spends the character's reaction
// out of the same per-round list the enemy side uses.
export function resolvePcOpportunityAttacks(
  campaign: Campaign,
  enemyId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
): string[] {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return [];
  }
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return [];
  }
  const notes: string[] = [];

  for (const sheet of listSheets(campaign.id)) {
    if (sheet.currentHp <= 0 || isIncapacitated(sheet.conditions)) {
      continue;
    }
    if (encounter.reactionsUsed.includes(sheet.id)) {
      continue;
    }
    const token = getTokenByRef(map.id, sheet.id);
    if (!token) {
      continue;
    }
    // Their melee weapon decides the reach; a character holding only a bow
    // has no opportunity attack to make.
    const derived = computeSheetDerived(sheet);
    const riders = combatRiders(sheet);
    const resolved = resolveAttackWeapon(sheet.equipment, sheet.proficiencies.weapons, undefined);
    const profile = weaponAttackProfile(derived, sheet.proficiencies.weapons, resolved, { riders });
    if (profile.ranged) {
      continue;
    }
    const wasInReach = chebyshev(token.x, token.y, from.x, from.y) <= profile.reachTiles;
    const stillInReach = chebyshev(token.x, token.y, to.x, to.y) <= profile.reachTiles;
    if (!wasInReach || stillInReach) {
      continue;
    }

    const enemy = listEnemies(encounter.id).find((entry) => entry.id === enemyId);
    if (!enemy || enemy.status !== "alive") {
      break;
    }
    encounter.reactionsUsed = [...encounter.reactionsUsed, sheet.id];
    saveEncounter(encounter);

    const hitOutcome = rollExpression(d20Expression(profile.toHit));
    const hitRoll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "attack",
      detail: `${sheet.name}: opportunity attack on ${enemy.displayName}`,
      result: hitOutcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: hitRoll,
      source: "digital",
    });
    const adjudicated = adjudicateHit(hitOutcome.total, hitOutcome.crit, enemy.ac, {
      natural: hitOutcome.natural,
      critRange: riders.critRange,
    });
    if (!adjudicated.hit) {
      notes.push(
        `${sheet.name} swings at ${enemy.displayName} as it breaks away and misses (${hitOutcome.total} vs AC ${enemy.ac}).`,
      );
      continue;
    }

    const damageOutcome = rollExpression(profile.damageExpression);
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
    const adjusted = damageAdjust(
      Math.max(1, damageOutcome.total),
      profile.damageType,
      enemy.stats.resist,
      enemy.stats.immune,
      enemy.stats.vulnerable,
    );
    const math = enemyDamageMath(enemy.currentHp, adjusted.amount);
    patchEnemyHp(enemy.id, math.currentHp, math.dropped ? "dead" : "alive");
    publishPersisted(campaign.id, "encounter_updated", { encounterId: encounter.id });
    notes.push(
      `${sheet.name} catches ${enemy.displayName} with an opportunity attack as it breaks away: ${adjusted.amount} damage${
        adjusted.note ? ` (${adjusted.note})` : ""
      }. ${
        math.dropped
          ? `${enemy.displayName} drops.`
          : `It is now ${healthState(math.currentHp, enemy.maxHp)}.`
      }`,
    );
  }

  for (const note of notes) {
    tableNote(campaign, note);
  }
  return notes;
}
