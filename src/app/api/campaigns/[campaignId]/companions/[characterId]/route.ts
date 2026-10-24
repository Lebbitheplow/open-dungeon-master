import { z } from "zod";
import { conscienceForbidsCommand } from "@/lib/dm/conscience";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { getActiveEncounter } from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getSheetById, listSheets, setCompanionCommander } from "@/lib/db/sheets";
import { commandable, commandingPlayers } from "@/lib/dm/companion-command";
import { handleDismissCompanion } from "@/lib/dm/companion-tools";
import { setInitiativeFloor, settleTurn, turnHolder } from "@/lib/dm/encounter-tools";
import { requestDmTurn } from "@/lib/dm/loop";
import { publishPersisted, publishWithSeq } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Party-lead removal of an AI companion: same server path as the DM's
// dismiss_companion tool, plus a table note so the departure is visible and
// the DM can narrate it on the next turn.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; characterId: string }> },
) {
  const { campaignId, characterId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const holder = turnHolder(campaignId);
  const result = handleDismissCompanion(
    context.campaign,
    JSON.stringify({ characterId, reason: "the party lead sent them on their way" }),
    listSheets(campaignId),
  );
  // A companion dismissed on their own turn takes no turn with them.
  settleTurn(context.campaign, holder);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    glyph: "system-party",
    content: `The party lead sends ${String(result.dismissed)} on their way; they leave the party.`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
  requestDmTurn(campaignId);
  return Response.json({ ok: true });
}

const commandSchema = z.object({ commandedBy: z.string().trim().min(1).max(120).nullable() });

// Who takes this companion's turns in a fight (src/lib/dm/companion-command.ts):
// a player at the table, or null for the DM. Whoever runs the story decides,
// as they recruit and dismiss. Out of fights the DM plays the companion
// whatever this says. Changed on the companion's own turn, the floor follows
// at once, and a turn handed back to the DM is played.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; characterId: string }> },
) {
  const { campaignId, characterId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = commandSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say who commands them in fights: a player, or nobody for the DM." }, { status: 400 });
  }
  const sheet = getSheetById(characterId);
  if (!sheet || sheet.campaignId !== campaignId || !commandable(sheet)) {
    return Response.json({ error: "That is not a companion at this table." }, { status: 404 });
  }
  const commander = parsed.data.commandedBy;
  if (commander && !commandingPlayers(context.campaign).includes(commander)) {
    return Response.json({ error: "Only a player at the table can command a companion." }, { status: 400 });
  }
  // Where companions may turn, one who has warned the party takes nobody's
  // orders until its conscience climbs back (issue 503).
  if (commander && conscienceForbidsCommand(context.campaign, sheet)) {
    return Response.json(
      { error: `${sheet.name} will not take orders while what the party did stands between them. Their conscience has to climb back first.` },
      { status: 409 },
    );
  }
  const updated = setCompanionCommander(sheet.id, commander);
  if (!updated) {
    return Response.json({ error: "Could not change who commands them." }, { status: 500 });
  }
  publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  const encounter = getActiveEncounter(campaignId);
  const current = encounter?.orderReady ? encounter.order[encounter.turnIndex] : undefined;
  if (encounter && current?.kind === "pc" && current.characterId === sheet.id) {
    setInitiativeFloor(context.campaign, encounter);
    publishPersisted(campaignId, "encounter_updated", { encounter: activePublicEncounter(campaignId) });
    if (!commander) {
      requestDmTurn(campaignId);
    }
  }
  return Response.json({ sheet: updated });
}
