import { z } from "zod";
import { isErrorResponse, isLead, requireMember } from "@/lib/campaign-api";
import { createPin, deletePin, listPins } from "@/lib/db/pins";
import { getCampaignMessage } from "@/lib/db/messages";
import { publishPersisted } from "@/lib/events";
import { MAX_PIN_LENGTH, checkPin } from "@/lib/dm/pin-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pinned memories. Any member may pin or unpin: a pin is a note to the DM
// about what matters, and gatekeeping that behind the lead would mean the
// player whose character the detail concerns cannot flag it.

const createSchema = z.object({
  messageId: z.string().min(1).max(80),
  // Generous relative to MAX_PIN_LENGTH so the real limit and its message
  // come from checkPin rather than from a bare zod rejection.
  text: z.string().min(1).max(MAX_PIN_LENGTH * 4),
  isFullMessage: z.boolean().default(false),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ pins: listPins(campaignId) });
}

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
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid pin." }, { status: 400 });
  }

  const message = getCampaignMessage(parsed.data.messageId);
  if (!message || message.campaignId !== campaignId) {
    return Response.json({ error: "Message not found." }, { status: 404 });
  }

  // The cap is checked against what is currently stored, not against what the
  // client believed, so two players pinning at once cannot both slip past it.
  const existing = listPins(campaignId);
  const check = checkPin(existing, parsed.data.text);
  if (!check.ok) {
    return Response.json({ error: check.reason }, { status: 409 });
  }

  const pin = createPin({
    campaignId,
    messageId: parsed.data.messageId,
    text: check.text,
    isFullMessage: parsed.data.isFullMessage,
    pinnedByUserId: context.user.id,
  });
  publishPersisted(campaignId, "pins_updated", { pinId: pin.id });
  return Response.json({ pin });
}

const deleteSchema = z.object({ pinId: z.string().min(1).max(80) });

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = deleteSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid unpin." }, { status: 400 });
  }
  // Own pin, or the lead. A pin rides in every prompt, so unpinning someone
  // else's silently changes what the DM remembers for the whole table.
  if (
    !deletePin(campaignId, parsed.data.pinId, {
      userId: context.user.id,
      isLead: isLead(context),
    })
  ) {
    return Response.json(
      { error: "That pin is not yours to remove." },
      { status: 403 },
    );
  }
  publishPersisted(campaignId, "pins_updated", { pinId: parsed.data.pinId });
  return Response.json({ ok: true });
}
