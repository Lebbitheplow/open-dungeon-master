import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { listUsers } from "@/lib/db/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  return Response.json({
    users: listUsers().map((user) => ({
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      isAdmin: user.isAdmin,
      mustChangePassword: user.mustChangePassword,
      hasDiscord: user.hasDiscord,
      hasPassword: user.hasPassword,
      campaignCount: user.campaignCount,
      createdAt: user.createdAt,
    })),
  });
}
