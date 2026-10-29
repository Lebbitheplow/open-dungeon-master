import { z } from "zod";
import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { refusal } from "@/lib/characters/admit";
import { seatPicksSchema } from "@/lib/characters/seat-picks";
import { admitLibraryForSeat } from "@/lib/characters/seat-preview";
import { announceMidGameJoin } from "@/lib/characters/mid-game-join";
import { HERO_DOOR_SHUT, heroDoorFor } from "@/lib/characters/hero-door";
import { seatAddedSheet } from "@/lib/character-seat";
import { createCharacter, setPregenOrigin } from "@/lib/db/characters";
import { claimPregen, claimRefusal, offeredPregenFor } from "@/lib/db/pregen-offers";
import { createSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { queueLibraryPortrait } from "@/lib/portrait";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The pregen, and the owed choices picked on the confirm sheet
// (src/lib/characters/seat-picks.ts).
const bodySchema = z.object({
  id: z.string().trim().min(1).max(80),
  picks: seatPicksSchema.optional(),
});

// A player takes a seat with a pregen the table's DM offers (option B of
// sharing a DM's pregens: the DM ticks which, in the workshop's Party
// panel). Everything is checked here, never taken from the client: the
// pregen is ticked, its owner runs this table, the table was made from its
// workshop, and nobody holds it here yet (src/lib/db/pregen-offers.ts). The
// player gets a copy: the DM's sheet adapted to the table's level through
// the door a library character enters play by, saved to the player's own
// library and seated. The DM's pregen is never changed.
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
    return Response.json({ error: "The GM seat plays no character." }, { status: 400 });
  }
  const door = heroDoorFor(context.campaign, context.user.id);
  if (!door.open) {
    return Response.json({ error: HERO_DOOR_SHUT }, { status: 409 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.some((issue) => issue.path[0] === "picks") ? "Those picks could not be read." : "Pick a hero." },
      { status: 400 },
    );
  }
  // Unticked, another table's, a companion, or none at all: no such hero.
  // A DM's own pregens are in their own library, where they take them from.
  const offer = offeredPregenFor(campaignId, parsed.data.id);
  if (!offer || offer.character.userId === context.user.id) {
    return Response.json({ error: "No such hero." }, { status: 404 });
  }
  const taken = claimRefusal(offer, context.user.id);
  if (taken) {
    return Response.json({ error: taken }, { status: 409 });
  }
  const level = door.level;
  const admitted = admitLibraryForSeat(offer.character, door.campaign, context.user.id, level, parsed.data.picks);
  if (!admitted.ok) {
    return refusal(admitted.problems);
  }
  const libraryCharacter = createCharacter(context.user.id, level, admitted.sheet);
  // The copy is the pregen's wherever it goes: seated again, edited in the
  // lobby or duplicated, it still holds this pregen at this table.
  setPregenOrigin(libraryCharacter.id, offer.character.id);
  const sheet = createSheet(campaignId, context.user.id, level, admitted.sheet, libraryCharacter.id);
  admitted.settle?.();
  claimPregen(campaignId, offer.character.id, context.user.id, sheet.id);
  queueLibraryPortrait(libraryCharacter);
  seatAddedSheet(context.campaign, context.user.id, sheet.id);
  publishPersisted(campaignId, "sheet_updated", { sheet });
  announceMidGameJoin(context, sheet, door.fallen?.name);
  return Response.json({ sheet }, { status: 201 });
}
