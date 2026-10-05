import { existsSync } from "node:fs";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getCampaignMessage } from "@/lib/db/messages";
import { enqueueNarrationAudio, listNarrationAudio, narrationAudioPath, takeNarrationFailure } from "@/lib/tts";
import { ttsBackend } from "@/lib/tts-backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Narrate on demand: render speech for a DM message that has none.
//
// Narration is otherwise only ever rendered once, at the end of the turn that
// wrote it, so a passage from before TTS was switched on (or one whose render
// failed) could never be voiced at all. Open to any member rather than the
// lead: it only adds audio for prose the whole table is already reading, and
// touches nothing in the story.
//
// Awaited rather than fire-and-forget so the caller learns whether it worked.
// The media queue swallows job errors by design, so success is judged by the
// file being on disk afterwards.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; messageId: string }> },
) {
  const { campaignId, messageId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const message = getCampaignMessage(messageId);
  if (!message || message.campaignId !== campaignId) {
    return Response.json({ error: "Message not found." }, { status: 404 });
  }
  if (message.authorType !== "dm") {
    return Response.json({ error: "Only the DM's narration can be voiced." }, { status: 400 });
  }

  if (ttsBackend().provider === "off") {
    return Response.json({ error: "Narration is switched off on this server (Admin > Speech)." }, { status: 409 });
  }

  await enqueueNarrationAudio(
    campaignId,
    message.id,
    message.content,
    context.campaign.gameSettings,
    // A passage spoken as someone is read as them again, not as the narrator.
    message.speaker ?? null,
  );

  if (!existsSync(narrationAudioPath(campaignId, message.id))) {
    const reason = takeNarrationFailure(message.id);
    return Response.json(
      { error: reason ? `Narration failed. ${reason}` : "Narration failed. Check that the speech service is reachable." },
      { status: 502 },
    );
  }
  // enqueueNarrationAudio already published tts_ready, which is what moves the
  // clients; this is just the acknowledgement for the caller.
  return Response.json({
    ok: true,
    url: listNarrationAudio(campaignId)[message.id] ?? `/generated-audio/${campaignId}/${message.id}.mp3`,
  });
}
