// The one place an effect leaves the server. Handlers plan with
// src/lib/battlemap/fx-plan.ts and call publishFx; nothing else publishes
// the `fx` event type, so the projection rule lives in one function:
// numbers ride only for seats allowed real numbers, and the client applies
// the redaction per viewer through its caps (useCampaignStream.ts).
import { publishEphemeral } from "@/lib/events";
import { getActiveBattleMap } from "@/lib/battlemap/view";
import { getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import type { FxEvent } from "@/lib/battlemap/fx-plan";
import type { XY } from "@/lib/battlemap/types";

export function publishFx(campaignId: string, fx: FxEvent | null | undefined) {
  if (!fx) {
    return;
  }
  publishEphemeral(campaignId, "fx", fx);
}

// Where a combatant stands on the live board, by its sheet or enemy id, or
// null when there is no board or the combatant has no token. Handlers use
// this to give the planner tiles; an effect with no tiles is not planned,
// because a theatre-of-the-mind fight has no board to draw on.
export function tokenPosition(
  campaignId: string,
  refId: string,
): { at: XY; tokenId: string; hidden: boolean } | null {
  const map = getActiveBattleMap(campaignId);
  if (!map) {
    return null;
  }
  const token = getTokenByRef(map.id, refId);
  if (!token) {
    return null;
  }
  return { at: { x: token.x, y: token.y }, tokenId: token.id, hidden: token.hidden };
}

export function tokenPositions(campaignId: string): Map<string, { at: XY; tokenId: string }> {
  const map = getActiveBattleMap(campaignId);
  const out = new Map<string, { at: XY; tokenId: string }>();
  if (!map) {
    return out;
  }
  for (const token of listTokens(map.id)) {
    out.set(token.refId, { at: { x: token.x, y: token.y }, tokenId: token.id });
  }
  return out;
}
