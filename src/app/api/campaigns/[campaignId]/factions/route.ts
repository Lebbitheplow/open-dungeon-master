import { isErrorResponse, requireMember, requireStoryAuthority, steersStory } from "@/lib/campaign-api";
import { insertFaction, listFactions } from "@/lib/db/factions";
import { listNpcs } from "@/lib/db/npcs";
import { getParty } from "@/lib/db/party";
import { normalizeFactionAttitude, reputationLabel } from "@/lib/dm/faction-logic";
import { publishEphemeral } from "@/lib/events";
import { isUploadedImagePath } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Factions (docs/vtt-parity-implementation-plan.md section 6). Everyone
// reads the table's view: name, blurb, attitude, standing in words and the
// members they know of. Goal and power are the DM's.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const dm = steersStory(context);
  const reputation = getParty(campaignId).reputation;
  const npcs = listNpcs(campaignId).filter((npc) => !npc.archived);
  const factions = listFactions(campaignId).map((faction) => {
    const standing = reputation[faction.id] ?? 0;
    const members = npcs.filter((npc) => npc.factionId === faction.id).map((npc) => ({ id: npc.id, name: npc.name, portraitUrl: npc.portraitUrl }));
    const base = {
      id: faction.id,
      name: faction.name,
      blurb: faction.blurb,
      attitude: faction.attitude,
      tags: faction.tags,
      portraitPath: faction.portraitPath,
      standing,
      standingLabel: reputationLabel(standing),
      members,
    };
    return dm ? { ...base, goal: faction.goal, power: faction.power } : base;
  });
  return Response.json({ factions });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) {
    return Response.json({ error: "A faction needs a name." }, { status: 400 });
  }
  if (raw.portraitPath && !isUploadedImagePath(raw.portraitPath)) {
    return Response.json({ error: "Not an uploaded file." }, { status: 400 });
  }
  const faction = insertFaction(campaignId, {
    name,
    blurb: typeof raw.blurb === "string" ? raw.blurb : "",
    goal: typeof raw.goal === "string" ? raw.goal : "",
    attitude: normalizeFactionAttitude(raw.attitude),
    power: typeof raw.power === "number" ? raw.power : 1,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : [],
    portraitPath: typeof raw.portraitPath === "string" ? raw.portraitPath : "",
  });
  publishEphemeral(campaignId, "factions_updated", { at: Date.now() });
  return Response.json({ faction });
}
