import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import {
  countPendingPlayerWhispers,
  countUnreadWhispers,
  insertPlayerWhisper,
  listWhispersForUser,
} from "@/lib/db/dm-whispers";
import { getSheetForUser } from "@/lib/db/sheets";
import { requestDmTurn } from "@/lib/dm/loop";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A member's own private line with the DM: DM-sent whispers plus the
// member's own private messages to the DM. Always scoped to the caller.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({
    whispers: listWhispersForUser(campaignId, context.user.id),
    unread: countUnreadWhispers(campaignId, context.user.id),
  });
}

const playerWhisperSchema = z.object({
  message: z.string().trim().min(1).max(500),
});

// Cap of unanswered player whispers per player. Combined with DM-turn
// coalescing (all pending whispers ride one serialized turn) this keeps the
// AI from ever juggling parallel private conversations.
const PENDING_PLAYER_WHISPER_CAP = 2;

// A private message from a player to the DM, e.g. slipping away from the
// group to act in secret. Never touches campaign_messages; the next
// coalesced DM turn reads it from GAME STATE and answers via send_whisper.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const { campaign, user } = context;
  if (campaign.status !== "active") {
    return Response.json({ error: "The adventure has not started yet." }, { status: 400 });
  }

  const sheet = getSheetForUser(campaignId, user.id);
  if (!sheet) {
    return Response.json({ error: "You need a character to whisper to the DM." }, { status: 400 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = playerWhisperSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid message." }, { status: 400 });
  }

  if (countPendingPlayerWhispers(campaignId, user.id) >= PENDING_PLAYER_WHISPER_CAP) {
    return Response.json(
      { error: "The DM has not answered your last private messages yet." },
      { status: 429 },
    );
  }

  insertPlayerWhisper(campaignId, user.id, sheet.id, parsed.data.message);
  // Contentless ping; each client re-fetches its own filtered rows.
  publishEphemeral(campaignId, "whisper_activity", {});
  // Coalesced: never interrupts a running turn, at most one follow-up.
  requestDmTurn(campaignId);

  return Response.json({ ok: true }, { status: 202 });
}
