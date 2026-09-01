import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { listNotifications, markNotificationsRead, unreadCount } from "@/lib/db/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The bell. GET is polled (there is no global stream, only per-campaign
// ones); POST marks one notification or the whole inbox read.
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  return Response.json({
    notifications: listNotifications(user.id),
    unread: unreadCount(user.id),
  });
}

const readSchema = z.object({
  id: z.string().max(64).optional(),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  const parsed = readSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid input." }, { status: 400 });
  }
  markNotificationsRead(user.id, parsed.data.id);
  return Response.json({ ok: true, unread: unreadCount(user.id) });
}
