import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import {
  getCampaignMessage,
  setMessageVariants,
  updateMessageContent,
} from "@/lib/db/messages";
import { publishPersisted } from "@/lib/events";
import { MAX_EDITED_LENGTH, checkEdit, replaceSelectedTake } from "@/lib/dm/message-edit-logic";
import { resolveVariantIndex, seedVariants } from "@/lib/dm/renarrate-logic";

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

  // Keep the variant set coherent: replace the take being read, leave the
  // others, so browsing still works after an edit.
  const variants = seedVariants(message.variants ?? [], message.content);
  const index = resolveVariantIndex(variants, message.variantIndex ?? 0);
  const updated =
    index >= 0 && variants.length > 1
      ? setMessageVariants(messageId, replaceSelectedTake(variants, index, check.content), index)
      : updateMessageContent(messageId, check.content);

  if (!updated) {
    return Response.json({ error: "Could not save the edit." }, { status: 500 });
  }
  publishPersisted(campaignId, "message_updated", { message: updated });
  return Response.json({ message: updated });
}
