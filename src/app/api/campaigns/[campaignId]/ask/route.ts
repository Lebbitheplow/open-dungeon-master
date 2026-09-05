import { z } from "zod";
import { isErrorResponse, requireMember, requireVoice } from "@/lib/campaign-api";
import { insertAsk, listAsksForUser } from "@/lib/db/asks";
import { getSheetForUser } from "@/lib/db/sheets";
import { publishEphemeral } from "@/lib/events";
import { runAsk } from "@/lib/dm/ask";
import {
  ASK_SCOPES,
  ASK_VISIBILITIES,
  QUESTION_MAX_CHARS,
  clampQuestion,
  inferScope,
} from "@/lib/dm/ask-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ask: put a question to the DM without spending a turn on it.
//
// Deliberately NO floor check. Ask behaves like ooc: it works during a hold,
// a spotlight, an initiative order, and while the DM is mid-narration. A
// question that has to wait for your turn is not much use, and since nothing
// here progresses the story there is nothing for floor control to protect.

const askSchema = z.object({
  question: z.string().trim().min(1).max(QUESTION_MAX_CHARS),
  scope: z.enum(["auto", ...ASK_SCOPES]).default("auto"),
  visibility: z.enum(ASK_VISIBILITIES).default("private"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireVoice(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const { user } = context;

  const raw = await request.json().catch(() => ({}));
  const parsed = askSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid question." }, { status: 400 });
  }

  const question = clampQuestion(parsed.data.question);
  const scope =
    parsed.data.scope === "auto" ? inferScope(question) : parsed.data.scope;

  const result = await runAsk({ campaignId, userId: user.id, question, scope });
  const sheet = getSheetForUser(campaignId, user.id);
  const failed = "error" in result;

  const ask = insertAsk({
    campaignId,
    userId: user.id,
    characterId: sheet?.id ?? null,
    visibility: parsed.data.visibility,
    scope,
    question,
    answer: failed ? "" : result.answer,
    citations: failed ? [] : result.citations,
    status: failed ? "failed" : "answered",
  });

  // Only a table-visible ask tells anyone else anything happened, and even
  // then the event carries no content: each client refetches its own rows,
  // the same privacy pattern as whispers and facts.
  if (!failed && parsed.data.visibility === "table") {
    publishEphemeral(campaignId, "ask_activity", {});
  }

  if (failed) {
    return Response.json({ error: result.error, ask }, { status: 502 });
  }
  return Response.json({ ask });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ asks: listAsksForUser(campaignId, context.user.id) });
}
