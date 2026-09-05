import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { blockUser, listBlockedUsers, unblockUser } from "@/lib/db/moderation";
import { getUserById, isCompanionUserId } from "@/lib/db/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const blockSchema = z.object({ userId: z.string().min(1).max(80) });

// The caller's block list. A block is server-wide and symmetric in effect:
// the blocked player's table messages are hidden from the caller, and
// neither can open a private chat with or friend the other.
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  return Response.json({ blocked: listBlockedUsers(user.id) });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const parsed = blockSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const target = getUserById(parsed.data.userId);
  if (!target || isCompanionUserId(target.id)) {
    return Response.json({ error: "That player no longer exists." }, { status: 404 });
  }
  if (target.id === user.id) {
    return Response.json({ error: "You cannot block yourself." }, { status: 400 });
  }
  blockUser(user.id, target.id);
  return Response.json({ blocked: listBlockedUsers(user.id) });
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const parsed = blockSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  unblockUser(user.id, parsed.data.userId);
  return Response.json({ blocked: listBlockedUsers(user.id) });
}
