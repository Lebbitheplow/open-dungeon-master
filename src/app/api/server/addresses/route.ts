import os from "node:os";
import { currentUser, unauthorized } from "@/lib/auth";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { lanOrigins } from "@/lib/server-address";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The addresses this server can be reached at, for the floating QR button
// (src/components/ServerAddressButton.tsx): the configured public URL and
// every local-network address of this machine on the port the request came
// in on. Signed-in only, since the LAN addresses describe the host's network;
// a visitor on the login page still gets a QR of the address they are on,
// which the button builds without this route.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const url = new URL(request.url);
  const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol;
  const config = getGlobalConfig();
  return Response.json({
    serverName: config.serverName || "Open Dungeon Master",
    publicUrl: (config.publicUrl || "").replace(/\/+$/, ""),
    lanUrls: lanOrigins(os.networkInterfaces(), protocol, url.port),
  });
}
