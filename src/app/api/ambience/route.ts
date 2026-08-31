import { currentUser, unauthorized } from "@/lib/auth";
import { installedTracks } from "@/lib/ambience/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Which ambience cues this install can actually play, and who to credit.
//
// Not campaign-scoped: the library is one set of files shared by every
// table, and the answer is identical for every seat. Clients ask once on
// load and play only the cues named here, so a table that has never fetched
// the library gets silence instead of a 404 on every scene change.
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const tracks = installedTracks();
  return Response.json({
    tracks: Object.fromEntries(tracks.map((track) => [track.cueId, track.url])),
    credits: tracks.map(({ cueId, title, author, source, license }) => ({
      cueId,
      title,
      author,
      source,
      license,
    })),
  });
}
