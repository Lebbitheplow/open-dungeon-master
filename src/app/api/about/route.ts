import { currentUser, unauthorized } from "@/lib/auth";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { REPOSITORY_URL } from "@/lib/build-info";
import { checkForUpdate, currentBuild } from "@/lib/update-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What this server is running, and whether a newer release exists (issue
// 102), for the About dialog. Behind the login: the exact commit of a
// server is its owner's and its players' business. The public identity
// probe (/api/auth/providers) keeps carrying the bare version, which is all
// the apps need to label a saved server.
//
// ?fresh=1 asks GitHub again now instead of using the kept answer; only an
// admin may, so the rate limit cannot be spent for the server by a player
// pressing a button.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const build = currentBuild();
  const fresh = user.isAdmin && new URL(request.url).searchParams.get("fresh") === "1";
  return Response.json({
    serverName: getGlobalConfig().serverName || "Open Dungeon Master",
    build,
    update: await checkForUpdate(build, fresh),
    repositoryUrl: REPOSITORY_URL,
    canRecheck: Boolean(user.isAdmin),
  });
}
