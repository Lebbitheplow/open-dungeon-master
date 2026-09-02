import { currentUser, unauthorized } from "@/lib/auth";
import { buildCharacterBundle, characterBundleFilename } from "@/lib/character-bundle";
import { getCharacterForUser } from "@/lib/db/characters";
import { readUploadedImage } from "@/lib/uploads-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/characters/[characterId]/export
//
// The character as one downloadable JSON file, portrait inlined, for moving
// it to another device or server (POST /api/characters/import is the other
// end). Owner only: the library is private, and so is its export.
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
  const bundle = await buildCharacterBundle(character, readUploadedImage);
  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${characterBundleFilename(character.name)}"`,
    },
  });
}
