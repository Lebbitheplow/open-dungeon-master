import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { createNpcFromDraft, listNpcs } from "@/lib/db/npcs";
import { describePersonality, normalizeNpcDraft, relationGraph } from "@/lib/npcs/forge";
import { queueNpcPortrait } from "@/lib/portrait";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The NPC forge. GET is the roster plus the relation graph resolved out of
// it; POST writes a whole NPC, agency and all.
//
// The AI DM's own door into this table is upsertNpc, which registers a name
// out of narration and touches only the descriptive fields so it can never
// reset a grudge. This is the person's door, and it is DM-only prep, which
// is what makes it the workshop's cast list as well: a workshop is a
// campaigns row whose owner holds the DM seat.
//
// The body is not validated field by field here. normalizeNpcDraft is the
// one boundary an NPC crosses (src/lib/npcs/forge.ts), because the same
// rules have to hold for the panel, and duplicating them in a zod schema is
// how the two drift apart.
const bodySchema = z.object({
  draft: z.record(z.string(), z.unknown()),
  // Renders a face on the shared media queue. Off by default: it costs GPU
  // time on the same device the DM model runs on.
  portrait: z.boolean().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const npcs = listNpcs(campaignId);
  return Response.json({
    npcs,
    // Resolved server-side so the panel draws the same graph the roster
    // means, including the links that point at somebody nobody has written.
    graph: relationGraph(
      npcs.map((npc) => ({ name: npc.name, relations: npc.agency.relations })),
    ),
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
    return Response.json({ error: "Invalid NPC." }, { status: 400 });
  }
  const outcome = normalizeNpcDraft(parsed.data.draft);
  if ("error" in outcome) {
    return Response.json({ error: outcome.error }, { status: 400 });
  }
  // Names are how this table is looked up in narration, so two NPCs sharing
  // one would make every social check ambiguous. Refused rather than
  // numbered, unlike prep that is only ever read by a person.
  if (listNpcs(campaignId).some((npc) => npc.name.toLowerCase() === outcome.draft.name.toLowerCase())) {
    return Response.json(
      { error: `${outcome.draft.name} is already someone at this table.` },
      { status: 409 },
    );
  }

  const npc = createNpcFromDraft(campaignId, outcome.draft);
  if (parsed.data.portrait) {
    queueNpcPortrait({
      id: npc.id,
      campaignId,
      trait: npc.trait,
      // The axes as adjectives, which is what a render prompt can use;
      // "warmth: -2" would mean nothing to it.
      personality: describePersonality(outcome.draft.personality),
      genre: context.campaign.gameSettings.genre,
      worldPack: context.campaign.gameSettings.worldPack,
    });
  }
  return Response.json({ ok: true, npc }, { status: 201 });
}
