import { currentUser, unauthorized } from "@/lib/auth";
import { worldPackArt } from "@/lib/worlds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/worlds/berserk/art/monster-pit-fiend
//
// One of a pack's thumbnails, lifted out of its manifest at load time
// (src/lib/worlds/index.ts). The key is re-checked against the schema's own
// pattern inside worldPackArt, so nothing here touches a path. Signed in,
// like the pack itself: the art is part of the plugin, not a public asset.
//
// The version rides in the query string (packArtUrl), so the response can be
// cached for a day and still change the moment an Update lands.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ packId: string; key: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { packId, key } = await params;
  const image = worldPackArt(packId, key);
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
