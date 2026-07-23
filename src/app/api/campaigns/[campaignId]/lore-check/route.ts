import { z } from "zod";
import { isErrorResponse, isLead, requireMember } from "@/lib/campaign-api";
import { getCampaignMessage, updateMessageContent } from "@/lib/db/messages";
import { publishPersisted } from "@/lib/events";
import { runLoreCheck } from "@/lib/dm/lore-check";
import { LORE_CHECK_CATEGORIES } from "@/lib/dm/lore-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lore check: any member may run a consistency check on a passage; only the
// party lead may accept a rewrite, and only on DM-authored messages.

const runSchema = z.object({
  action: z.literal("run").default("run"),
  messageId: z.string().min(1).max(80),
  selection: z.string().max(2000).default(""),
  category: z.enum(LORE_CHECK_CATEGORIES),
  npcName: z.string().trim().max(80).optional(),
});

const acceptSchema = z.object({
  action: z.literal("accept"),
  messageId: z.string().min(1).max(80),
  // The full replacement text (the checker's rewrite, possibly lead-edited).
  content: z.string().trim().min(1).max(8000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = await request.json().catch(() => ({}));

  if ((raw as { action?: unknown }).action === "accept") {
    const parsed = acceptSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid accept request." }, { status: 400 });
    }
    if (!isLead(context)) {
      return Response.json(
        { error: "Only the party lead can accept a rewrite." },
        { status: 403 },
      );
    }
    const message = getCampaignMessage(parsed.data.messageId);
    if (!message || message.campaignId !== campaignId) {
      return Response.json({ error: "Message not found." }, { status: 404 });
    }
    if (message.authorType !== "dm") {
      return Response.json(
        { error: "Only DM narration can be rewritten." },
        { status: 400 },
      );
    }
    const updated = updateMessageContent(message.id, parsed.data.content);
    if (!updated) {
      return Response.json({ error: "Could not update the message." }, { status: 500 });
    }
    publishPersisted(campaignId, "message_updated", { message: updated });
    return Response.json({ message: updated });
  }

  const parsed = runSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid lore-check request." }, { status: 400 });
  }
  const result = await runLoreCheck({
    campaignId,
    messageId: parsed.data.messageId,
    selection: parsed.data.selection,
    category: parsed.data.category,
    npcName: parsed.data.npcName,
  });
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 502 });
  }
  return Response.json({ result });
}
