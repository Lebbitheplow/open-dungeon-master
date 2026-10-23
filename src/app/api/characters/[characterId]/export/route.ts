import { serverVersion } from "@/lib/addons/installed";
import { currentUser, unauthorized } from "@/lib/auth";
import { buildCharacterBundle, characterBundleFilename } from "@/lib/character-bundle";
import { getCharacterForUser } from "@/lib/db/characters";
import { characterFileShelf } from "@/lib/db/character-file";
import { readUploadedImage } from "@/lib/uploads-store";
import { attachmentDisposition } from "@/lib/serve-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/characters/[characterId]/export
//
// The character as one downloadable JSON file, portrait inlined and the
// Homebrew it depends on carried, for moving it to another device or server
// (POST /api/characters/import is the other end). Owner only: the library is
// private, and so is its export.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ characterId: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { characterId } = await params;
  const character = getCharacterForUser(user.id, characterId);
  if (!character) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }
  // The Homebrew the sheet stands on rides along, and the sheet names it by
  // kind and name, so the file means the same on another account or server.
  const bundle = await buildCharacterBundle(character, readUploadedImage, new Date(), serverVersion(), characterFileShelf(user.id, character.sheet));
  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": attachmentDisposition(characterBundleFilename(character.name)),
    },
  });
}
