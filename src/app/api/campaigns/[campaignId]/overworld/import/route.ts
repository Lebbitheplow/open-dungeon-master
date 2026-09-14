import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { insertKnownLocation } from "@/lib/db/locations";
import { overworldView, replaceOverworldTerrain, setOverworldAnchor, setOverworldLabels, setOverworldPaths } from "@/lib/db/overworld";
import { isWatabouCity, parseWatabouCity } from "@/lib/battlemap/watabou";
import { AZGAAR_LIMITS, importAzgaar } from "@/lib/overworld/azgaar";
import { getOverworld } from "@/lib/db/overworld";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A map drawn in Azgaar's Fantasy Map Generator, read into the region grid
// (src/lib/overworld/azgaar.ts). The files arrive as text; the importer
// decides what each feature is. What it makes replaces the ground and the
// lines over it, and each burg becomes a known place anchored where the
// file put it. Pins, labels, notes and the backdrop are carried the way a
// reroll carries them (src/lib/db/overworld.ts).

const bodySchema = z.object({
  files: z.array(z.string().max(AZGAAR_LIMITS.maxChars)).min(1).max(AZGAAR_LIMITS.maxFiles),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Hand over one or more GeoJSON files." }, { status: 400 });
  }
  const current = getOverworld(campaignId);
  // A Watabou city (docs/vtt-parity-implementation-plan.md 12.2) is not a
  // region: it lands as roads and district names around the party's spot
  // (or the map's centre) and becomes a known place there.
  const cityText = parsed.data.files.find((text) => {
    try {
      return isWatabouCity(JSON.parse(text));
    } catch {
      return false;
    }
  });
  if (cityText) {
    const at = current.partyXy ?? { x: Math.floor(current.width / 2), y: Math.floor(current.height / 2) };
    const city = parseWatabouCity(JSON.parse(cityText), { width: current.width, height: current.height }, at);
    if ("error" in city) {
      return Response.json({ error: city.error }, { status: 400 });
    }
    setOverworldPaths(campaignId, [...current.paths, ...city.city.paths]);
    setOverworldLabels(campaignId, [...current.labels, ...city.city.labels]);
    let places = 0;
    if (city.city.name) {
      const location = insertKnownLocation({ campaignId, name: city.city.name, layoutDescription: city.city.blurb });
      if (location) {
        setOverworldAnchor(campaignId, location.id, at);
        places = 1;
      }
    }
    return Response.json({
      ...overworldView(campaignId, true),
      summary: { cells: 0, places, rivers: city.city.paths.filter((path) => path.kind === "river").length, routes: city.city.paths.filter((path) => path.kind === "road").length },
    });
  }
  const read = importAzgaar(
    parsed.data.files,
    { width: parsed.data.width, height: parsed.data.height },
    { width: current.width, height: current.height },
  );
  if ("error" in read) {
    return Response.json({ error: read.error }, { status: 400 });
  }
  const replaced = replaceOverworldTerrain(campaignId, read);
  if ("error" in replaced) {
    return Response.json({ error: replaced.error }, { status: 400 });
  }
  // Burgs become places. insertKnownLocation hands back the existing row
  // for a name already on the map, so an import run twice moves the marker
  // rather than doubling the place.
  let places = 0;
  for (const place of read.places) {
    const location = insertKnownLocation({
      campaignId,
      name: place.name,
      layoutDescription: place.blurb,
    });
    if (location) {
      setOverworldAnchor(campaignId, location.id, place.at);
      places += 1;
    }
  }
  return Response.json({
    ...overworldView(campaignId, true),
    summary: { ...read.summary, places },
  });
}
