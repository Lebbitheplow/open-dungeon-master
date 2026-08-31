import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { applyAudibility } from "@/lib/voice/apply";
import { requireVoiceMember } from "@/lib/voice/gate";
import { publishRoster } from "@/lib/voice/peers";
import { getRoom, TABLE_CHANNEL_ID } from "@/lib/voice/room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Breakout rooms: a private word with one player, splitting the party, a
// table-talk room that keeps going while the DM sets up.
//
// Every player may SEE the channel list and who is in each, because a side
// room nobody can see reads as a bug rather than a secret. Only whoever holds
// story authority may open one or move anybody, which is the same gate the
// floor controls use.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireVoiceMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ channels: getRoom(campaignId)?.channels ?? [] });
}

const schema = z.object({
  action: z.enum(["open", "rename", "close", "move", "recall"]),
  channelId: z.string().trim().max(64).optional(),
  name: z.string().trim().min(1).max(40).optional(),
  userId: z.string().trim().max(64).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  // Opening a side room and moving people between them is running the table,
  // so it sits behind the same gate as the floor.
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Malformed channel request." }, { status: 400 });
  }
  const room = getRoom(campaignId);
  if (!room) {
    return Response.json({ error: "Nobody is on the call." }, { status: 409 });
  }
  const { action, channelId, name, userId } = parsed.data;

  if (action === "open") {
    if (!name) {
      return Response.json({ error: "Name the room." }, { status: 400 });
    }
    if (room.channels.length >= 8) {
      return Response.json({ error: "That is enough side rooms." }, { status: 400 });
    }
    room.channels.push({ id: randomUUID(), name });
  } else if (action === "rename") {
    const channel = room.channels.find((entry) => entry.id === channelId);
    if (!channel || channel.id === TABLE_CHANNEL_ID) {
      return Response.json({ error: "That room cannot be renamed." }, { status: 400 });
    }
    channel.name = name || channel.name;
  } else if (action === "close") {
    if (!channelId || channelId === TABLE_CHANNEL_ID) {
      return Response.json({ error: "The table cannot be closed." }, { status: 400 });
    }
    // Closing returns the occupants to the table rather than disconnecting
    // them: they asked to be on a call, not to be in that particular room.
    for (const peer of room.peers.values()) {
      if (peer.channelId === channelId) {
        peer.channelId = TABLE_CHANNEL_ID;
      }
    }
    room.channels = room.channels.filter((entry) => entry.id !== channelId);
  } else if (action === "move") {
    const peer = userId ? room.peers.get(userId) : null;
    if (!peer) {
      return Response.json({ error: "They are not on the call." }, { status: 404 });
    }
    const target = channelId ?? TABLE_CHANNEL_ID;
    if (!room.channels.some((entry) => entry.id === target)) {
      return Response.json({ error: "No such room." }, { status: 404 });
    }
    peer.channelId = target;
  } else {
    // recall: everybody back to the table in one stroke.
    for (const peer of room.peers.values()) {
      peer.channelId = TABLE_CHANNEL_ID;
    }
  }

  // Who hears whom follows from the channel layout, so the matrix is what
  // actually makes the move take effect.
  await applyAudibility(campaignId);
  publishRoster(campaignId);
  return Response.json({ ok: true, channels: room.channels });
}
