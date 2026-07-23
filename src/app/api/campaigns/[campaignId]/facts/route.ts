import { z } from "zod";
import { isErrorResponse, isLead, requireMember } from "@/lib/campaign-api";
import {
  getFactById,
  insertFact,
  listFactsVisibleTo,
  setFactPinned,
  setFactStatus,
  updateFactText,
} from "@/lib/db/facts";
import { listSheets } from "@/lib/db/sheets";
import { publishEphemeral } from "@/lib/events";
import { FACT_CATEGORIES } from "@/lib/dm/fact-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// World-state facts. Reads are scoped by known_by: party facts for
// everyone, character-scoped facts for their owners, DM-only facts hidden
// unless the lead explicitly asks for secrets. Content never rides SSE;
// clients refetch on the contentless facts_updated ephemeral.

function ownedCharacterIds(campaignId: string, userId: string): string[] {
  return listSheets(campaignId)
    .filter((sheet) => sheet.userId === userId)
    .map((sheet) => sheet.id);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const secrets =
    new URL(request.url).searchParams.get("secrets") === "1" && isLead(context);
  return Response.json({
    facts: listFactsVisibleTo(
      campaignId,
      ownedCharacterIds(campaignId, context.user.id),
      secrets,
    ),
    lead: isLead(context),
  });
}

const createSchema = z.object({
  category: z.enum(FACT_CATEGORIES),
  subject: z.string().trim().max(80).default(""),
  fact: z.string().trim().min(1).max(300),
  // Transcript anchor when the fact was pinned from a chat message.
  sourceSeq: z.number().int().min(0).optional(),
});

// Lead-authored manual fact, pinned by default: writing one down by hand is
// the statement "keep this in front of the DM".
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!isLead(context)) {
    return Response.json({ error: "Only the party lead can add facts." }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid fact." }, { status: 400 });
  }
  const { sourceSeq, ...data } = parsed.data;
  const fact = insertFact({
    campaignId,
    ...data,
    pinned: true,
    source: "manual",
    sourceSeq: sourceSeq ?? null,
  });
  publishEphemeral(campaignId, "facts_updated", {});
  return Response.json({ fact });
}

const patchSchema = z.object({
  factId: z.string().min(1).max(80),
  pinned: z.boolean().optional(),
  status: z.enum(["active", "retired"]).optional(),
  category: z.enum(FACT_CATEGORIES).optional(),
  subject: z.string().trim().max(80).optional(),
  fact: z.string().trim().min(1).max(300).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid patch." }, { status: 400 });
  }
  const { factId, pinned, status, ...text } = parsed.data;
  const existing = getFactById(factId);
  if (!existing || existing.campaignId !== campaignId) {
    return Response.json({ error: "Fact not found." }, { status: 404 });
  }
  const editing = status !== undefined || Object.keys(text).length > 0;
  if (editing && !isLead(context)) {
    return Response.json(
      { error: "Only the party lead can edit or retire facts." },
      { status: 403 },
    );
  }
  // A member can only touch facts they can see.
  const visible = listFactsVisibleTo(
    campaignId,
    ownedCharacterIds(campaignId, context.user.id),
    isLead(context),
  ).some((fact) => fact.id === factId);
  if (!visible) {
    return Response.json({ error: "Fact not found." }, { status: 404 });
  }

  let updated = existing;
  if (pinned !== undefined) {
    updated = setFactPinned(factId, pinned) ?? updated;
  }
  if (status !== undefined) {
    updated = setFactStatus(factId, status) ?? updated;
  }
  if (Object.keys(text).length > 0) {
    updated = updateFactText(factId, text) ?? updated;
  }
  publishEphemeral(campaignId, "facts_updated", {});
  return Response.json({ fact: updated });
}
