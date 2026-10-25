import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { correctionsField } from "@/lib/correction-reasons";
import { getDatabase } from "@/lib/db/core";
import { getCampaignMessage, setMessageVariants } from "@/lib/db/messages";
import { recordTurnCorrection } from "@/lib/db/turn-ledger";
import { publishPersisted } from "@/lib/events";
import { MAX_EDITED_LENGTH, checkEdit, keepOriginalTake } from "@/lib/dm/message-edit-logic";
import { seedVariants } from "@/lib/dm/renarrate-logic";
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

  // The narrator's wording is kept: the edit is a take of its own beside
  // the narrator's, selected, so browsing still works and the original is
  // never lost (issue #460). A second edit rewrites the person's take.
  const kept = keepOriginalTake(seedVariants(message.variants ?? [], message.content), message.editedTake, check.content);
  // The lines the edit left alone keep their speakers; new ones are read
  // from the person's words (src/lib/dm/speech-lines.ts).
  const speech = mergeLines(message.speech, personLines(context.campaign, check.content));
  // The edit and its ledger row land together. The turn behind the message
  // is the one corrected; nothing is recorded for a person's own narration
  // or at a table a person runs.
  const { updated, correctionId } = getDatabase().transaction(() => {
    const saved = setMessageVariants(messageId, kept.variants, kept.index, speech, kept.editedTake);
    return {
      updated: saved,
      correctionId: saved
        ? recordTurnCorrection({
            campaignId,
            turnId: message.dmTurnId ?? null,
            attribution: "direct",
            kind: "narration_edit",
            messageId,
            userId: context.user.id,
          })
        : null,
    };
  })();

  if (!updated) {
    return Response.json({ error: "Could not save the edit." }, { status: 500 });
  }
  publishPersisted(campaignId, "message_updated", { message: updated });
  return Response.json({ message: updated, ...correctionsField(correctionId ? [correctionId] : []) });
}
