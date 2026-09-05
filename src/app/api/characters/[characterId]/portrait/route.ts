import { currentUser, unauthorized } from "@/lib/auth";
import { imagesAvailable } from "@/lib/capabilities";
import { getCharacterForUser, updateCharacterPortrait } from "@/lib/db/characters";
import { mirrorToCampaignSheets, queueLibraryPortrait } from "@/lib/portrait";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Paint one": render a fresh portrait for a library character on the media
// queue, replacing whatever it has. Creation already queues a render; this
// is the button for later, when the first one missed or an upload should
// give way to a painting. The old picture goes first (on the library row and
// on every campaign copy) so the sheet shows its placeholder while the queue
// works rather than a face that is about to change.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ characterId: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { characterId } = await params;
  if (!getCharacterForUser(user.id, characterId)) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }
  if (!(await imagesAvailable())) {
    return Response.json(
      { error: "This server has no image model to paint with. Upload a portrait instead." },
      { status: 409 },
    );
  }
  const cleared = updateCharacterPortrait(user.id, characterId, null);
  if (!cleared) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }
  mirrorToCampaignSheets(characterId, null, { overwrite: true });
  queueLibraryPortrait(cleared);
  return Response.json({ ok: true }, { status: 202 });
}
