import { rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { capsFor, isErrorResponse, isLead, requireMember } from "@/lib/campaign-api";
import { CAMPAIGN_DIFFICULTIES } from "@/lib/campaign-types";
import {
  allMembersReady,
  allocateSeq,
  campaignSeats,
  countPartySlots,
  deleteCampaign,
  latestSeq,
  listMembers,
  publicCampaign,
  setCampaignStatus,
  updateCampaignInfo,
} from "@/lib/db/campaigns";
import { ensureOpenChapter, listChapters } from "@/lib/db/chapters";
import { getAmbience } from "@/lib/db/ambience";
import { captureBoundarySnapshot } from "@/lib/db/snapshots";
import { listRecentCampaignEvents } from "@/lib/db/character-events";
import { syncProgressToLibrary } from "@/lib/db/characters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { listNotesVisibleTo } from "@/lib/db/notes";
import { listOpenPendingRolls, publicPendingRoll } from "@/lib/db/dm-turns";
import { listDmBeats } from "@/lib/db/dm-beats";
import { listOpenItemProposals } from "@/lib/db/item-proposals";
import { publicItemProposal } from "@/lib/dm/proposal-intercept";
import { listLocations } from "@/lib/db/locations";
import { listRecentAudit } from "@/lib/db/sheet-audit";
import { insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { listRollsVisibleTo } from "@/lib/db/rolls";
import { listSheets } from "@/lib/db/sheets";
import { requestDmTurn } from "@/lib/dm/loop";
import { hasHumanDm } from "@/lib/dm/viewer";
import { enqueueDmJob } from "@/lib/dm/queue";
import { runStorySetup } from "@/lib/dm/setup";
import { generateStoryArc } from "@/lib/dm/arc";
import { getDmStatus } from "@/lib/dm/status";
import { listUtilityCalls } from "@/lib/dm/call-tracker";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { listNarrationAudio } from "@/lib/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const { campaign, user } = context;
  const caps = capsFor(context);
  const sheets = listSheets(campaignId);
  // Their own characters, for the rolls only they and the DM may read.
  const ownedCharacterIds = sheets
    .filter((sheet) => sheet.userId === user.id)
    .map((sheet) => sheet.id);
  return Response.json({
    campaign: publicCampaign(campaign),
    me: { id: user.id, username: user.username, avatar: user.avatar },
    members: listMembers(campaignId),
    sheets,
    messages: listRecentMessages(campaignId, 100),
    // Blind and DM-only rolls are redacted or dropped here, not in the UI;
    // a player's snapshot must never carry a number they are not meant to
    // have (src/lib/dm/viewer.ts).
    rolls: listRollsVisibleTo(campaignId, caps, ownedCharacterIds, 20),
    pendingRolls: listOpenPendingRolls(campaignId).map(publicPendingRoll),
    auditLog: listRecentAudit(campaignId, 50),
    locations: listLocations(campaignId),
    chapters: listChapters(campaignId),
    notes: listNotesVisibleTo(campaignId, user.id, caps.steersStory),
    characterEvents: listRecentCampaignEvents(campaignId, 30),
    encounter: activePublicEncounter(campaignId, { enemyNumbers: caps.enemyNumbers }),
    itemProposals: listOpenItemProposals(campaignId).map(publicItemProposal),
    // Story the DM has written down. A DM tool, so only the DM seat is
    // served the list; the text itself is public either way, because a beat
    // is published as an ordinary DM passage (src/lib/dm/beats.ts).
    beats: caps.adjudicates ? listDmBeats(campaignId, 20) : [],
    latestSeq: latestSeq(campaignId),
    // Which messages already have narration on disk, so read-aloud plays them
    // straight from a fresh load instead of rendering a second take.
    narrationAudio: listNarrationAudio(campaignId),
    // What is playing. The ambience_changed event keeps it live from here;
    // without the snapshot a reload mid-scene would sit in silence until the
    // next place or fight changed it.
    ambience: getAmbience(campaignId),
    // What this seat may see and do, so the client never re-derives it from
    // ids and never shows a control the server would refuse.
    caps,
    // In-memory status so a reload mid-turn still shows the DM at work.
    dmStatus: getDmStatus(campaignId),
    // Same reason, for background work: utility_calls is ephemeral, so a
    // client that reloads mid-compaction would otherwise see an empty strip.
    utilityCalls: listUtilityCalls(campaignId),
  });
}

const patchSchema = z.object({
  status: z.enum(["active", "ended"]).optional(),
  title: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  theme: z.string().trim().max(120).optional(),
  maxPlayers: z.number().int().min(1).max(8).optional(),
  startingLevel: z.number().int().min(1).max(20).optional(),
  difficulty: z.enum(CAMPAIGN_DIFFICULTIES).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const { campaign, user } = context;

  const raw = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid update." }, { status: 400 });
  }

  const { status: nextStatus, ...info } = parsed.data;
  const infoKeys = Object.keys(info) as Array<keyof typeof info>;

  // Campaign info edits: party lead only, any time before the campaign
  // ends. The DM prompt reads title/theme/difficulty/description fresh each
  // turn, so mid-game changes steer the very next narration; startingLevel
  // only seeds sheets for future joiners.
  if (infoKeys.length) {
    if (!isLead(context)) {
      return Response.json({ error: "Only the party lead can edit the campaign." }, { status: 403 });
    }
    if (campaign.status === "ended") {
      return Response.json({ error: "The campaign has ended." }, { status: 400 });
    }
    if (info.maxPlayers !== undefined && info.maxPlayers < listMembers(campaignId).length) {
      return Response.json(
        { error: "Max players cannot drop below the current party size." },
        { status: 400 },
      );
    }
    updateCampaignInfo(campaignId, info);
    publishPersisted(campaignId, "campaign_updated", info);
    if (!nextStatus) {
      return Response.json({ ok: true, ...info });
    }
  }

  if (!nextStatus) {
    return Response.json({ error: "Invalid update." }, { status: 400 });
  }
  if (campaign.ownerUserId !== user.id) {
    return Response.json({ error: "Only the campaign owner can do that." }, { status: 403 });
  }
  if (nextStatus === "active") {
    if (campaign.status !== "lobby") {
      return Response.json({ error: "Campaign has already started." }, { status: 400 });
    }
    if (!allMembersReady(campaignId)) {
      return Response.json({ error: "Everyone must ready up first." }, { status: 400 });
    }
    const sheetCount = listSheets(campaignId).length;
    // The DM seats run no character, so they are not counted here; a
    // human-DM table is ready when every *player* has a sheet.
    const memberCount = countPartySlots(campaignId);
    if (sheetCount < memberCount) {
      return Response.json(
        { error: "Every player needs a character before the adventure starts." },
        { status: 400 },
      );
    }
  }

  setCampaignStatus(campaignId, nextStatus);
  publishPersisted(campaignId, "campaign_updated", { status: nextStatus });

  // Campaign over: write durable progression back to each player's library
  // character (level, XP, gold, gear, spells; never HP or conditions).
  if (nextStatus === "ended") {
    for (const sheet of listSheets(campaignId)) {
      if (sheet.libraryCharacterId) {
        syncProgressToLibrary(sheet.id);
      }
    }
  }

  // Kick off the adventure: a table note the DM answers with the opening
  // scene, introducing the party and the premise. When AI story setup is on,
  // the setup pass runs first on the same queue (it writes the premise and
  // the DM's secret outline before the kickoff narration reads them).
  if (nextStatus === "active") {
    // With a person in the DM seat there is nothing to prompt: the kickoff
    // note is addressed to the table, and the opening scene is theirs to
    // write. The AI's premise pass and story-arc planner are skipped too,
    // because a human DM's plan lives in their own notes, not in an outline
    // the server invented.
    const humanDm = hasHumanDm(campaignSeats(campaign));
    const seq = allocateSeq(campaignId);
    const message = insertCampaignMessage({
      campaignId,
      seq,
      authorType: "system",
      content: humanDm
        ? "The party is assembled and the adventure begins. The Dungeon Master opens the scene."
        : "The party is assembled and the adventure begins. Introduce the opening scene, set the premise, and give the party their first decision.",
    });
    publishWithSeq(campaignId, seq, "message_added", { message });
    if (!humanDm && campaign.gameSettings.aiStorySetup) {
      enqueueDmJob(campaignId, () => runStorySetup(campaignId));
    }
    // Every AI-run campaign gets a structured story arc built from the
    // premise (whether the table wrote it or the setup pass just did); the
    // kickoff narration behind it on the queue already steers by the arc.
    if (!humanDm) {
      enqueueDmJob(campaignId, () => generateStoryArc(campaignId));
    }
    // Chapter 1's rewind point: the settled pre-adventure world (setup and
    // arc done, opening narration not yet written).
    enqueueDmJob(campaignId, async () => {
      ensureOpenChapter(campaignId);
      captureBoundarySnapshot(campaignId, 1, latestSeq(campaignId));
    });
    // requestDmTurn guards human-DM tables itself (src/lib/dm/loop.ts), so
    // the kickoff request is unconditional here like everywhere else.
    requestDmTurn(campaignId);
  }

  return Response.json({ ok: true, status: nextStatus });
}

// Deletes the campaign and everything under it. Rows cascade via foreign
// keys; the per-campaign narration audio directory goes with them.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const { campaign, user } = context;
  if (campaign.ownerUserId !== user.id) {
    return Response.json({ error: "Only the campaign owner can delete it." }, { status: 403 });
  }

  deleteCampaign(campaignId);
  await rm(path.join(process.cwd(), "public", "generated-audio", campaignId), {
    recursive: true,
    force: true,
  });
  return Response.json({ ok: true });
}
