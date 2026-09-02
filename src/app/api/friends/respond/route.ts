import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { acceptRequest, declineOrRemove } from "@/lib/db/friends";
import { notifyUsers } from "@/lib/db/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const respondSchema = z.object({
  userId: z.string().min(1),
  accept: z.boolean(),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  if (user.mustChangePassword) {
    return Response.json({ error: "Set a new password to continue." }, { status: 403 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = respondSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (parsed.data.accept) {
    if (!acceptRequest(user.id, parsed.data.userId)) {
      return Response.json({ error: "No pending request from that user." }, { status: 400 });
    }
    notifyUsers([parsed.data.userId], {
      kind: "friend_accept",
      body: `${user.username} accepted your friend request.`,
    });
    return Response.json({ ok: true });
  }

  // Declining is quiet: the requester is never told they were turned down,
  // only left un-accepted.
  declineOrRemove(user.id, parsed.data.userId);
  return Response.json({ ok: true });
}
