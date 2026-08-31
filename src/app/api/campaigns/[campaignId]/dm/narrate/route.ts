import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { allocateSeq, getFloor, setFloor } from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { maybeCloseChapter } from "@/lib/dm/chapter-close";
import { maybeCompactHistory } from "@/lib/dm/compaction";
import { enqueueDmJob } from "@/lib/dm/queue";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { enqueueNarrationAudio } from "@/lib/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The human DM's narration. This is the counterpart to the tail of
// startDmTurn: the same message row, the same seq, the same event, the same
// read-aloud and the same chapter bookkeeping, with the model and the tool
// loop cut out. Keeping the shape identical is what lets every downstream
// engine (chapters, compaction, retrieval, export, recap) keep working
// without knowing who wrote the words.
const narrateSchema = z.object({
  content: z.string().trim().min(1).max(8000),
});

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

  const parsed = narrateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Write something to narrate." }, { status: 400 });
  }

  const seq = allocateSeq(campaignId);
  // author_type stays "dm" so the transcript, the export and the DM-message
  // affordances (read-aloud, pin, lore check) do not need a third author.
  // user_id names the person, which is how the client tells a human DM's
  // passage from the AI's.
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "dm",
    userId: user.id,
    content: parsed.data.content,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });

  // Held responses behave exactly as they do after an AI narration: the
  // table is locked for discussion until the floor is opened again.
  if (campaign.gameSettings.holdSubmissions) {
    const current = getFloor(campaignId);
    if (current.mode !== "hold") {
      const held = { mode: "hold" as const, next: current };
      setFloor(campaignId, held);
      publishPersisted(campaignId, "floor_changed", { floor: held });
    }
  }

  if (campaign.gameSettings.ttsEnabled) {
    void enqueueNarrationAudio(
      campaignId,
      message.id,
      parsed.data.content,
      campaign.gameSettings.ttsVoice,
    );
  }

  // Chapter and compaction upkeep runs on the campaign queue, off the
  // request, so a long summary never makes the DM wait to hit send.
  enqueueDmJob(campaignId, async () => {
    await maybeCloseChapter(campaignId, { beatCompleted: false });
    await maybeCompactHistory(campaignId);
  });

  return Response.json({ messageId: message.id }, { status: 201 });
}
