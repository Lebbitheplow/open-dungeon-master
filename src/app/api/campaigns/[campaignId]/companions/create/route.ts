import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import { getCharacterForUser } from "@/lib/db/characters";
import { adaptSheetToLevel } from "@/lib/characters/adapt";
import { insertCampaignMessage } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";
import { companionMode, finalizeNewCompanion, listCompanions } from "@/lib/dm/companion-tools";
import { requestDmTurn } from "@/lib/dm/loop";
import { createSheetSchema } from "@/lib/schemas/sheet";
import { publishWithSeq } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Either a sheet built here and now, or one out of the user's own library.
// A library companion is the same object a player character is, adapted to
// the level this table plays at by the same code (src/lib/characters/
// adapt.ts), which is exactly why the library gained a role column instead
// of a second table.
const bodySchema = z.union([
  z.object({ sheet: createSheetSchema }),
  z.object({ libraryCharacterId: z.string().min(1) }),
]);

// The party lead (or solo player) builds a lasting party companion from the
// character creator. Only party companions come through here, so it is offered
// only where the table allows them (companion mode 'full'); guests-only and
// off tables reject. In an active session the DM is nudged to introduce them.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const campaign = context.campaign;

  if (companionMode(campaign) !== "full") {
    return Response.json(
      { error: "Building a party companion is not available at this table." },
      { status: 409 },
    );
  }

  const partyCompanions = listCompanions(listSheets(campaignId)).filter(
    (sheet) => sheet.companionKind !== "guest",
  ).length;
  if (partyCompanions >= campaign.gameSettings.maxCompanions) {
    return Response.json(
      { error: "The party already has its full number of companions." },
      { status: 409 },
    );
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid companion sheet." },
      { status: 400 },
    );
  }

  // Level is decided server-side so no client can inflate it: match the party
  // (average of the real players' characters), the same rule the AI path uses.
  const partyLevels = listSheets(campaignId)
    .filter((sheet) => !sheet.isCompanion)
    .map((sheet) => sheet.level);
  const level = partyLevels.length
    ? Math.max(1, Math.min(20, Math.round(partyLevels.reduce((sum, n) => sum + n, 0) / partyLevels.length)))
    : campaign.startingLevel;

  // The library entry has to be one of this user's own, and one they filed
  // as a companion: instantiating somebody's player character as an ally the
  // DM plays would take a character out from under them.
  let input;
  if ("libraryCharacterId" in parsed.data) {
    const character = getCharacterForUser(context.user.id, parsed.data.libraryCharacterId);
    if (!character || character.role !== "companion") {
      return Response.json({ error: "That companion is not in your library." }, { status: 404 });
    }
    input = adaptSheetToLevel(character.sheet, character.level, level);
  } else {
    input = parsed.data.sheet;
  }

  const { sheet } = finalizeNewCompanion(campaign, level, input, "party", input.backstory ?? "");

  // Active session: a table note so the DM writes them into the scene next
  // turn. In the lobby the opening narration already reads every party sheet.
  if (campaign.status === "active") {
    const seq = allocateSeq(campaignId);
    const message = insertCampaignMessage({
      campaignId,
      seq,
      authorType: "system",
      content: `${context.user.username} brings a companion into the party: ${sheet.name}, a ${sheet.race.replaceAll("_", " ")} ${sheet.class}. Introduce them into the scene at the next natural moment.`,
    });
    publishWithSeq(campaignId, seq, "message_added", { message });
    requestDmTurn(campaignId);
  }

  return Response.json({ ok: true, sheet }, { status: 201 });
}
