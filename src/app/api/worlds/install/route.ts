import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { serverEnv } from "@/lib/server-env";
import {
  fetchRegistryIndex,
  installFromUrl,
  installWorldPack,
  pickRegistryUrl,
} from "@/lib/worlds/install";
import { summarizePack } from "@/lib/worlds/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/worlds/install
//
// Two ways in, both admin-only because both write a file to the server:
//   { packId }  install the entry the configured registry lists under that id
//   { pack }    install a manifest the admin uploaded from their own machine
//
// A registry install resolves the download URL from the index rather than
// taking one from the client, so the set of hosts this server will fetch from
// is exactly the set the operator's own registry names.
const bodySchema = z.union([
  z.object({ packId: z.string().min(1).max(50) }),
  z.object({ pack: z.unknown() }),
]);

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Send either a packId or a pack manifest." }, { status: 400 });
  }

  const body = parsed.data;
  if ("pack" in body) {
    const result = await installWorldPack(body.pack);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({
      pack: summarizePack(result.pack, "installed"),
      replaced: result.replaced,
    });
  }

  const url = pickRegistryUrl(getGlobalConfig().worldRegistryUrl, serverEnv("WORLD_REGISTRY_URL"));
  if (!url) {
    return Response.json({ error: "This server has its world registry turned off." }, { status: 400 });
  }
  const index = await fetchRegistryIndex(url);
  if (!index.ok) {
    return Response.json({ error: index.error }, { status: 502 });
  }
  const entry = index.packs.find((candidate) => candidate.id === body.packId);
  if (!entry) {
    return Response.json({ error: "The registry does not list that world." }, { status: 404 });
  }
  const result = await installFromUrl(entry.downloadUrl, entry.id);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({
    pack: summarizePack(result.pack, "installed"),
    replaced: result.replaced,
  });
}
