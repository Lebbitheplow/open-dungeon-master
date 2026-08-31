import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { getCurrentLocation } from "@/lib/db/locations";
import { generateRollTable } from "@/lib/dm/assist";
import { formatRollTable } from "@/lib/dm/roll-table-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Drafts table rows from a description. Writes nothing: the rows come back as
// text in the editor, and the DM saves them (or does not) themselves. That is
// what "optionally AI-generated and then owned by the DM" has to mean.
const generateSchema = z.object({
  prompt: z.string().trim().min(1).max(300),
  rows: z.number().int().min(2).max(100).default(12),
  // Pulls the party's current location into the prompt, so "rumours in the
  // tavern" gets rumours about somewhere real.
  useLocation: z.boolean().default(true),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = generateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say what the table should be about." }, { status: 400 });
  }
  const location = parsed.data.useLocation ? getCurrentLocation(campaignId) : null;
  const { entries, error } = await generateRollTable(context.campaign, {
    prompt: parsed.data.prompt,
    rows: parsed.data.rows,
    context: location ? `${location.name}. ${location.layoutDescription ?? ""}`.trim() : undefined,
  });
  if (error) {
    return Response.json({ error }, { status: 409 });
  }
  return Response.json({ entries, text: formatRollTable(entries) });
}
