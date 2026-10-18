import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { serverEnv } from "@/lib/server-env";
import { pickRegistryUrl } from "@/lib/worlds/install";
import { registryThumbnail } from "@/lib/worlds/registry-thumbnails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/worlds/registry/thumbnail/pack/monster_hunter?v=1.1.0
//
// One tile picture in the plugin browser, fetched from wherever the registry
// in force says it lives (src/lib/worlds/registry-thumbnails.ts). Admin-only,
// like the listing it belongs to: it is an outbound request on the server's
// behalf. The id is looked up in that listing, so nothing a client sends
// becomes an address.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const { kind, id } = await params;
  if ((kind !== "pack" && kind !== "bundle") || !/^[a-z][a-z0-9_]{2,49}$/.test(id)) {
    return Response.json({ error: "No such picture." }, { status: 404 });
  }
  const url = pickRegistryUrl(getGlobalConfig().worldRegistryUrl, serverEnv("WORLD_REGISTRY_URL"));
  const image = url ? await registryThumbnail(url, kind, id) : null;
  if (!image) {
    return Response.json({ error: "No such picture." }, { status: 404 });
  }
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.mime,
      "Content-Length": String(image.bytes.length),
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
