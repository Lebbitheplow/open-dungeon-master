import { discordCredentials } from "@/lib/discord-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public: which optional sign-in providers are configured, so the login
// form knows whether to render their buttons.
export async function GET() {
  return Response.json({ discord: discordCredentials() !== null });
}
