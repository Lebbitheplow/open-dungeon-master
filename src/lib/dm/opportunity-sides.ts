// Opportunity attacks between two stat-block creatures (issue 503, Phase 6):
// a creature the party dominates walks away from the goblins it fought
// beside, and they strike it as it goes. The other directions are in
// opportunity.ts (characters and enemies, a turncoat and the party).
//
// Each reacting creature makes the opportunity attack its block makes
// (enemy-profile.ts opportunityWeapon), once, spending its reaction: an
// attack roll against the walker's Armor Class with both sides' conditions,
// and the damage through applyEnemyDamage, the fight left open for the next
// turn to end (holdVictory, as every opportunity attack leaves it).

import { allocateSeq, getCampaignById } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, listEnemies, saveEncounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { insertCampaignMessage } from "@/lib/db/messages";
import { insertRoll } from "@/lib/db/rolls";
import { listSheets } from "@/lib/db/sheets";
import { footprintForSize, type Footprint } from "@/lib/battlemap/footprint";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { rollAgainst } from "@/lib/roll-labels";
import { enemyAcWithEffects } from "@/lib/dm/ac-effects";
import { canEnemyAct } from "@/lib/dm/can-act";
import { sideOf } from "@/lib/dm/combatant";
import { attackContext, mergeAdvantage } from "@/lib/dm/condition-logic";
import { applyEnemyDamage } from "@/lib/dm/enemy-damage";
import { blowByType } from "@/lib/dm/enemy-hit";
import { opportunityWeapon } from "@/lib/dm/enemy-profile";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { leavesReachAt } from "@/lib/dm/opportunity-reach-logic";
import { withOpportunityTurn } from "@/lib/dm/opportunity-strike";
import { conditionBlocksReactions } from "@/lib/srd/condition-effects";

type XY = { x: number; y: number };

const unseen = (conditions: string[]) => conditions.some((entry) => ["invisible", "hidden"].includes(entry.toLowerCase()));
const blind = (conditions: string[]) => conditions.some((entry) => entry.toLowerCase() === "blinded");

// The enemies of the other side whose reach the walker (an enemy row) leaves
// strike it; returns the lines it posted.
export function enemiesStrikeWalker(campaignId: string, walkerId: string, steps: XY[], walkerFootprint: Footprint): string[] {
  const campaign = getCampaignById(campaignId);
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!campaign || !encounter || !map) {
    return [];
  }
  const walkerSide = sideOf(encounter, "enemy", walkerId);
  const notes: string[] = [];
  for (const reactor of listEnemies(encounter.id)) {
    const walker = getEnemy(walkerId);
    if (!walker || walker.status !== "alive") {
      break;
    }
    if (reactor.id === walkerId || sideOf(encounter, "enemy", reactor.id, reactor) === walkerSide) {
      continue;
    }
    if (!canEnemyAct({ enemy: reactor, encounter, kind: "reaction" }).ok || conditionBlocksReactions(reactor.conditions) || blind(reactor.conditions) || unseen(walker.conditions)) {
      continue;
    }
    if (encounter.reactionsUsed.includes(reactor.id)) {
      continue;
    }
    const token = getTokenByRef(map.id, reactor.id);
    const weapon = opportunityWeapon(reactor.stats);
    if (!token || !weapon || !leavesReachAt(steps, token, weapon.reachTiles, footprintForSize(reactor.stats.size), walkerFootprint)) {
      continue;
    }
    encounter.reactionsUsed = [...encounter.reactionsUsed, reactor.id];
    saveEncounter(encounter);
    const { attack } = weapon;
    const context = attackContext({
      attackerConditions: reactor.conditions,
      targetConditions: walker.conditions,
      melee: true,
      adjacent: weapon.reachTiles <= 1,
      requested: "none",
    });
    const advantage = mergeAdvantage(context.sources);
    const vsAc = enemyAcWithEffects(campaign.id, walker);
    const toHit = rollExpression(d20Expression(attack.toHit, advantage));
    const label = rollAgainst(`${attack.name} (opportunity attack)`, walker.displayName);
    const hitRoll = insertRoll({ campaignId, characterId: null, requestedBy: "dm", kind: "attack", detail: label, advantage, result: toHit, attacker: { kind: "enemy", id: reactor.id, name: reactor.displayName } });
    publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", { roll: hitRoll, source: "digital" });
    const hit = toHit.crit !== "nat1" && (toHit.crit === "nat20" || toHit.total >= vsAc);
    if (!hit) {
      notes.push(`${reactor.displayName} takes an opportunity attack as ${walker.displayName} pulls away and misses (${toHit.total} vs AC ${vsAc}).`);
      continue;
    }
    const crit = toHit.crit === "nat20" || context.autoCrit;
    const damage = rollExpression(
      crit
        ? critDamageExpression(attack.damage, 0, { powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical, multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods })
        : attack.damage,
    );
    const damageRoll = insertRoll({ campaignId, characterId: null, requestedBy: "dm", kind: "damage", detail: label, result: damage, attacker: { kind: "enemy", id: reactor.id, name: reactor.displayName } });
    publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", { roll: damageRoll, source: "digital" });
    const blow = blowByType(attack, damage, crit);
    const sheets = listSheets(campaignId);
    const landed = withOpportunityTurn(campaignId, (turn) =>
      applyEnemyDamage(campaign, turn, encounter, walker, Math.max(1, blow.amount), sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])), blow.type, { crit, holdVictory: true }),
    );
    notes.push(
      `${reactor.displayName} takes an opportunity attack as ${walker.displayName} pulls away: ${crit ? "a critical hit for " : "hit for "}${blow.amount} damage${landed.dead ? `, and ${walker.displayName} falls` : ""}.`,
    );
  }
  for (const content of notes) {
    const seq = allocateSeq(campaignId);
    const message = insertCampaignMessage({ campaignId, seq, authorType: "system", glyph: "cue-battle", content });
    publishWithSeq(campaignId, seq, "message_added", { message });
  }
  return notes;
}
