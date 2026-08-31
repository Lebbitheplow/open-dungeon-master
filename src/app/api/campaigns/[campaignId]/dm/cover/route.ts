import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { getDmCover, setDmCover } from "@/lib/db/dm-cover";
import {
  clampCoverBrief,
  clampCoverTurns,
  COVER_BRIEF_MAX,
  delegated,
  MAX_COVER_TURNS,
} from "@/lib/dm/delegation";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Assisted mode: the DM steps away and hands the AI a counted stretch of
// answers.
//
// This route only writes the record. What it changes is one branch in
// src/app/api/campaigns/[campaignId]/actions/route.ts: while a cover is
// running, a player's action wakes a DM turn instead of queueing for the
// person, and one answer is spent. The turn itself is the ordinary AI turn,
// with a block in its system prompt saying whose table it is on loan from
// (coverPromptBlock in src/lib/dm/delegation.ts).

const coverSchema = z.object({
  turns: z.number().int().min(0).max(MAX_COVER_TURNS),
  brief: z.string().trim().max(COVER_BRIEF_MAX).default(""),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ cover: getDmCover(campaignId) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const { campaign, user } = context;
  if (!delegated(campaign.gameSettings.dmMode, campaign.gameSettings.dmAssist, "cover")) {
    return Response.json(
      { error: "Covering is off; turn it on under Game settings." },
      { status: 403 },
    );
  }

  const parsed = coverSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: `Say how many answers to hand over, up to ${MAX_COVER_TURNS}.` },
      { status: 400 },
    );
  }

  const turns = clampCoverTurns(parsed.data.turns);
  // Zero is how the DM says "I am back", which is the same write as handing
  // it over. Keeping it one route means the banner can never be left up by a
  // stop that failed while a start succeeded.
  const cover = {
    turnsLeft: turns,
    brief: clampCoverBrief(parsed.data.brief),
    byUserId: user.id,
    startedAt: new Date().toISOString(),
  };
  setDmCover(campaignId, cover);
  // Persisted, and sent to the whole table rather than the DM alone: a player
  // is owed the knowledge that the person answering them stepped out.
  publishPersisted(campaignId, "dm_cover_changed", { cover });
  return Response.json({ cover });
}
