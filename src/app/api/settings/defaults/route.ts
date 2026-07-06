import { getStoredDefaultSettings } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Env-configured defaults, overlaid with the settings the player last saved
// on any chat, so new stories keep using their chosen backend (#9).
export async function GET() {
  return Response.json({ settings: getStoredDefaultSettings() });
}
