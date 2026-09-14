import { isErrorResponse, requireMember, steersStory } from "@/lib/campaign-api";
import { getSheetForUser } from "@/lib/db/sheets";
import { insertTranscriptLines, listTranscriptSince } from "@/lib/db/voice-transcript";
import { describeInstant } from "@/lib/dm/calendar";
import { publishEphemeral } from "@/lib/events";
import { sttAvailable, transcribeAudio } from "@/lib/stt";
import { labelLines, MIN_RING_SECONDS } from "@/lib/voice/transcript";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A speaker's ring of audio (docs/vtt-parity-implementation-plan.md 13.3):
// the browser cuts its own microphone into 30 second rings while the
// table has transcription on, and posts each one here with when it began.
// The server knows who is speaking because it is their session; the label
// is their character's name when they have one.
const MAX_RING_BYTES = 6 * 1024 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!context.campaign.gameSettings.voice.transcribe) {
    return Response.json({ error: "This table is not being transcribed." }, { status: 400 });
  }
  if (!sttAvailable()) {
    return Response.json({ error: "This server has no transcription service configured." }, { status: 503 });
  }
  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json({ error: "No audio in the ring." }, { status: 400 });
  }
  if (audio.size > MAX_RING_BYTES) {
    return Response.json({ error: "That ring is too large." }, { status: 413 });
  }
  const seconds = Number(form?.get("seconds") ?? 0);
  if (seconds < MIN_RING_SECONDS) {
    return Response.json({ lines: 0 });
  }
  const startedAt = String(form?.get("startedAt") ?? new Date().toISOString());
  const transcribed = await transcribeAudio(audio, audio.type.includes("ogg") ? "ring.ogg" : "ring.webm");
  if ("error" in transcribed) {
    return Response.json({ error: transcribed.error }, { status: 502 });
  }
  const sheet = getSheetForUser(campaignId, context.user.id);
  const speaker = sheet?.name ?? context.user.username;
  const clockLabel = describeInstant(context.campaign.clock.calendar, context.campaign.clock.instant);
  const lines = labelLines(transcribed.text, speaker, startedAt, clockLabel);
  if (lines.length) {
    insertTranscriptLines(campaignId, context.user.id, lines);
    publishEphemeral(campaignId, "transcript_updated", { at: Date.now() });
  }
  return Response.json({ lines: lines.length });
}

export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const since = new URL(request.url).searchParams.get("since") ?? new Date(Date.now() - 60 * 60_000).toISOString();
  // The transcript is the table's own words; every member may read it.
  // The DM seat may read further back for the chapter it is writing.
  const lines = listTranscriptSince(campaignId, since, steersStory(context) ? 400 : 120);
  return Response.json({ lines });
}
