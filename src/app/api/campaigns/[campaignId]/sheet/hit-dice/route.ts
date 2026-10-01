import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getCampaignById } from "@/lib/db/campaigns";
import { claimRestSong, inShortRestWindow } from "@/lib/db/clock";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetForUser, listSheets } from "@/lib/db/sheets";
import { partySongOfRestDie, spendHitDice } from "@/lib/dm/hit-dice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A player spends their own hit dice at the end of a short rest (SRD 5.1,
// Short Rest: the player rolls a die, adds Constitution, and may decide to
// spend another after each roll). The DM's take_rest opens the choice for
// every character whose player is at the table; it closes when the clock
// next moves. The server rolls each die and heals; a player never writes the
// spent count or the hit points themselves.
const spendSchema = z.object({
  dice: z.number().int().min(1).max(20),
});

const refuse = (error: string, status = 409) => Response.json({ error }, { status });

// Whether the asking player's character is in the short-rest window now, so
// the sheet offers "Spend a hit die" only while the engine would take it.
export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const sheet = getSheetForUser(campaignId, context.user.id);
  const open = Boolean(sheet && !getActiveEncounter(campaignId) && inShortRestWindow(campaignId, sheet.id));
  return Response.json({ open });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const sheet = getSheetForUser(campaignId, context.user.id);
  if (!sheet) {
    return Response.json({ error: "You have no character in this campaign." }, { status: 404 });
  }
  const parsed = spendSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Send the number of hit dice to spend, 1 or more." }, { status: 400 });
  }
  if (getActiveEncounter(campaignId)) {
    return refuse("Hit dice are spent at the end of a short rest, and a fight is going on.");
  }
  if (!inShortRestWindow(campaignId, sheet.id)) {
    return refuse(
      `Hit dice are spent at the end of a short rest. ${sheet.name} is not resting now; ask the DM for a short rest and spend them when it ends.`,
    );
  }
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  // Song of Rest: one extra die for a creature that spends hit dice, once
  // per rest, whoever in the party can sing it.
  const song = partySongOfRestDie(listSheets(campaignId));
  const songDie = song && claimRestSong(campaignId, sheet.id) ? song : null;
  const spent = spendHitDice({
    campaign,
    turnId: null,
    sheetId: sheet.id,
    requested: parsed.data.dice,
    songDie,
    reason: `Short rest: hit dice spent by ${context.user.username}`,
    requestedBy: "player",
  });
  if ("error" in spent) {
    return refuse(spent.error);
  }
  return Response.json({ ok: true, ...spent });
}
