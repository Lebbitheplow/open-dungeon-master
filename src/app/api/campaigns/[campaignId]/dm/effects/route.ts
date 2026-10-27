import { z } from "zod";
import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import { deleteEffect, effectsUpdate, listEffects } from "@/lib/db/active-effects";
import { visibleEffects } from "@/lib/dm/effects-logic";
import { publishEffects } from "@/lib/dm/effect-tools";

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
  const secrets = caps.adjudicates || caps.secretStory;
  // A player's list leaves out an effect on an enemy the DM keeps off the
  // board as well, as the event's table copy does (src/lib/table-delivery.ts).
  const { effects, hiddenTargets } = effectsUpdate(campaignId);
  const hidden = new Set(secrets ? [] : hiddenTargets);
  return Response.json({
    effects: visibleEffects(effects, secrets).filter((effect) => !hidden.has(effect.targetId)),
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
  // Lifting one is clear_effect from a list, an adjudication, which waits
  // out a break as the console's does.
  const paused = refuseDuringBreak(campaignId);
  if (paused) {
    return paused;
  }
  const lifting = listEffects(campaignId).find((effect) => effect.id === parsed.data.effectId);
  if (!deleteEffect(campaignId, parsed.data.effectId)) {
    return Response.json({ error: "That effect is already gone." }, { status: 409 });
  }
  // An enemy's maximum moved with it reaches the tracker, as clear_effect's does.
  publishEffects(
    campaignId,
    lifting?.targetKind === "enemy" && lifting.modifiers.some((modifier) => modifier.field === "maxHp" && modifier.mode === "add" && modifier.value),
  );
  return Response.json({ effects: listEffects(campaignId) });
}
