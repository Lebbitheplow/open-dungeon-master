import { z } from "zod";
import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { deleteEffect, listEffects } from "@/lib/db/active-effects";
import { visibleEffects } from "@/lib/dm/effects-logic";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reading and lifting active effects.
//
// GET is open to the whole table, because a player is owed the reasons their
// own numbers moved; what they get back is the visible subset, decided by the
// same pure function the prompt uses (visibleEffects). Applying one is an
// adjudication and goes through the console's set_effect, not here; this
// route's POST exists only to lift one by id, which is the thing a DM wants
// to do from a list they are already looking at.

const removeSchema = z.object({ effectId: z.string().min(1) });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const caps = capsFor(context);
  return Response.json({
    effects: visibleEffects(listEffects(campaignId), caps.adjudicates || caps.secretStory),
  });
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
  if (!capsFor(context).adjudicates) {
    return Response.json({ error: "Only the Dungeon Master can lift an effect." }, { status: 403 });
  }
  const parsed = removeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say which effect." }, { status: 400 });
  }
  if (!deleteEffect(campaignId, parsed.data.effectId)) {
    return Response.json({ error: "That effect is already gone." }, { status: 409 });
  }
  const effects = listEffects(campaignId);
  publishPersisted(campaignId, "effects_updated", { effects });
  return Response.json({ effects });
}
