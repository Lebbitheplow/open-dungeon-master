import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { actingSheetFor } from "@/lib/character-seat";
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import { getActiveBoard } from "@/lib/db/encounters";
import { takeBack, undoableMove } from "@/lib/battlemap/move-undo";
import { buildPlayerMapView } from "@/lib/battlemap/view";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { tableBreakOn } from "@/lib/dm/table-break";
import { breakRefusal } from "@/lib/dm/table-break-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Takes back the acting character's last walk this turn
// (src/lib/battlemap/move-undo.ts): the figure returns to where it stood and
// the movement comes back, while nothing else has happened since. Like the
// walk itself, this never wakes the DM.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  // Tokens stay where they stood while the table is on a break.
  const tableBreak = tableBreakOn(campaignId);
  if (tableBreak) {
    return Response.json({ error: breakRefusal(tableBreak) }, { status: 409 });
  }
  const encounter = getActiveBoard(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!encounter || !map) {
    return Response.json({ error: "No active battle map." }, { status: 404 });
  }
  const sheet = actingSheetFor(campaignId, context.user.id, undefined, encounter);
  const step = sheet ? undoableMove(encounter, map.id, sheet.id) : null;
  if (!step) {
    return Response.json(
      { error: "That move stands: something has happened since it was made, so it cannot be taken back." },
      { status: 409 },
    );
  }
  takeBack(campaignId, encounter.id, step);
  publishBattleMapUpdate(campaignId);
  return Response.json({
    view: buildPlayerMapView(campaignId, context.user.id, { enemyNumbers: capsFor(context).enemyNumbers }),
    undone: { feet: step.feet },
  });
}
