import { z } from "zod";
import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import {
  dismissMerge,
  getNpcById,
  listDismissedMerges,
  listNpcs,
  mergeNpcs,
  renameNpc,
  suggestNpcMerges,
} from "@/lib/db/npcs";
import {
  MAX_NPC_NAME,
  filterDismissed,
  isReviewError,
  pairKey,
  planMerge,
  planRename,
} from "@/lib/dm/entity-review-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The NPC review queue: the fuzzy name matches entity-logic.ts deliberately
// refuses to resolve on its own.
//
// suggestNpcMerges has existed and been computed for a while, and nothing
// ever read it, so "Aldric" and "Alaric" stayed two NPCs with two attitudes
// forever. Lead-only on every verb: merging two NPCs is not something a table
// can easily undo, and the roster carries DM-side agency state.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const suggestions = filterDismissed(
    suggestNpcMerges(campaignId),
    listDismissedMerges(campaignId),
  );
  return Response.json({
    suggestions,
    npcs: listNpcs(campaignId).map((npc) => ({
      id: npc.id,
      name: npc.name,
      aliases: npc.aliases,
      attitude: npc.attitude,
      location: npc.location,
      archived: npc.archived,
    })),
  });
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("merge"),
    keepId: z.string().min(1),
    mergeId: z.string().min(1),
  }),
  z.object({
    action: z.literal("rename"),
    npcId: z.string().min(1),
    name: z.string().trim().min(1).max(MAX_NPC_NAME),
  }),
  z.object({
    action: z.literal("dismiss"),
    name: z.string().trim().min(1),
    matches: z.string().trim().min(1),
  }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const body = parsed.data;

  if (body.action === "dismiss") {
    dismissMerge(campaignId, pairKey(body.name, body.matches));
    return Response.json({ ok: true });
  }

  if (body.action === "rename") {
    const npc = getNpcById(body.npcId);
    if (!npc || npc.campaignId !== campaignId) {
      return Response.json({ error: "NPC not found." }, { status: 404 });
    }
    const plan = planRename(npc, body.name);
    if (isReviewError(plan)) {
      return Response.json({ error: plan.error }, { status: 409 });
    }
    // A rename onto a name another NPC already holds would violate the
    // UNIQUE (campaign_id, name) constraint; say so rather than 500.
    const clash = listNpcs(campaignId).find(
      (other) => other.id !== npc.id && other.name === plan.name,
    );
    if (clash) {
      return Response.json(
        { error: `Another NPC is already called "${plan.name}". Merge them instead.` },
        { status: 409 },
      );
    }
    return Response.json({ npc: renameNpc(npc.id, plan.name, plan.aliases) });
  }

  const keep = getNpcById(body.keepId);
  const merge = getNpcById(body.mergeId);
  if (!keep || !merge || keep.campaignId !== campaignId || merge.campaignId !== campaignId) {
    return Response.json({ error: "NPC not found." }, { status: 404 });
  }
  const plan = planMerge(keep, merge);
  if (isReviewError(plan)) {
    return Response.json({ error: plan.error }, { status: 409 });
  }
  const merged = mergeNpcs(campaignId, keep.id, merge.id, plan.aliases);
  if (!merged) {
    return Response.json({ error: "Those two could not be merged." }, { status: 409 });
  }
  return Response.json({ npc: merged });
}
