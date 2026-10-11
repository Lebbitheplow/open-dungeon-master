import { currentUser, unauthorized } from "@/lib/auth";
import { installedCounts, installedTracks } from "@/lib/ambience/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Which ambience cues this install can actually play, every take of each,
// and who to credit.
//
// Not campaign-scoped: the library is one set of files shared by every
// table, and the answer is identical for every seat. Clients ask once on
// load and play only the cues named here, so a table that has never
// installed the library gets silence instead of a 404 on every scene change.
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const tracks = installedTracks();
  const byCue: Record<string, Array<{ url: string; title: string }>> = {};
  for (const track of tracks) {
    (byCue[track.cueId] ??= []).push({ url: track.url, title: track.title });
  }
  return Response.json({
    tracks: byCue,
    counts: installedCounts(tracks),
    credits: tracks.map(({ cueId, file, title, author, source, license }) => ({
      cueId,
      file,
      title,
      author,
      source,
      license,
    })),
  });
}
