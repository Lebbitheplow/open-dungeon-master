import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { correctionsField } from "@/lib/correction-reasons";
import { getCampaignMessage } from "@/lib/db/messages";
import { publishPersisted } from "@/lib/events";
import { MAX_EDITED_LENGTH, checkEdit } from "@/lib/dm/message-edit-logic";
import { saveNarrationEdit } from "@/lib/dm/narration-edit";
import { refreshNarrationAudio } from "@/lib/dm/renarrate";
import { mergeLines } from "@/lib/dm/speech";
import { personLines } from "@/lib/dm/speech-lines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lead-only correction of a DM narration's text. Fixes what the DM said (a
// wrong name, a typo, a line that contradicts the record) without rolling the
// campaign back. It never touches mechanical state and never calls the model.

const editSchema = z.object({
  content: z.string().min(1).max(MAX_EDITED_LENGTH * 2),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; messageId: string }> },
) {
  const { campaignId, messageId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = editSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid edit." }, { status: 400 });
  }

  const message = getCampaignMessage(messageId);
  if (!message || message.campaignId !== campaignId) {
    return Response.json({ error: "Message not found." }, { status: 404 });
  }
  // DM narration only. A player's own words are theirs, and a system notice
  // is a record of something the server did.
  if (message.authorType !== "dm") {
    return Response.json({ error: "Only DM narration can be edited." }, { status: 400 });
  }

  const check = checkEdit(message.content, parsed.data.content);
  if (!check.ok) {
    return Response.json({ error: check.reason }, { status: 400 });
  }

  // The lines the edit left alone keep their speakers; new ones are read
  // from the person's words (src/lib/dm/speech-lines.ts).
  const speech = mergeLines(message.speech, personLines(context.campaign, check.content));
  // The narrator's wording stays as a take beside the person's, and the
  // edit and its correction ledger row land together (issue #460).
  const { updated, correctionId } = saveNarrationEdit({
    campaignId,
    message,
    content: check.content,
    speech,
    userId: context.user.id,
  });

  if (!updated) {
    return Response.json({ error: "Could not save the edit." }, { status: 500 });
  }
  publishPersisted(campaignId, "message_updated", { message: updated });
  // The narration mp3 is keyed by message id: read the edited words aloud,
  // not the narrator's, as a reroll or a picked take does.
  refreshNarrationAudio(context.campaign, updated);
  return Response.json({ message: updated, ...correctionsField(correctionId ? [correctionId] : []) });
}
