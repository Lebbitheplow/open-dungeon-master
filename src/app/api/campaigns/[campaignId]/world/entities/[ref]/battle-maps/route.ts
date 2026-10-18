import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { resolveMonster } from "@/lib/bestiary/index";
import { deleteEncounterTemplate, insertEncounterTemplate } from "@/lib/db/encounter-templates";
import { tableAuthors } from "@/lib/db/homebrew";
import { deletePreparedMap } from "@/lib/db/prepared-maps";
import { linkToPlace, worldEntities } from "@/lib/db/world-forge";
import { createLibraryMap } from "@/lib/dm/map-library";
import { EMPTY_TEMPLATE_EXTRAS, EMPTY_TEMPLATE_MAP, TEMPLATE_NAME_MAX } from "@/lib/dm/encounter-template-logic";
import { publishEphemeral } from "@/lib/events";
import { recordsChanged } from "@/lib/workshop/record-events";
import { parseRef } from "@/lib/worldforge/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A place's own battle map or encounter, made and linked in one step (M4 of
// the WorldForge plan, a pin's or a place's "Create battle map"). The place
// stays the place it is: nothing here makes a location.
//
// "map" is a blank battle map named for the place, in the map library,
// ready for its walls, doors and light to be drawn. Nothing is read from
// the place's Atlas picture: a picture shows what a place looks like, and
// only geometry someone authored or imported says where its walls are.
// "encounter" is a prepared fight named for the place, with its first foe
// (a fight needs one) and, when asked, drawn on one of the place's maps.
const bodySchema = z.discriminatedUnion("make", [
  z.object({ make: z.literal("map") }),
  z.object({
    make: z.literal("encounter"),
    monster: z.string().trim().min(1).max(120),
    mapId: z.string().min(1).max(80).optional(),
  }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string; ref: string }> }) {
  const { campaignId, ref: rawRef } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const ref = rawRef.includes("%") ? decodeURIComponent(rawRef) : rawRef;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (parseRef(ref)?.shelf !== "location" || !parsed.success) {
    return Response.json({ error: "Only a place has battle maps and encounters." }, { status: 400 });
  }
  const place = worldEntities(campaignId).find((entry) => entry.ref === ref);
  if (!place) {
    return Response.json({ error: "No such place in this world." }, { status: 404 });
  }
  const name = place.name.slice(0, TEMPLATE_NAME_MAX);
  const body = parsed.data;

  if (body.make === "map") {
    const made = createLibraryMap(context.campaign, { name: name.slice(0, 80), blank: "ground" });
    if ("error" in made) {
      return Response.json({ error: made.error }, { status: 400 });
    }
    const linked = linkToPlace(campaignId, ref, { kind: "map", ref: made.map.id });
    if ("error" in linked) {
      // A map nobody can find from the place is not what was asked for.
      deletePreparedMap(campaignId, made.map.id);
      return Response.json({ error: linked.error }, { status: linked.status ?? 400 });
    }
    changed(campaignId);
    return Response.json({ entity: linked.entity, made: { kind: "map", id: made.map.id } }, { status: 201 });
  }

  // The first foe goes in as the encounter route puts a linked monster in:
  // by name when the name finds this same monster, by its ref otherwise.
  const setting = context.campaign.gameSettings;
  const authors = { userIds: tableAuthors(campaignId) };
  const monster = resolveMonster(body.monster, setting, authors);
  if (!monster) {
    return Response.json({ error: "No monster by that name at this table." }, { status: 400 });
  }
  const byName = resolveMonster(monster.reskinName ?? monster.baseName, setting, authors);
  const label = byName && byName.slug === monster.slug ? monster.reskinName ?? monster.baseName : monster.slug;
  const maps = new Set(place.bound.filter((record) => record.kind === "map" && record.found).map((record) => record.ownId));
  if (body.mapId && !maps.has(body.mapId)) {
    return Response.json({ error: "That battle map is not one of this place's." }, { status: 400 });
  }
  const template = insertEncounterTemplate({
    campaignId,
    name,
    enemies: [{ monster: label, count: 1 }],
    battlefield: "",
    map: { ...EMPTY_TEMPLATE_MAP, mapId: body.mapId ?? null },
    notes: "",
    extras: EMPTY_TEMPLATE_EXTRAS,
    createdByUserId: context.user.id,
  });
  const linked = linkToPlace(campaignId, ref, { kind: "encounter", ref: template.id });
  if ("error" in linked) {
    deleteEncounterTemplate(template.id);
    return Response.json({ error: linked.error }, { status: linked.status ?? 400 });
  }
  changed(campaignId);
  return Response.json({ entity: linked.entity, made: { kind: "encounter", id: template.id } }, { status: 201 });
}

function changed(campaignId: string) {
  publishEphemeral(campaignId, "world_updated", { at: Date.now() });
  recordsChanged(campaignId, "location", "world");
}
