import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import {
  declineOrRemove,
  listFriends,
  listPendingIncoming,
  listPendingOutgoing,
  sendRequest,
} from "@/lib/db/friends";
import { notifyUsers } from "@/lib/db/notifications";
import { checkLogin, recordLoginFailure } from "@/lib/login-throttle";
import { onlineUsers } from "@/lib/user-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  username: z.string().trim().min(1).max(64),
});

const removeSchema = z.object({
  userId: z.string().min(1),
});

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const friends = listFriends(user.id);
  const online = new Set(onlineUsers(friends.map((friend) => friend.userId)));
  return Response.json({
    friends: friends.map((friend) => ({ ...friend, online: online.has(friend.userId) })),
    incoming: listPendingIncoming(user.id),
    outgoing: listPendingOutgoing(user.id),
  });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  if (user.mustChangePassword) {
    return Response.json({ error: "Set a new password to continue." }, { status: 403 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Enter a username." }, { status: 400 });
  }

  // Every attempt costs a strike, hit or miss, because the response below is
  // identical either way: a cheaper miss would let the meter itself say
  // which usernames exist. Same escalating lockout as wrong passwords.
  const throttle = `friend:${user.id}`;
  const gate = checkLogin(throttle);
  if (gate.blocked) {
    return Response.json(
      { error: `Too many requests. Try again in ${gate.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
    );
  }
  recordLoginFailure(throttle);

  const result = sendRequest(user.id, parsed.data.username);
  if (result.outcome === "requested" && result.targetUserId) {
    notifyUsers([result.targetUserId], {
      kind: "friend_request",
      body: `${user.username} wants to be friends.`,
    });
  } else if (result.outcome === "accepted" && result.targetUserId) {
    // Asking back completed their pending request, so they are the
    // requester owed the acceptance note.
    notifyUsers([result.targetUserId], {
      kind: "friend_accept",
      body: `${user.username} accepted your friend request.`,
    });
  }

  // The same friendly answer whether or not the name exists; only the row
  // (and the notification) differ. No user enumeration.
  return Response.json({ message: "Request sent." });
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  if (user.mustChangePassword) {
    return Response.json({ error: "Set a new password to continue." }, { status: 403 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = removeSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  declineOrRemove(user.id, parsed.data.userId);
  return Response.json({ ok: true });
}
