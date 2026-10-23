import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { ownSheetFor } from "@/lib/character-seat";
import { commandedSheet } from "@/lib/dm/companion-command";
import { setHandLayout } from "@/lib/db/sheets";
import { HAND_SEATS, normalizeHandLayout } from "@/lib/battlemap/hand-layout";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUT: which battle cards a player keeps in the visible Hand, for one of
// their own characters (issue 231). A preference, never a rule: the cards are
// still dealt from the sheet and the live turn, and a card named here that
// the character does not hold is simply not shown. `layout: null` goes back
// to the automatic split. Each character keeps its own, and the sheet event
// carries it to the player's other screens.
const layoutSchema = z.object({
  characterId: z.string().min(1).max(80),
  layout: z
    .object({
      fan: z
        .array(z.string().min(1).max(160))
        .max(HAND_SEATS, `A hand holds ${HAND_SEATS} chosen cards; End turn keeps the ninth seat. Move a card to More first.`),
      known: z.array(z.string().min(1).max(160)).max(240).default([]),
    })
    .nullable(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = layoutSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Say which cards stay in the hand." },
      { status: 400 },
    );
  }
  // Only the player's own characters and the companions they command in
  // fights: another player's hand, or an ally the DM plays, is not theirs to
  // arrange.
  const sheet =
    ownSheetFor(campaignId, context.user.id, parsed.data.characterId) ??
    commandedSheet(context.campaign, context.user.id, parsed.data.characterId);
  if (!sheet) {
    return Response.json({ error: "That is not one of your characters." }, { status: 404 });
  }
  const layout = parsed.data.layout ? normalizeHandLayout(parsed.data.layout) : null;
  const saved = setHandLayout(sheet.id, layout);
  if (!saved) {
    return Response.json({ error: "Could not save the hand." }, { status: 500 });
  }
  publishPersisted(campaignId, "sheet_updated", { sheet: saved });
  return Response.json({ sheet: saved, layout: saved.handLayout ?? null });
}
