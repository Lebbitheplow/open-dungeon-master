import { rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { isErrorResponse, isLead, requireMember } from "@/lib/campaign-api";
import { CAMPAIGN_DIFFICULTIES } from "@/lib/campaign-types";
import {
  allMembersReady,
  allocateSeq,
  deleteCampaign,
  latestSeq,
  listMembers,
  publicCampaign,
  setCampaignStatus,
  updateCampaignInfo,
} from "@/lib/db/campaigns";
import { listChapters } from "@/lib/db/chapters";
import { listRecentCampaignEvents } from "@/lib/db/character-events";
import { syncProgressToLibrary } from "@/lib/db/characters";
import { listNotesVisibleTo } from "@/lib/db/notes";
import { listOpenPendingRolls } from "@/lib/db/dm-turns";
import { listLocations } from "@/lib/db/locations";
import { listRecentAudit } from "@/lib/db/sheet-audit";
import { insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { listRecentRolls } from "@/lib/db/rolls";
import { listSheets } from "@/lib/db/sheets";
import { requestDmTurn } from "@/lib/dm/loop";
import { enqueueDmJob } from "@/lib/dm/queue";
import { runStorySetup } from "@/lib/dm/setup";
import { generateStoryArc } from "@/lib/dm/arc";
import { getDmStatus } from "@/lib/dm/status";
import { publishPersisted, publishWithSeq } from "@/lib/events";

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
  return Response.json({
    campaign: publicCampaign(campaign),
    me: { id: user.id, username: user.username, avatar: user.avatar },
    members: listMembers(campaignId),
    sheets: listSheets(campaignId),
    messages: listRecentMessages(campaignId, 100),
    rolls: listRecentRolls(campaignId, 20),
    pendingRolls: listOpenPendingRolls(campaignId),
    auditLog: listRecentAudit(campaignId, 50),
    locations: listLocations(campaignId),
    chapters: listChapters(campaignId),
    notes: listNotesVisibleTo(campaignId, user.id, isLead(context)),
    characterEvents: listRecentCampaignEvents(campaignId, 30),
    latestSeq: latestSeq(campaignId),
    // In-memory status so a reload mid-turn still shows the DM at work.
    dmStatus: getDmStatus(campaignId),
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
    const memberCount = listMembers(campaignId).length;
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
    const seq = allocateSeq(campaignId);
    const message = insertCampaignMessage({
      campaignId,
      seq,
      authorType: "system",
      content:
        "The party is assembled and the adventure begins. Introduce the opening scene, set the premise, and give the party their first decision.",
    });
    publishWithSeq(campaignId, seq, "message_added", { message });
    if (campaign.gameSettings.aiStorySetup) {
      enqueueDmJob(campaignId, () => runStorySetup(campaignId));
    }
    // Every campaign gets a structured story arc built from the premise
    // (whether the table wrote it or the setup pass just did); the kickoff
    // narration behind it on the queue already steers by the arc.
    enqueueDmJob(campaignId, () => generateStoryArc(campaignId));
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
