import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import type { BattleToken } from "@/lib/battlemap/types";
import { tokenFootprint } from "@/lib/dm/board-reach";
import { openSquaresBeside } from "@/lib/dm/companion-approach";
import { handleMoveToken } from "@/lib/dm/map-tools";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";

// A Dash or a Disengage given someone to go to (take_action toward): the
// server walks the mover beside them in the same call, as far as the
// movement the action just added carries them (issue #666). The Dash only
// added speed and said the board allowed the distance; the walk needed a
// move_token the GM never made, so a companion told to "Dash to Vesper"
// committed their action and stood still. A square is move_token's: one
// more parameter on take_action cost the trimmed tool set its place in a
// 48K window.

export type ActionWalk = { mover: string; moverName: string; target: BattleToken };

export type Destination = { toward?: string };

const WALKING_ACTIONS = new Set(["dash", "disengage"]);

export function hasDestination(args: Destination): boolean {
  return Boolean(args.toward?.trim());
}

// The walk a call asks for, checked before the action is spent: null when it
// names no destination, a refusal when it names one that cannot be walked.
// Every refusal is a mistake in the call (retry), and nothing was spent.
export function planActionWalk(
  campaignId: string,
  mover: { id: string; name: string },
  action: string,
  args: Destination,
  readiedRelease: boolean,
  // Checked once the action was already paid for (an enemy's bonus route
  // the gate did not see): the refusal then says only what is wrong.
  spent = false,
): ActionWalk | ToolError | null {
  if (!hasDestination(args)) {
    return null;
  }
  const tail = spent ? "" : " Nothing was spent.";
  if (!WALKING_ACTIONS.has(action)) {
    return { error: `toward goes with a Dash or a Disengage only. Walk ${mover.name} with move_token, or drop it.${tail}`, retry: true };
  }
  if (readiedRelease) {
    return { error: `A readied ${action} is released here without a walk: release it, then walk ${mover.name} with move_token.${tail}`, retry: true };
  }
  const toward = (args.toward ?? "").trim();
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const me = map ? getTokenByRef(map.id, mover.id) : null;
  if (!encounter || !map || !me) {
    return { error: `There is no battle map with ${mover.name} on it to walk: drop toward and narrate the move.${tail}`, retry: true };
  }
  const tokens = listTokens(map.id).filter((token) => token.id !== me.id);
  const target = getTokenByRef(map.id, toward) ?? tokens.find((token) => textKey(token.name) === textKey(toward)) ?? null;
  if (!target || target.id === me.id) {
    const names = tokens.map((token) => token.name);
    return {
      error: `toward names nobody else on the board: "${toward}". ${names.length ? `Use one of: ${[...new Set(names)].join(", ")}.` : "There is nobody else on the board."}${tail}`,
      retry: true,
    };
  }
  if (!openSquaresBeside(encounter.id, map, me, target, tokenFootprint(target)).length) {
    return { error: `Every square beside ${target.name} is taken, so ${mover.name} cannot move beside them.${tail}`, refused: "rules" };
  }
  return { mover: mover.id, moverName: mover.name, target };
}

// What a walk reports back, without the fields only move_token's own
// caller reads.
function walkReport(walked: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(walked).filter(([key]) => key !== "ok" && key !== "name"));
}

// Walks the planned move, after the action that pays for it was spent:
// through move_token's own rules (speed this turn with the Dash counted, the
// Disengage that keeps opportunity attacks off, allies' spaces, fear, prone,
// the spell areas). A walk the board refuses now leaves the movement owed,
// and says so, rather than taking the action back.
export function walkActionPlan(
  campaign: Campaign,
  turn: Pick<DmTurn, "id" | "actor">,
  plan: ActionWalk,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { walked: Record<string, unknown> } | { moveOwed: string } {
  const move = (x: number, y: number) => handleMoveToken(campaign, JSON.stringify({ token: plan.mover, x, y }), sheets, sheetsById, turn);
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const me = map ? getTokenByRef(map.id, plan.mover) : null;
  const target = map ? getTokenByRef(map.id, plan.target.refId) : null;
  if (!encounter || !map || !me || !target) {
    return { moveOwed: `${plan.moverName} is no longer on the board to walk.` };
  }
  let last = "";
  // The open squares beside them, nearest the mover first; one a wall or a
  // crowd keeps it from reaching gives way to the next.
  for (const square of openSquaresBeside(encounter.id, map, me, target, tokenFootprint(target))) {
    const walked = move(square.x, square.y);
    if (!walked.error) {
      return { walked: { ...walkReport(walked), toward: target.name } };
    }
    last = walked.error;
  }
  return { moveOwed: `${plan.moverName} could not be walked toward ${target.name}${last ? `: ${last}` : "."}` };
}
