import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { insertEncounterTemplate, listEncounterTemplates } from "@/lib/db/encounter-templates";
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

const AMBIENTS = ["bright", "dim", "dark"];

const bodySchema = z.object({
  name: z.string().trim().min(1).max(TEMPLATE_NAME_MAX),
  // The roster as typed: "goblin x4" on its own line, the same shorthand the
  // console's Start a fight box takes.
  enemies: z.string().trim().min(1).max(2_000),
  battlefield: z.string().trim().max(TEMPLATE_HINT_MAX).default(""),
  notes: z.string().trim().max(TEMPLATE_NOTES_MAX).default(""),
  map: z.unknown().optional(),
});

// Each template carries its difficulty readout, computed fresh: the party
// levels up between the prep and the session, and a saved verdict would go
// quietly stale.
function withReadout(
  campaign: Parameters<typeof templateDifficulty>[0],
  templates: ReturnType<typeof listEncounterTemplates>,
) {
  return templates.map((template) => ({
    ...template,
    readout: templateDifficulty(campaign, template.enemies),
  }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({
    templates: withReadout(context.campaign, listEncounterTemplates(campaignId)),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "A prepared encounter needs a name and a roster." }, { status: 400 });
  }
  const roster = checkRoster(parseRoster(parsed.data.enemies));
  if ("error" in roster) {
    return Response.json({ error: roster.error }, { status: 400 });
  }
  const map = normalizeTemplateMap(parsed.data.map, { themes: MAP_THEMES, ambients: AMBIENTS });
  // The pure normalizer only shape-checks the id; whether the map is really
  // in this campaign's drawer is answered here, where the DB is.
  if (map.mapId && !getPreparedMap(campaignId, map.mapId)) {
    return Response.json(
      { error: "That prepared map is not in this campaign's drawer." },
      { status: 400 },
    );
  }
  const template = insertEncounterTemplate({
    campaignId,
    name: parsed.data.name,
    enemies: roster.rows,
    battlefield: parsed.data.battlefield,
    map,
    notes: parsed.data.notes,
    createdByUserId: context.user.id,
  });
  return Response.json(
    { template: { ...template, readout: templateDifficulty(context.campaign, template.enemies) } },
    { status: 201 },
  );
}
