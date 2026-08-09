import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { clearAskBrief, getAskBrief, setAskBrief } from "@/lib/db/ask-briefs";
import { getSheetForUser } from "@/lib/db/sheets";
import { publishEphemeral } from "@/lib/events";
import { draftAskBrief } from "@/lib/dm/ask-brief";
import { ASK_VISIBILITIES } from "@/lib/dm/ask-logic";
import { MAX_BRIEF_CHARS, clampBrief } from "@/lib/dm/ask-brief-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ask brief: hand what you worked out out-of-character to the DM for one turn.
//
// Two separate actions on purpose. `draft` only proposes text and stores
// nothing; `PUT` arms whatever text the player actually confirmed. The gate is
// the whole feature: Ask is read-only by design, and this is the one bridge
// into the story context, so it only ever carries a string the player has
// seen. A draft that armed itself would make that guarantee a lie.
//
// Like the Ask route itself, no floor check: arming a note is not taking a
// turn, and a note you can only arm on your own turn is not much use.

const draftSchema = z.object({ action: z.literal("draft") });

const armSchema = z.object({
  text: z.string().trim().min(1).max(MAX_BRIEF_CHARS),
  visibility: z.enum(ASK_VISIBILITIES).default("private"),
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
  return Response.json({ brief: getAskBrief(campaignId, context.user.id) });
}

// Proposes a brief from the asker's own recent thread. Stores nothing.
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
  if (!draftSchema.safeParse(raw).success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const result = await draftAskBrief(campaignId, context.user.id);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 502 });
  }
  return Response.json(result);
}

// Arms the exact text the player confirmed, replacing any brief they had
// already armed.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const { user } = context;

  const raw = await request.json().catch(() => ({}));
  const parsed = armSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid brief." }, { status: 400 });
  }

  const text = clampBrief(parsed.data.text);
  if (!text) {
    return Response.json({ error: "Invalid brief." }, { status: 400 });
  }

  const sheet = getSheetForUser(campaignId, user.id);
  const brief = setAskBrief({
    campaignId,
    userId: user.id,
    text,
    visibility: parsed.data.visibility,
    // The character's name if they have one, so the DM reads it as coming
    // from someone at the table rather than from an account.
    authorName: sheet?.name ?? user.username,
  });

  // A private brief tells the table nothing, exactly as a private ask does.
  // Even for a table-visible one the event carries no content: each client
  // refetches what it may read.
  if (parsed.data.visibility === "table") {
    publishEphemeral(campaignId, "ask_activity", {});
  }
  return Response.json({ brief });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  clearAskBrief(campaignId, context.user.id);
  return Response.json({ brief: null });
}
