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

export type JumpOutcome =
  | { error: string; status: number }
  | { ok: true; jump: { feet: number; highJumpFeet: number; landed: string }; opportunity: OpportunityOutcome; zoneEffects: string[] };

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
  // The Jump spell triples the distance (condition-effects-last.ts).
  const leap = conditionJumpMultiplier(sheet.conditions);
  // A 10-foot run on foot this turn is the running start; out of a fight
  // there is all the room in the world to take one.
  const runningStart = scene || token.movedThisRound >= RUN_UP_TILES;
  const plan = planLongJump({
    terrain: map.terrain,
    width: map.width,
    height: map.height,
    occupied,
    from: token,
    to,
    strength: strength * leap,
    runningStart,
    budgetTiles: input.budgetTiles,
    name: sheet.name,
  });
  if (!plan.ok) {
    return { error: plan.error, status: 400 };
  }
  const from = { x: token.x, y: token.y };
  moveToken(token.id, to.x, to.y, scene ? 0 : token.movedThisRound + plan.cost);
  releaseGrapplesOutOfReach(campaign);
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
    jump: { feet: plan.feet, highJumpFeet: highJumpFeet(strength, runningStart) * leap, landed },
    opportunity,
    zoneEffects,
  };
}
