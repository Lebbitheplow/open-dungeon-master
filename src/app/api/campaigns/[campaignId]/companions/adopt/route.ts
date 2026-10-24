import { closeAdvancesToward } from "@/lib/dm/npc-advance";
import { companionNpcFor } from "@/lib/db/companion-npcs";
import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { allocateSeq, setMemberActiveCharacter } from "@/lib/db/campaigns";
import { insertCharacterEvent } from "@/lib/db/character-events";
import { getCharacter } from "@/lib/db/characters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { getActiveEncounter, saveEncounter } from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import {
  adoptSheetAsCompanion,
  getSheetById,
  getSheetForUser,
  listSheetsForUser,
  setCompanionCommander,
  setOpenToAdvances,
} from "@/lib/db/sheets";
import { defaultCommander } from "@/lib/dm/companion-command";
import { createCompanionUser } from "@/lib/db/users";
import { lastingCompanionProblem } from "@/lib/dm/companion-tools";
import { publishEphemeral, publishPersisted, publishWithSeq } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ sheetId: z.string().trim().min(1) });

// The repair for a campaign copy seated through the wrong door (issue 192).
// Before the player-character routes checked the role, a library character
// filed as an ally the DM plays could be chosen as a player character, which
// left a human-owned sheet the AI DM never took turns for. Whoever runs the
// story hands it to the DM here. The sheet keeps its id and everything play
// wrote on it; only its owner and its companion mark change, so a fight in
// progress keeps its initiative slot and its token. Only a sheet whose
// library row says companion qualifies: this is no way to take a player's
// character from them. The table's companion setting and cap hold as they
// do for a companion built from scratch.
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

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say which character." }, { status: 400 });
  }
  const sheet = getSheetById(parsed.data.sheetId);
  if (!sheet || sheet.campaignId !== campaignId) {
    return Response.json({ error: "That character is not at this table." }, { status: 404 });
  }
  if (sheet.isCompanion) {
    return Response.json({ error: `${sheet.name} is already an ally the DM plays.` }, { status: 409 });
  }
  const library = sheet.libraryCharacterId ? getCharacter(sheet.libraryCharacterId) : null;
  if (!library || library.role !== "companion") {
    return Response.json(
      {
        error: `${sheet.name} is a player's character. Only a character whose library entry is an ally the DM plays can be handed to the DM.`,
      },
      { status: 403 },
    );
  }
  // The table's companion setting and cap, said with the setting that
  // holds it and the way to allow it (issue 209), the same words the Party
  // panel shows beside the button. A stale client or a direct call hears
  // them too.
  const blocked = lastingCompanionProblem(campaign);
  if (blocked) {
    return Response.json(
      {
        error: `${sheet.name} cannot be handed to the DM yet. ${blocked.reason} ${blocked.remedy}`,
        code: blocked.code,
        reason: blocked.reason,
        remedy: blocked.remedy,
      },
      { status: 409 },
    );
  }

  const formerOwnerId = sheet.userId;
  // Whether this was the character its player was running, read before the
  // row changes hands.
  const wasRunning = getSheetForUser(campaignId, formerOwnerId)?.id === sheet.id;
  const bot = createCompanionUser(sheet.name);
  // Like every party companion, it follows the one player of a table the AI
  // runs in fights (src/lib/dm/companion-command.ts).
  const handed = adoptSheetAsCompanion(sheet.id, bot.id, sheet.personality || sheet.backstory || "");
  const adopted = handed ? setCompanionCommander(handed.id, defaultCommander(campaign, "party")) ?? handed : null;
  if (!adopted) {
    return Response.json({ error: "Could not hand the character to the DM." }, { status: 500 });
  }
  // The person behind the companion's sheet (#503 Phase 0.1). A character
  // the DM now plays answers no advance any more: their opt-in goes with
  // the player who made it.
  companionNpcFor(adopted);
  setOpenToAdvances(adopted.id, false);
  closeAdvancesToward(campaign, adopted);

  // The player runs the next of their characters, or none; their client
  // hears which, as it does after a switch.
  if (wasRunning) {
    const remaining = listSheetsForUser(campaignId, formerOwnerId).find((entry) => !entry.isCompanion);
    setMemberActiveCharacter(campaignId, formerOwnerId, remaining?.id ?? null);
    publishEphemeral(campaignId, "roster_updated", {
      userId: formerOwnerId,
      activeSheetId: remaining?.id ?? "",
      at: Date.now(),
    });
  }

  // Mid-fight the slot is the same slot; it answers to the bot now, which is
  // what the turn backstop reads (src/lib/dm/encounter-tools.ts).
  const encounter = getActiveEncounter(campaignId);
  if (encounter) {
    let changed = false;
    for (const entry of encounter.order) {
      if (entry.kind === "pc" && entry.characterId === sheet.id && entry.userId !== bot.id) {
        entry.userId = bot.id;
        changed = true;
      }
    }
    if (changed) {
      saveEncounter(encounter);
      publishPersisted(campaignId, "encounter_updated", {
        encounter: activePublicEncounter(campaignId),
      });
    }
  }

  publishPersisted(campaignId, "sheet_updated", { sheet: adopted });
  insertCharacterEvent({
    libraryCharacterId: library.id,
    campaignCharacterId: sheet.id,
    campaignId,
    seq: allocateSeq(campaignId),
    kind: "story",
    summary: `${sheet.name} travels with the party as an ally the DM plays.`,
  });
  // In play, a table note so the DM knows whose turns are now its own. In the
  // lobby the opening narration reads every party sheet anyway.
  if (campaign.status === "active") {
    const seq = allocateSeq(campaignId);
    const message = insertCampaignMessage({
      campaignId,
      seq,
      authorType: "system",
      glyph: "system-party",
      content: `${context.user.username} hands ${sheet.name} to the DM: from here they travel with the party as a companion, and the DM plays their turns.`,
    });
    publishWithSeq(campaignId, seq, "message_added", { message });
  }

  return Response.json({ ok: true, sheet: adopted });
}
