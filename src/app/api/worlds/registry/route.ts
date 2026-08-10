import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { serverEnv } from "@/lib/server-env";
import { fetchRegistryIndex, pickRegistryUrl } from "@/lib/worlds/install";
import { listWorldPackSummaries } from "@/lib/worlds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/worlds/registry
//
// The catalog side of the plugin browser. Admin-only, because it makes an
// outbound request on the server's behalf and only admins can act on the
// result anyway.
//
// The registry is whatever URL the operator configured. Nothing is baked in:
// community campaign packs are third-party content this project neither
// ships nor vets, so choosing a source is an explicit decision.
export async function GET() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  // What is on disk has nothing to do with whether a registry is reachable, so
  // it is resolved once and returned on every path. Returning it only on the
  // happy path made the browser's Installed list look empty on a server with
  // no registry configured, which is the default.
  const installed = listWorldPackSummaries();

  // Settings precedence, per docs/configuration.md: admin panel, then env,
  // then the built-in default. Empty only when an operator turned it off.
  const url = pickRegistryUrl(getGlobalConfig().worldRegistryUrl, serverEnv("WORLD_REGISTRY_URL"));
  if (!url) {
    return Response.json({ configured: false, packs: [], installed });
  }
  const result = await fetchRegistryIndex(url);
  if (!result.ok) {
    return Response.json({ configured: true, url, error: result.error, packs: [], installed });
  }
  // The browser also needs to know what is already here so it can offer Update
  // or Installed instead of Install.
  return Response.json({ configured: true, url, packs: result.packs, installed });
}
