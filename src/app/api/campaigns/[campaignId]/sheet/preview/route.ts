import { z } from "zod";
import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { previewBuiltJoin, previewLibraryJoin, previewPregenJoin, type JoinPreview } from "@/lib/characters/seat-preview";
import { companionRoleRefusal, getCharacterForUser } from "@/lib/db/characters";
import { getSheetForUser, listSheetsForUser } from "@/lib/db/sheets";
import { createSheetSchema } from "@/lib/schemas/sheet";
import { pregenById } from "@/lib/starter/pregens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const previewSchema = z
  .object({
    libraryCharacterId: z.string().min(1).max(80).optional(),
    pregenId: z.string().trim().min(1).max(40).optional(),
    // A character the builder just made for this table ("Help me build" on
    // the hero chooser), judged as POST or PUT /sheet would judge it.
    sheet: createSheetSchema.optional(),
    // join = a first seat (POST /sheet); replace = a lobby switch (PUT
    // /sheet), which gives up the current character first.
    flow: z.enum(["join", "replace"]).default("join"),
  })
  .refine((body) => [body.libraryCharacterId, body.pregenId, body.sheet].filter(Boolean).length === 1, {
    message: "Pick one hero.",
  });

// The confirm sheet before a hero takes its seat (backlog F6): the hero at
// the table's level, what joining changes, and the table's rules check, by
// the same code the join runs (src/lib/characters/seat-preview.ts). Nothing
// is stored and no roll is spent; the join itself is still POST or PUT
// /sheet, or POST /sheet/pregen, and checks again.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!capsFor(context).needsCharacter) {
    return Response.json({ error: "The DM seat plays no character." }, { status: 400 });
  }
  const parsed = previewSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message || "Pick a hero." }, { status: 400 });
  }
  const { libraryCharacterId, pregenId, sheet, flow } = parsed.data;

  let preview: JoinPreview;
  let alreadyHere = false;
  if (libraryCharacterId) {
    const character = getCharacterForUser(context.user.id, libraryCharacterId);
    if (!character) {
      return Response.json({ error: "Character not found in your library." }, { status: 404 });
    }
    if (character.role === "companion") {
      return Response.json({ error: companionRoleRefusal(character) }, { status: 400 });
    }
    preview = previewLibraryJoin(character, context.campaign, context.user.id);
    // A hero already at this table is selected again, not copied twice
    // (instantiateIntoCampaign), so a join changes nothing about it.
    alreadyHere = listSheetsForUser(campaignId, context.user.id).some(
      (sheet) => sheet.libraryCharacterId === character.id && !sheet.isCompanion,
    );
  } else if (sheet) {
    preview = previewBuiltJoin(sheet, context.campaign, context.user.id);
  } else {
    const pregen = pregenById(pregenId ?? "");
    if (!pregen) {
      return Response.json({ error: "No such hero." }, { status: 404 });
    }
    preview = previewPregenJoin(pregen, context.campaign, context.user.id);
  }

  // The door rules the join answers with before it reads the sheet, so the
  // sheet does not offer a seat the join will refuse.
  const doorProblems: string[] = [];
  if (flow === "join" && !alreadyHere && getSheetForUser(campaignId, context.user.id) && context.campaign.gameSettings.multiCharacter === "off") {
    doorProblems.push("You already have a character in this campaign.");
  }
  if (flow === "replace" && context.campaign.status !== "lobby") {
    doorProblems.push("Characters can only be changed in the lobby.");
  }
  if (doorProblems.length) {
    preview = { ...preview, ok: false, problems: [...doorProblems, ...preview.problems] };
  }
  return Response.json({ preview: { ...preview, alreadyHere } });
}
