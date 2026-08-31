import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import {
  deleteEncounterTemplate,
  getEncounterTemplate,
  updateEncounterTemplate,
} from "@/lib/db/encounter-templates";
import {
  checkRoster,
  normalizeTemplateMap,
  parseRoster,
  TEMPLATE_HINT_MAX,
  TEMPLATE_NAME_MAX,
  TEMPLATE_NOTES_MAX,
} from "@/lib/dm/encounter-template-logic";
import { templateDifficulty } from "@/lib/dm/encounter-templates";
import { getPreparedMap } from "@/lib/db/prepared-maps";
import { MAP_THEMES } from "@/lib/battlemap/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(TEMPLATE_NAME_MAX).optional(),
  enemies: z.string().trim().max(2_000).optional(),
  battlefield: z.string().trim().max(TEMPLATE_HINT_MAX).optional(),
  notes: z.string().trim().max(TEMPLATE_NOTES_MAX).optional(),
  map: z.unknown().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; templateId: string }> },
) {
  const { campaignId, templateId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const template = getEncounterTemplate(templateId);
  // The id comes from the URL, so the campaign check is what stops one
  // campaign's id being used to edit another's.
  if (!template || template.campaignId !== campaignId) {
    return Response.json({ error: "No such prepared encounter." }, { status: 404 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid edit." }, { status: 400 });
  }
  let enemies = template.enemies;
  if (parsed.data.enemies !== undefined) {
    const roster = checkRoster(parseRoster(parsed.data.enemies));
    if ("error" in roster) {
      return Response.json({ error: roster.error }, { status: 400 });
    }
    enemies = roster.rows;
  }
  const map =
    parsed.data.map === undefined
      ? template.map
      : normalizeTemplateMap(parsed.data.map, {
          themes: MAP_THEMES,
          ambients: ["bright", "dim", "dark"],
        });
  // Same drawer check the create route makes; the normalizer is pure and
  // only shape-checks the id.
  if (parsed.data.map !== undefined && map.mapId && !getPreparedMap(campaignId, map.mapId)) {
    return Response.json(
      { error: "That prepared map is not in this campaign's drawer." },
      { status: 400 },
    );
  }
  const updated = updateEncounterTemplate(templateId, {
    name: parsed.data.name ?? template.name,
    enemies,
    battlefield: parsed.data.battlefield ?? template.battlefield,
    map,
    notes: parsed.data.notes ?? template.notes,
  });
  return Response.json({
    template: updated
      ? { ...updated, readout: templateDifficulty(context.campaign, updated.enemies) }
      : null,
  });
}

export async function DELETE(
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
  deleteEncounterTemplate(templateId);
  return Response.json({ ok: true });
}
