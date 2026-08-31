import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { listDmBeats } from "@/lib/db/dm-beats";
import { listRecentMessages } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";
import { recordBeat, storyCutoffAt } from "@/lib/dm/beats";
import { expandBeat } from "@/lib/dm/delegate";
import { delegated } from "@/lib/dm/delegation";
import {
  BEAT_KINDS,
  BEAT_MAX_CHARS,
  BEAT_SOURCES,
} from "@/lib/dm/beat-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The DM's story capture. A beat is a summary of play that happened out loud
// and was never typed, and it lands in the transcript as an ordinary DM
// passage so every memory engine downstream keeps working without knowing
// what a beat is (src/lib/dm/beats.ts).
const beatSchema = z.object({
  body: z.string().trim().min(1).max(BEAT_MAX_CHARS),
  kind: z.enum(BEAT_KINDS).default("scene"),
  // Provenance, not permission: 'drafted' means the DM accepted a model's
  // draft, and they always edited it in a box before it got here.
  source: z.enum(BEAT_SOURCES).default("typed"),
  // Assisted mode: say this to the table in full rather than as the one line
  // the DM typed. Per beat rather than per campaign, because a DM who wants
  // the help on a scene transition rarely wants it on "they took the left
  // fork". The expansion is stored as a second take on this same message, so
  // the DM's own words stay one click away (src/lib/dm/delegate.ts).
  expand: z.boolean().default(false),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({
    beats: listDmBeats(campaignId, 20),
    // When the uncaptured stretch begins, so the console can say what a
    // draft would be summarizing.
    since: storyCutoffAt(campaignId),
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
  const { campaign, user } = context;
  if (campaign.status !== "active") {
    return Response.json({ error: "The adventure has not started yet." }, { status: 400 });
  }

  const parsed = beatSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Write a sentence or two first." }, { status: 400 });
  }

  const { beat, messageId } = recordBeat(campaign, user.id, parsed.data);

  if (
    parsed.data.expand &&
    delegated(campaign.gameSettings.dmMode, campaign.gameSettings.dmAssist, "narration")
  ) {
    // Off the request: the DM's line is already in the transcript and the
    // table is already reading it. The prose arrives as a message_updated
    // when the model is done, or never, and either way nothing is lost.
    const names = new Map(listSheets(campaignId).map((sheet) => [sheet.id, sheet.name]));
    const recent = listRecentMessages(campaignId, 12)
      .filter((message) => message.id !== messageId)
      .map((message) => {
        const who =
          message.authorType === "dm"
            ? "DM"
            : (message.characterId && names.get(message.characterId)) || "A player";
        return `${who}: ${message.content}`;
      });
    // Not wrapped in enqueueDmJob: expandBeat queues its own model call, and
    // a job that awaited a second job on the same serial queue would wait on
    // itself forever.
    void expandBeat(campaign, messageId, recent);
  }

  return Response.json({ beat }, { status: 201 });
}
