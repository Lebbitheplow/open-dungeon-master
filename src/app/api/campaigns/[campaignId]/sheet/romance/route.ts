import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { ownSheetFor } from "@/lib/character-seat";
import { setOpenToAdvances } from "@/lib/db/sheets";
import { romanceEnabled } from "@/lib/dm/relationship-tools";
import { closeAdvancesToward } from "@/lib/dm/npc-advance";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUT: "Open to advances from NPCs" (issue 501), for one of the player's own
// characters at this table. Consent is the player's alone, so only the
// owner may set it (not the lead, not the DM, not for a companion), it is
// never synced back to the library character, and the sheet event carries
// it to the owner's screens only (src/lib/dm/sheet-view.ts). Switching it
// off stops it at once: any open moment closes and any advance waiting on
// an answer is withdrawn. Modeled on PUT /sheet/hand, not on the sheet
// patch: it is a preference, not an edit of the character.
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
  // Turning it on needs a table that plays romance; turning it off is
  // always allowed, so nobody is ever stuck opted in.
  if (parsed.data.open && !romanceEnabled(context.campaign)) {
    return Response.json({ error: "Romance is off at this table." }, { status: 409 });
  }
  const saved = setOpenToAdvances(sheet.id, parsed.data.open);
  if (!saved) {
    return Response.json({ error: "Could not save that." }, { status: 500 });
  }
  const withdrawn = parsed.data.open ? 0 : closeAdvancesToward(context.campaign, saved);
  publishPersisted(campaignId, "sheet_updated", { sheet: saved });
  return Response.json({ open: Boolean(saved.openToAdvances), withdrawn });
}
