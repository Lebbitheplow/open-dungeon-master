// A character's long jump on the board, called by the battle-map move route
// when the move asks for one (src/lib/srd/jump.ts has the rule): Strength
// and the run-up decide the distance, each foot costs a foot of movement,
// the squares under the jump are not walked, and a landing in difficult
// terrain takes a DC 10 Acrobatics check or the jumper lands prone. Leaving
// a reach by jumping still draws the opportunity attack.

import type { Campaign } from "@/lib/db/campaigns";
import { getTokenByRef, listTokens, moveToken, type BattleMap } from "@/lib/db/battle-maps";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import type { Encounter } from "@/lib/db/encounters";
import { listEnemies } from "@/lib/db/encounters";
import { publishPersisted } from "@/lib/events";
import { computeAbilityScore } from "@/lib/dm/roll-riders";
import { footprintLookup, occupiedTiles } from "@/lib/battlemap/view";
import type { BattleToken, XY } from "@/lib/battlemap/types";
import { highJumpFeet, planLongJump, RUN_UP_TILES } from "@/lib/srd/jump";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { releaseGrapplesOutOfReach } from "@/lib/dm/grapple";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { resolveOpportunityAttacks, type OpportunityOutcome } from "@/lib/dm/opportunity";
import { zonesAfterMove } from "@/lib/dm/zone-triggers";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionJumpMultiplier } from "@/lib/srd/condition-effect-queries";
import { holdsFeature } from "@/lib/srd/feature-names";
import { WIND_STEP } from "@/lib/dm/action-budget";
import { budgetFor } from "@/lib/dm/turn-budget";

export type JumpOutcome =
  | { error: string; status: number }
  // `lasting`: the leap rolled a check or let a grapple go, so it cannot be
  // taken back (src/lib/battlemap/move-undo.ts).
  | { ok: true; jump: { feet: number; highJumpFeet: number; landed: string }; opportunity: OpportunityOutcome; zoneEffects: string[]; lasting: boolean };

// Step of the Wind's doubling, while its mark is on the jumper's turn
// (bonus-actions.ts spendKiTechnique, action-tools.ts take_action's bonus
// route). SRD 5.1 monk, Step of the Wind: "your jump distance is doubled
// for the turn."
function windStepJump(encounter: Encounter, sheetId: string): number {
  return budgetFor(encounter, sheetId, 1)?.oncePerTurn.includes(WIND_STEP) ? 2 : 1;
}

// The feet class features add to a running jump, long and high:
//   - SRD 5.1 fighter, Champion, Remarkable Athlete: "when you make a running
//     long jump, the distance you can cover increases by a number of feet
//     equal to your Strength modifier."
//   - SRD 5.1 rogue, Thief, Second-Story Work: "when you make a running jump,
//     the distance you cover increases by a number of feet equal to your
//     Dexterity modifier" (a running high jump too).
// A negative modifier shortens nothing: "increases by".
export function runningJumpFeet(sheet: CharacterSheet, runningStart: boolean): { long: number; high: number } {
  if (!runningStart) {
    return { long: 0, high: 0 };
  }
  const mod = (ability: "str" | "dex") => Math.max(0, Math.floor((computeAbilityScore(sheet, ability) - 10) / 2));
  const athlete = holdsFeature(sheet, "Remarkable Athlete") ? mod("str") : 0;
  const climber = holdsFeature(sheet, "Second-Story Work") ? mod("dex") : 0;
  return { long: athlete + climber, high: climber };
}

export function jumpMove(input: {
  campaign: Campaign;
  encounter: Encounter;
  map: BattleMap;
  sheet: CharacterSheet;
  token: BattleToken;
  to: XY;
  budgetTiles: number;
  scene: boolean;
  disengaged: boolean;
}): JumpOutcome {
  const { campaign, encounter, map, sheet, token, to, scene } = input;
  if (sheet.conditions.some((entry) => entry.trim().toLowerCase() === "prone")) {
    return { error: `${sheet.name} is prone and cannot jump from the ground; they stand up first (half their speed).`, status: 409 };
  }
  const enemiesById = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const occupied = occupiedTiles(map, listTokens(map.id), token, footprintLookup(enemiesById));
  const strength = computeAbilityScore(sheet, "str");
  // The Jump spell triples the distance (condition-effects-last.ts), and
  // Step of the Wind doubles it for the turn.
  const leap = conditionJumpMultiplier(sheet.conditions) * (scene ? 1 : windStepJump(encounter, sheet.id));
  // A 10-foot run on foot this turn is the running start; out of a fight
  // there is all the room in the world to take one.
  const runningStart = scene || token.movedThisRound >= RUN_UP_TILES;
  const extra = runningJumpFeet(sheet, runningStart);
  const plan = planLongJump({
    terrain: map.terrain,
    width: map.width,
    height: map.height,
    occupied,
    from: token,
    to,
    // A running long jump covers the Strength score in feet, so the class
    // features' extra feet ride on it.
    strength: (strength + extra.long) * leap,
    runningStart,
    budgetTiles: input.budgetTiles,
    name: sheet.name,
  });
  if (!plan.ok) {
    return { error: plan.error, status: 400 };
  }
  const from = { x: token.x, y: token.y };
  moveToken(token.id, to.x, to.y, scene ? 0 : token.movedThisRound + plan.cost);
  const letGo = releaseGrapplesOutOfReach(campaign);
  let landed = "on their feet";
  if (plan.landsInDifficult) {
    const check = rollCharacterCheck(campaign, sheet, { skill: "acrobatics" }, `${sheet.name}: Acrobatics to land the jump (DC 10)`);
    if (check.autoFailed || check.total < 10) {
      const fresh = getSheetById(sheet.id) ?? sheet;
      const updated = patchSheet(sheet.id, { conditions: [...fresh.conditions, "prone"] });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
      landed = `prone (Acrobatics ${check.total} against DC 10 in difficult terrain)`;
    } else {
      landed = `on their feet (Acrobatics ${check.total} against DC 10)`;
    }
  }
  publishBattleMapUpdate(campaign.id);
  const opportunity = scene
    ? { notes: [], downed: false }
    : resolveOpportunityAttacks(campaign, sheet.id, from, to, input.disengaged, plan.path);
  const zoneEffects = scene || opportunity.downedAt ? [] : zonesAfterMove(campaign, encounter.id, { kind: "pc", refId: sheet.id }, from, [to]);
  if (opportunity.downedAt) {
    const moved = getTokenByRef(map.id, sheet.id);
    moveToken(token.id, opportunity.downedAt.x, opportunity.downedAt.y, moved?.movedThisRound ?? token.movedThisRound);
    publishBattleMapUpdate(campaign.id);
  }
  return {
    ok: true,
    jump: { feet: plan.feet, highJumpFeet: (highJumpFeet(strength, runningStart) + extra.high) * leap, landed },
    opportunity,
    zoneEffects,
    lasting: plan.landsInDifficult || letGo.length > 0,
  };
}
