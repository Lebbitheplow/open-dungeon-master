import { z } from "zod";
import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import {
  cancelCoordination,
  currentCoordination,
  earlyResolveRefusal,
  openCoordination,
  orderCoordination,
  resolveCoordination,
  stageCoordination,
} from "@/lib/dm/coordination";
import { PLAN_MAX_CHARS } from "@/lib/dm/coordination-logic";
import { storyNameOf } from "@/lib/characters/story-name";
import { sessionHoldOn } from "@/lib/dm/session-hold";
import { sessionRefusal } from "@/lib/dm/session-hold-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Coordinate actions (issue 254). GET reads the plan being drafted. POST:
//   open     whoever steers the story, over the characters named (all when
//            none are), with an optional question for the party;
//   plan     a player's own character: its draft, ready or pass;
//   request  a player's request for an AI companion in the plan;
//   order    the lead sets the order the characters act in, as steps of
//            character ids (issue 292), or null for all at once;
//   resolve  the lead, now, with whoever is missing passed;
//   cancel   the lead sets the plan aside.
// open takes an order too, as the same steps.
const sequenceSchema = z.array(z.array(z.string().trim().min(1).max(80)).max(12)).max(12);
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("open"),
    characterIds: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
    prompt: z.string().trim().max(300).default(""),
    sequence: sequenceSchema.nullable().optional(),
  }),
  z.object({
    action: z.literal("order"),
    sequence: sequenceSchema.nullable(),
  }),
  z.object({
    action: z.literal("plan"),
    characterId: z.string().trim().min(1).max(80),
    text: z.string().max(PLAN_MAX_CHARS * 2).optional(),
    state: z.enum(["drafting", "ready", "pass"]),
    // The order the player saw (orderKey), refused when it has changed since.
    orderSeen: z.string().max(4000).optional(),
  }),
  z.object({
    action: z.literal("request"),
    characterId: z.string().trim().min(1).max(80),
    text: z.string().max(PLAN_MAX_CHARS * 2),
  }),
  z.object({ action: z.literal("resolve") }),
  z.object({ action: z.literal("cancel") }),
]);

export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ phase: currentCoordination(campaignId) });
}

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const { campaign, user } = context;
  const steers = capsFor(context).steersStory;
  const body = parsed.data;
  const answer = (result: { phase: unknown } | { error: string; status: number }) =>
    "error" in result ? Response.json({ error: result.error }, { status: result.status }) : Response.json({ phase: result.phase });

  // Between sessions a plan neither opens, moves nor resolves: resolving
  // writes the party's lines into the story and wakes the storyteller
  // (src/lib/dm/session-hold.ts). Setting one aside still works.
  const between = body.action === "cancel" ? null : sessionHoldOn(campaignId);
  if (between) {
    return Response.json({ error: sessionRefusal(between), sessionHold: between }, { status: 409 });
  }

  switch (body.action) {
    case "open":
      if (!steers) {
        return Response.json({ error: "Whoever steers the story opens a coordinated plan." }, { status: 403 });
      }
      return answer(
        openCoordination(campaign, user.id, { characterIds: body.characterIds, prompt: body.prompt, sequence: body.sequence ?? null }),
      );
    case "order":
      if (!steers) {
        return Response.json({ error: "Whoever steers the story sets the plan's order." }, { status: 403 });
      }
      return answer(orderCoordination(campaignId, body.sequence));
    case "plan":
      return answer(
        stageCoordination(campaignId, user.id, {
          kind: "plan",
          characterId: body.characterId,
          text: body.text,
          state: body.state,
          orderSeen: body.orderSeen,
        }),
      );
    case "request":
      return answer(
        // The GM reads who asked ("asked by ..."): their hero, never their
        // account (#658).
        stageCoordination(campaignId, user.id, { kind: "request", characterId: body.characterId, text: body.text, requestedBy: storyNameOf(campaignId, user.id) }),
      );
    case "resolve": {
      if (!steers) {
        return Response.json({ error: "Only the lead resolves the plan early." }, { status: 403 });
      }
      const phase = currentCoordination(campaignId);
      if (!phase) {
        return Response.json({ error: "The party is not coordinating right now." }, { status: 409 });
      }
      const refusal = earlyResolveRefusal(phase);
      if (refusal) {
        return Response.json({ error: refusal }, { status: 409 });
      }
      return Response.json({ phase: resolveCoordination(phase) });
    }
    case "cancel":
      if (!steers) {
        return Response.json({ error: "Only the lead sets the plan aside." }, { status: 403 });
      }
      return Response.json({ phase: cancelCoordination(campaignId) });
  }
}
