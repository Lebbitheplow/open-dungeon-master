import { z } from "zod";
import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { refusal } from "@/lib/characters/admit";
import { admitPregen } from "@/lib/characters/seat-preview";
import { announceMidGameJoin } from "@/lib/characters/mid-game-join";
import { createCharacter } from "@/lib/db/characters";
import { createSheet, getSheetForUser } from "@/lib/db/sheets";
import { seatAddedSheet } from "@/lib/character-seat";
import { publishPersisted } from "@/lib/events";
import { queueLibraryPortrait } from "@/lib/portrait";
import { pregenById } from "@/lib/starter/pregens";
import { seatPicksSchema } from "@/lib/characters/seat-picks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The hero, and the owed choices picked on the confirm sheet
// (src/lib/characters/seat-picks.ts).
const pickSchema = z.object({ id: z.string().trim().min(1).max(40), picks: seatPicksSchema.optional() });

// A ready-made hero takes a seat (src/lib/starter/pregens.ts): the same
// door as a character the builder made, so the sheet is judged by the
// table's rules, saved to the player's library and copied in.
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
  // The same door rule as a built character (POST /sheet): a table that
  // allows several characters per player lets a ready-made hero in beside
  // the one they have.
  if (getSheetForUser(campaignId, context.user.id) && context.campaign.gameSettings.multiCharacter === "off") {
    return Response.json({ error: "You already have a character in this campaign." }, { status: 409 });
  }
  const parsed = pickSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success && parsed.error.issues.some((issue) => issue.path[0] === "picks")) {
    return Response.json({ error: "Those picks could not be read." }, { status: 400 });
  }
  const pregen = parsed.success ? pregenById(parsed.data.id) : null;
  if (!pregen) {
    return Response.json({ error: "No such hero." }, { status: 404 });
  }
  // The door and the owed improvements are src/lib/characters/seat-preview.ts,
  // shared with the confirm sheet the player reads before this.
  const admitted = admitPregen(pregen, context.campaign, context.user.id, parsed.success ? parsed.data.picks : null);
  if (!admitted.ok) {
    return refusal(admitted.problems);
  }
  const seated = admitted.sheet;
  const libraryCharacter = createCharacter(context.user.id, context.campaign.startingLevel, seated);
  const sheet = createSheet(campaignId, context.user.id, context.campaign.startingLevel, seated, libraryCharacter.id);
  admitted.settle();
  queueLibraryPortrait(libraryCharacter);
  seatAddedSheet(context.campaign, context.user.id, sheet.id);
  publishPersisted(campaignId, "sheet_updated", { sheet });
  announceMidGameJoin(context, sheet);
  return Response.json({ sheet }, { status: 201 });
}
