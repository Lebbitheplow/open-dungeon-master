import { z } from "zod";
import { isErrorResponse, requirePrepAuthority } from "@/lib/campaign-api";
import { rosterLabel } from "@/lib/bestiary/index";
import { getEncounterTemplate, insertEncounterTemplate, updateEncounterTemplate } from "@/lib/db/encounter-templates";
import { tableAuthors } from "@/lib/db/homebrew";
import { worldEntities } from "@/lib/db/world-forge";
import {
  addToRoster,
  checkRoster,
  EMPTY_TEMPLATE_EXTRAS,
  EMPTY_TEMPLATE_MAP,
  normalizeTemplateExtras,
  rosterSize,
  TEMPLATE_NAME_MAX,
} from "@/lib/dm/encounter-template-logic";
import { parseRef } from "@/lib/worldforge/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One of the monsters a World entry links to, into a fight (audit finding
// WF-17): one more of it in an encounter the workshop has, or a new
// encounter named for the entry. That exact monster goes in: the roster
// gets its name when the name finds this same monster, and its ref when
// the name would find another (a homebrew "Goblin" beside the rulebook's),
// so the roster reads as it always has and fights as what was linked.
const bodySchema = z.object({
  monster: z.string().min(1).max(120),
  templateId: z.string().min(1).max(80).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string; ref: string }> }) {
  const { campaignId, ref: rawRef } = await params;
  const context = await requirePrepAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const ref = rawRef.includes("%") ? decodeURIComponent(rawRef) : rawRef;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parseRef(ref) || !parsed.success) {
    return Response.json({ error: "No such entry or monster." }, { status: 400 });
  }
  const entity = worldEntities(campaignId).find((entry) => entry.ref === ref);
  const bound = entity?.bound.find((record) => record.kind === "monster" && record.ref === parsed.data.monster && record.found);
  if (!entity || !bound) {
    return Response.json({ error: "That stat block is not linked to this entry." }, { status: 404 });
  }
  const setting = context.campaign.gameSettings;
  const authors = { userIds: tableAuthors(campaignId) };
  const label = rosterLabel(bound.ref, bound.name, setting, authors);

  if (parsed.data.templateId) {
    const template = getEncounterTemplate(parsed.data.templateId);
    if (!template || template.campaignId !== campaignId) {
      return Response.json({ error: "No such encounter here." }, { status: 404 });
    }
    const roster = checkRoster(addToRoster(template.enemies, label));
    if ("error" in roster) {
      return Response.json({ error: roster.error }, { status: 400 });
    }
    updateEncounterTemplate(template.id, {
      name: template.name,
      enemies: roster.rows,
      battlefield: template.battlefield,
      map: template.map,
      notes: template.notes,
      extras: normalizeTemplateExtras(template.extras, rosterSize(roster.rows)),
    });
    return Response.json({ templateId: template.id, added: label });
  }
  const made = insertEncounterTemplate({
    campaignId,
    name: entity.name.slice(0, TEMPLATE_NAME_MAX),
    enemies: [{ monster: label, count: 1 }],
    battlefield: "",
    map: EMPTY_TEMPLATE_MAP,
    notes: "",
    extras: EMPTY_TEMPLATE_EXTRAS,
    createdByUserId: context.user.id,
  });
  return Response.json({ templateId: made.id, added: label }, { status: 201 });
}
