import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { ownSheetFor } from "@/lib/character-seat";
import { listSheets, setOpenToPacts } from "@/lib/db/sheets";
import { playerPactsPossible } from "@/lib/dm/pacts";
import { closeApproachesToward } from "@/lib/dm/pact-players";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUT: "Pacts may approach me" (issue 503 Phase 7), for one of the player's
// own characters at this table, modeled on PUT /sheet/romance. Consent is
// the player's alone, so only the owner may set it (not the lead, not the
// DM, not for a companion); it is never synced to the library character,
// and the sheet event carries it to the owner's screens only
// (src/lib/dm/sheet-view.ts). An agent seat is covered by its owner's
// choice. Switching it off withdraws any approach still waiting on an
// answer; a pact the character already joined is theirs to leave by telling
// the party.
const bodySchema = z.object({
  characterId: z.string().min(1).max(80),
  open: z.boolean(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say which character, and open or not." }, { status: 400 });
  }
  const sheet = ownSheetFor(campaignId, context.user.id, parsed.data.characterId);
  if (!sheet || sheet.isCompanion) {
    return Response.json({ error: "That is not one of your characters." }, { status: 404 });
  }
  // Turning it on needs a table where a pact could approach anyone;
  // turning it off is always allowed, so nobody is ever stuck opted in.
  if (parsed.data.open && !playerPactsPossible(context.campaign, listSheets(campaignId))) {
    return Response.json({ error: "Pacts never approach a player at this table." }, { status: 409 });
  }
  const saved = setOpenToPacts(sheet.id, parsed.data.open);
  if (!saved) {
    return Response.json({ error: "Could not save that." }, { status: 500 });
  }
  const withdrawn = parsed.data.open ? 0 : closeApproachesToward(context.campaign, saved.id);
  publishPersisted(campaignId, "sheet_updated", { sheet: saved });
  return Response.json({ open: Boolean(saved.openToPacts), withdrawn });
}
