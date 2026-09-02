import { currentUser, unauthorized } from "@/lib/auth";
import {
  MAX_BUNDLE_BYTES,
  parseCharacterBundle,
  unpackCharacterBundle,
} from "@/lib/character-bundle";
import { createCharacter } from "@/lib/db/characters";
import { portraitStatus, queueLibraryPortrait } from "@/lib/portrait";
import { writeUploadedImage } from "@/lib/uploads-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/characters/import
//
// A character file from GET /api/characters/[characterId]/export, possibly
// from another server, becomes a new library character of the caller's. The
// inlined portrait is written to public/uploads like any upload; when the
// file carried one, no painted portrait is queued, since the player already
// chose a face.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BUNDLE_BYTES) {
    return Response.json({ error: "Character file is larger than 12MB." }, { status: 413 });
  }
  const text = await request.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: "Character file is not valid JSON." }, { status: 400 });
  }
  const parsed = parseCharacterBundle(raw, Buffer.byteLength(text));
  if (!parsed.ok) {
    return Response.json(
      { error: parsed.error },
      { status: parsed.error.includes("larger than") ? 413 : 400 },
    );
  }
  const unpacked = await unpackCharacterBundle(parsed.bundle, writeUploadedImage);
  const character = createCharacter(user.id, unpacked.level, unpacked.sheet, "pc");
  if (!unpacked.carriedPortrait) {
    queueLibraryPortrait(character);
  }
  return Response.json(
    { character: { ...character, portraitStatus: portraitStatus(character.id), campaigns: [] } },
    { status: 201 },
  );
}
