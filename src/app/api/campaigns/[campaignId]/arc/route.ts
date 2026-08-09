import { z } from "zod";
import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { getCampaignById, setStoryArc } from "@/lib/db/campaigns";
import { generateStoryArc } from "@/lib/dm/arc";
import { enqueueDmJob } from "@/lib/dm/queue";
import {
  MAX_BEAT_TEXT,
  applyBeatEdit,
  isEditError,
  type BeatEdit,
  type EditResult,
} from "@/lib/dm/arc-edit-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The DM's secret story arc. Lead-only on both verbs: the arc is the spine
// the AI steers by and players must never see it (publicCampaign strips it
// from every campaign payload for the same reason).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  return Response.json({ arc: campaign.storyArc, dmOutline: campaign.dmOutline });
}

// Party lead: throw the arc away and generate a fresh one from the current
// premise/outline. Runs on the DM queue so it never interleaves with a turn.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  enqueueDmJob(campaignId, () => generateStoryArc(campaignId, { force: true }));
  return Response.json({ ok: true }, { status: 202 });
}

// Party lead: edit one main beat, without regenerating anything.
//
// POST above is the sledgehammer, and until now it was the only tool: a lead
// who disliked a single beat lost the antagonist, the cast, the events, and
// every act sketch along with it. One edit at a time, so a rejected operation
// says exactly which one it was and why.
const editSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("rename"),
    beat: z.number().int().positive(),
    text: z.string().trim().min(1).max(MAX_BEAT_TEXT),
  }),
  z.object({
    op: z.literal("move"),
    beat: z.number().int().positive(),
    direction: z.enum(["up", "down"]),
  }),
  z.object({ op: z.literal("skip"), beat: z.number().int().positive() }),
  z.object({ op: z.literal("setNow"), beat: z.number().int().positive() }),
  z.object({
    op: z.literal("add"),
    act: z.number().int().positive(),
    text: z.string().trim().min(1).max(MAX_BEAT_TEXT),
  }),
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  if (!campaign.storyArc) {
    return Response.json({ error: "This campaign has no arc yet." }, { status: 409 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = editSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid edit." }, { status: 400 });
  }

  // Queued, so an edit and a live turn never write story_arc_json at once:
  // the turn's complete_beat and this both read-modify-write the whole blob.
  // The arc is re-read inside the job rather than reused from above, because
  // a turn may have advanced [NOW] while this request sat in the queue.
  let result = { error: "This campaign has no arc yet." } as EditResult;
  await enqueueDmJob(campaignId, async () => {
    const current = getCampaignById(campaignId)?.storyArc;
    if (!current) {
      return;
    }
    const edited = applyBeatEdit(current, parsed.data as BeatEdit);
    result = edited;
    if (!isEditError(edited)) {
      setStoryArc(campaignId, edited.arc);
    }
  });

  if (isEditError(result)) {
    return Response.json({ error: result.error }, { status: 409 });
  }
  return Response.json({ arc: result.arc });
}
