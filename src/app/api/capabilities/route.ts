import { currentUser, unauthorized } from "@/lib/auth";
import { capabilitiesSnapshot } from "@/lib/capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What this server can actually do, for any logged-in user: the campaign
// creator gates its AI options on this instead of letting a table create a
// campaign that fails on the first DM turn. Cheap to poll: live probes are
// cached server-side (src/lib/capabilities.ts).
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  return Response.json(await capabilitiesSnapshot());
}
