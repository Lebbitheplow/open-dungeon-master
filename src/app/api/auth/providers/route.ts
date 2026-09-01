import packageJson from "../../../../../package.json";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { discordCredentials } from "@/lib/discord-oauth";
import { resolveSignupMode } from "@/lib/schemas/global-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public server identity. The login form uses it to decide which buttons to
// render (Discord, register, invite-code field), and client apps use it to
// label a saved server in their picker and to check what they connected to.
export async function GET() {
  const config = getGlobalConfig();
  return Response.json({
    discord: discordCredentials() !== null,
    password: true,
    signupMode: resolveSignupMode(config),
    serverName: config.serverName || "Open Dungeon Master",
    version: packageJson.version,
    // The address OTHER people reach this server on, when it differs from
    // the one the current visitor used (e.g. a host playing on 127.0.0.1
    // while a tunnel shares the world). Share dialogs prefer it.
    publicUrl: (config.publicUrl || "").replace(/\/+$/, ""),
  });
}
