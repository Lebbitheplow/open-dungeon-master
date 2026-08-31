import { currentUser, unauthorized } from "@/lib/auth";
import { duplicateCharacter } from "@/lib/db/characters";
import { portraitStatus } from "@/lib/portrait";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/characters/[characterId]/clone
//
// A second copy of a sheet under a numbered name, for the DM who wants four
// variations on one guard captain or the player trying a different subclass
// without losing the original. Nothing is generated: the copy carries the
// stored sheet verbatim, portrait included.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ characterId: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { characterId } = await params;
  const character = duplicateCharacter(user.id, characterId);
  if (!character) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }
  return Response.json(
    {
      character: {
        ...character,
        portraitStatus: portraitStatus(character.id),
        campaigns: [],
      },
    },
    { status: 201 },
  );
}
