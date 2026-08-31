import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { getDatabase } from "@/lib/db/core";
import { insertBeat, listBeats } from "@/lib/db/workshop-beats";
import { boardGraph, checkBeat, suggestTopics, type BoardInventory } from "@/lib/workshop/board";
import { compileBoard, summarizeCompile } from "@/lib/workshop/board-compile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The storyboard. GET returns the board, what it is missing and what it would
// compile into; POST adds a card.
//
// The suggestions are arithmetic over what is on the board plus what is in
// the workshop, not a model call (src/lib/workshop/board.ts). That is the
// whole point: "you have written four factions and no reason for the party to
// care about any of them" is something a DM can check, and something they can
// disagree with.

// Everything else in this workshop the board could be pointing at. Read here
// rather than in the pure module, which is what keeps the suggestion rules
// testable without a database.
function inventoryFor(campaignId: string): BoardInventory {
  const db = getDatabase();
  const rows = (sql: string) =>
    db.prepare(sql).all(campaignId) as Array<{ id: string; name: string }>;
  return {
    npcs: rows(
      `SELECT id, name FROM npcs WHERE campaign_id = ? AND archived = 0 ORDER BY name COLLATE NOCASE`,
    ),
    maps: rows(`SELECT id, name FROM prepared_maps WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`),
    encounters: rows(
      `SELECT id, name FROM encounter_templates WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`,
    ),
    locations: rows(`SELECT id, name FROM locations WHERE campaign_id = ? ORDER BY created_at`),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const beats = listBeats(campaignId);
  const inventory = inventoryFor(campaignId);
  const compiled = compileBoard(beats);
  return Response.json({
    board: boardGraph(beats),
    inventory,
    suggestions: suggestTopics(beats, inventory),
    // What this board would become, computed against a campaign with no arc
    // of its own. The import screen recomputes it against the real target.
    compiled: { ...compiled, summary: summarizeCompile(compiled, false) },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const checked = checkBeat(await request.json().catch(() => ({})));
  if ("error" in checked) {
    return Response.json({ error: checked.error }, { status: 400 });
  }
  const created = insertBeat(campaignId, checked.beat);
  if ("error" in created) {
    return Response.json({ error: created.error }, { status: 409 });
  }
  return Response.json({ beat: created }, { status: 201 });
}
