import { z } from "zod";
import { isErrorResponse, requireLead, requireMember } from "@/lib/campaign-api";
import {
  getHouseRulesText,
  listRuleChunks,
  setHouseRules,
  setRuleChunkFlags,
} from "@/lib/db/rules";
import { HOUSE_RULES_MAX } from "@/lib/dm/rules-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// House rules are table-visible; only the lead edits them.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({
    text: getHouseRulesText(campaignId),
    chunks: listRuleChunks(campaignId),
  });
}

const putSchema = z.object({ text: z.string().max(HOUSE_RULES_MAX) });

// Saves the house-rules text; the server rechunks and re-embeds.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = putSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid house rules." }, { status: 400 });
  }
  const chunks = setHouseRules(campaignId, parsed.data.text);
  return Response.json({ text: getHouseRulesText(campaignId), chunks });
}

const patchSchema = z.object({
  chunkId: z.string().max(80),
  enabled: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

// Per-chunk switches: silence one house rule or pin it into every prompt.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid chunk update." }, { status: 400 });
  }
  const chunk = setRuleChunkFlags(parsed.data.chunkId, parsed.data);
  if (!chunk || chunk.campaignId !== campaignId) {
    return Response.json({ error: "Rule chunk not found." }, { status: 404 });
  }
  return Response.json({ chunk });
}
