import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { insertBeat, listBeats } from "@/lib/db/workshop-beats";
import { chaptersOf, commonChoices, storyboardInventory } from "@/lib/db/workshop-common";
import { boardGraph, brokenLinks, checkBeat, linksWithin, suggestTopics } from "@/lib/workshop/board";
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
//
// What a card may point at is this workshop's rows plus, for a chapter, its
// shared workshop's (src/lib/db/workshop-common.ts, #159), read here rather
// than in the pure module, which is what keeps the suggestion rules testable
// without a database.

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
  const { inventory, common } = storyboardInventory(context.campaign);
  const compiled = compileBoard(beats);
  // Links a card holds that no longer resolve, by card, so the board can
  // say "missing" instead of drawing a card with nothing picked.
  const broken = Object.fromEntries(
    beats
      .map((beat) => [beat.id, brokenLinks(beat, inventory)] as const)
      .filter(([, fields]) => fields.length),
  );
  return Response.json({
    board: boardGraph(beats),
    inventory,
    broken,
    suggestions: suggestTopics(beats, inventory),
    // What this board would become, computed against a campaign with no arc
    // of its own. The import screen recomputes it against the real target.
    compiled: { ...compiled, summary: summarizeCompile(compiled, false) },
    // Only a workshop draws on a shared one.
    shared:
      context.campaign.kind === "workshop"
        ? {
            common: common ? { id: common.id, title: common.title } : null,
            choices: commonChoices(context.campaign),
            chapters: chaptersOf(context.campaign),
          }
        : null,
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
  const { inventory } = storyboardInventory(context.campaign);
  const created = insertBeat(campaignId, {
    ...checked.beat,
    links: linksWithin(checked.beat.links, inventory),
  });
  if ("error" in created) {
    return Response.json({ error: created.error }, { status: 409 });
  }
  return Response.json({ beat: created }, { status: 201 });
}
