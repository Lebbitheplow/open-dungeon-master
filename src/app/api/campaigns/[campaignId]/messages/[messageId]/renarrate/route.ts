import { z } from "zod";
import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { getLatestDmMessage } from "@/lib/db/messages";
import { publishPersisted } from "@/lib/events";
import { getDmStatus } from "@/lib/dm/status";
import { runRenarrate, selectRenarrateVariant } from "@/lib/dm/renarrate";
import { MAX_GUIDANCE_LENGTH } from "@/lib/dm/renarrate-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Narration reroll. Both actions are the party lead's alone: a reroll costs a
// model call and a selection changes what the whole table reads.
//
// "reroll" re-runs only the final narration call of the turn behind the
// message, so nothing mechanical moves (see src/lib/dm/renarrate.ts).
// "select" swaps which stored variant stands.

const rerollSchema = z.object({
  action: z.literal("reroll"),
  // A one-off directive for this take only ("darker", "more dialogue").
  guidance: z.string().max(MAX_GUIDANCE_LENGTH * 4).default(""),
  // Relative, and clamped again in computeRerollTemperature.
  tempOffset: z.number().min(0).max(1).optional(),
});

const selectSchema = z.object({
  action: z.literal("select"),
  index: z.number().int().min(0).max(64),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; messageId: string }> },
) {
  const { campaignId, messageId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = await request.json().catch(() => ({}));

  if ((raw as { action?: unknown }).action === "select") {
    const parsed = selectSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid select request." }, { status: 400 });
    }
    const selected = selectRenarrateVariant({
      campaignId,
      messageId,
      index: parsed.data.index,
    });
    if ("error" in selected) {
      return Response.json({ error: selected.error }, { status: selected.status });
    }
    publishPersisted(campaignId, "message_updated", { message: selected.message });
    return Response.json({ message: selected.message });
  }

  const parsed = rerollSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid reroll request." }, { status: 400 });
  }
  // Only the newest DM narration is rerollable: anything earlier has already
  // been read and built on, and rewriting it would strand the replies to it.
  const latest = getLatestDmMessage(campaignId);
  if (!latest || latest.id !== messageId) {
    return Response.json(
      { error: "Only the DM's most recent message can be rerolled." },
      { status: 400 },
    );
  }
  // A turn in flight is about to replace this narration anyway, and the
  // reroll would queue behind it and rewrite the wrong message.
  if (getDmStatus(campaignId) !== "idle") {
    return Response.json({ error: "The DM is mid-turn; try again after." }, { status: 409 });
  }

  const result = await runRenarrate({
    campaignId,
    messageId,
    guidance: parsed.data.guidance,
    tempOffset: parsed.data.tempOffset,
  });
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  publishPersisted(campaignId, "message_updated", { message: result.message });
  return Response.json({ message: result.message });
}
