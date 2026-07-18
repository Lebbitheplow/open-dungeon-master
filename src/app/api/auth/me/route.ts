import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  return Response.json({
    user: user ? { id: user.id, username: user.username, avatar: user.avatar } : null,
  });
}
