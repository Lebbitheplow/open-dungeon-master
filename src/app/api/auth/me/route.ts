import { currentUser } from "@/lib/auth";
import { NO_PASSWORD_SENTINEL, getUserByUsername, getUserDiscordId } from "@/lib/db/users";
import { discordCredentials } from "@/lib/discord-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  return Response.json({
    user: user
      ? {
          id: user.id,
          username: user.username,
          avatar: user.avatar,
          isAdmin: user.isAdmin,
          mustChangePassword: user.mustChangePassword,
          discordLinked: getUserDiscordId(user.id) !== null,
          discordAvailable: discordCredentials() !== null,
          hasPassword: getUserByUsername(user.username)?.passwordHash !== NO_PASSWORD_SENTINEL,
        }
      : null,
  });
}
