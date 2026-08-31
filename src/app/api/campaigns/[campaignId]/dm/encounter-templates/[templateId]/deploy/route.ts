import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { getEncounterTemplate } from "@/lib/db/encounter-templates";
import { deployTemplate } from "@/lib/dm/encounter-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deploy a prepared encounter: one action at the table for what the DM
// already decided at home. It runs through the adjudication façade, so this
// is the same fight a typed roster would have produced, refusals and all.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; templateId: string }> },
) {
  const { campaignId, templateId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const template = getEncounterTemplate(templateId);
  if (!template || template.campaignId !== campaignId) {
    return Response.json({ error: "No such prepared encounter." }, { status: 404 });
  }
  const outcome = await deployTemplate(context.campaign, context.user.id, template);
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: 409 });
  }
  return Response.json({ ok: true, result: outcome.result, mapError: outcome.mapError ?? null });
}
