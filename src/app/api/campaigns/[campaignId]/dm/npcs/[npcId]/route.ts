import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import {
  deleteNpc,
  getNpcById,
  listNpcs,
  setNpcArchived,
  setNpcPortrait,
  updateNpcFromDraft,
} from "@/lib/db/npcs";
import { describePersonality, normalizeNpcDraft } from "@/lib/npcs/forge";
import { isUploadedImagePath } from "@/lib/uploads";
import { queueNpcPortrait } from "@/lib/portrait";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One NPC. PATCH rewrites them, archives them, or gives them a face; DELETE
// forgets them outright.
//
// Archiving and deleting are different things and the panel offers both.
// Archiving takes an NPC out of the prompt's Active NPCs block and nothing
// else, so their attitude, their agency and everything the party did to them
// survives and a name mention brings them back
// (src/lib/dm/npc-archive-logic.ts). Deleting is for an NPC who was written
// by mistake.

const patchSchema = z.object({
  draft: z.record(z.string(), z.unknown()).optional(),
  archived: z.boolean().optional(),
  // A path this app wrote through /api/upload, or "" to take the face away.
  portraitUrl: z
    .string()
    .refine((value) => value === "" || isUploadedImagePath(value), "Not an uploaded file.")
    .optional(),
  // Render one instead of uploading one.
  generatePortrait: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; npcId: string }> },
) {
  const { campaignId, npcId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const existing = getNpcById(npcId);
  if (!existing || existing.campaignId !== campaignId) {
    return Response.json({ error: "That NPC is not at this table." }, { status: 404 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid NPC." }, { status: 400 });
  }
  const body = parsed.data;

  if (body.draft) {
    const outcome = normalizeNpcDraft(body.draft);
    if ("error" in outcome) {
      return Response.json({ error: outcome.error }, { status: 400 });
    }
    // A rename onto somebody else's name would make every social check
    // ambiguous, so it is refused; renaming to a different spelling of their
    // own name is fine and is what aliases are for.
    const clash = listNpcs(campaignId).some(
      (npc) => npc.id !== npcId && npc.name.toLowerCase() === outcome.draft.name.toLowerCase(),
    );
    if (clash) {
      return Response.json(
        { error: `${outcome.draft.name} is already someone else at this table.` },
        { status: 409 },
      );
    }
    if (!updateNpcFromDraft(campaignId, npcId, outcome.draft)) {
      return Response.json({ error: "That NPC is not at this table." }, { status: 404 });
    }
    if (body.generatePortrait) {
      queueNpcPortrait({
        id: npcId,
        campaignId,
        trait: outcome.draft.trait,
        personality: describePersonality(outcome.draft.personality),
        genre: context.campaign.gameSettings.genre,
        worldPack: context.campaign.gameSettings.worldPack,
      });
    }
  }

  if (body.portraitUrl !== undefined) {
    setNpcPortrait(npcId, body.portraitUrl);
  }
  if (body.archived !== undefined) {
    setNpcArchived(npcId, body.archived);
  }

  return Response.json({ ok: true, npc: getNpcById(npcId) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; npcId: string }> },
) {
  const { campaignId, npcId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const existing = getNpcById(npcId);
  if (!existing || existing.campaignId !== campaignId) {
    return Response.json({ error: "That NPC is not at this table." }, { status: 404 });
  }
  deleteNpc(npcId);
  return Response.json({ ok: true });
}
