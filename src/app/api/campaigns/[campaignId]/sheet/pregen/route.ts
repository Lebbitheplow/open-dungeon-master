import { z } from "zod";
import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { admitSheet, refusal } from "@/lib/characters/admit";
import { createCharacter } from "@/lib/db/characters";
import { createSheet, getSheetForUser } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { queueLibraryPortrait } from "@/lib/portrait";
import { createSheetSchema } from "@/lib/schemas/sheet";
import { pregenById } from "@/lib/starter/pregens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pickSchema = z.object({ id: z.string().trim().min(1).max(40) });

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
  if (getSheetForUser(campaignId, context.user.id)) {
    return Response.json({ error: "You already have a character in this campaign." }, { status: 409 });
  }
  const parsed = pickSchema.safeParse(await request.json().catch(() => ({})));
  const pregen = parsed.success ? pregenById(parsed.data.id) : null;
  if (!pregen) {
    return Response.json({ error: "No such hero." }, { status: 404 });
  }
  const input = createSheetSchema.parse(pregen.sheet);
  const admitted = admitSheet({
    door: "table",
    level: context.campaign.startingLevel,
    sheet: input,
    userId: context.user.id,
    campaign: context.campaign,
  });
  if (!admitted.ok) {
    return refusal(admitted.problems);
  }
  const libraryCharacter = createCharacter(context.user.id, context.campaign.startingLevel, admitted.sheet);
  const sheet = createSheet(campaignId, context.user.id, context.campaign.startingLevel, admitted.sheet, libraryCharacter.id);
  admitted.settle();
  queueLibraryPortrait(libraryCharacter);
  publishPersisted(campaignId, "sheet_updated", { sheet });
  return Response.json({ sheet }, { status: 201 });
}
