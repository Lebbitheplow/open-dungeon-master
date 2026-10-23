import { currentUser, unauthorized } from "@/lib/auth";
import {
  bundlePortraitSize,
  MAX_BUNDLE_BYTES,
  parseCharacterBundle,
  unpackCharacterBundle,
} from "@/lib/character-bundle";
import { admitSheet, refusal } from "@/lib/characters/admit";
import { createCharacter } from "@/lib/db/characters";
import { getDatabase } from "@/lib/db/core";
import { forgetRefusedArrivals, landCharacterFile, type FileArrival } from "@/lib/db/character-file";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { removeUnreferencedFiles } from "@/lib/image-files";
import { portraitStatus, queueLibraryPortrait } from "@/lib/portrait";
import { admitUpload, uploadRefusalResponse } from "@/lib/upload-budget";
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
//
// A file is a request somebody could have written by hand, so it comes
// through the same legality check a new character does
// (src/lib/characters/admit.ts) and is refused with what is wrong with it.
// The Homebrew a file carries (src/lib/db/character-file.ts) lands on the
// importer's shelf first, so its subclass or species is theirs to be judged
// by; a refused file takes those arrivals back.
// Nothing is written, the portrait included, for a file that is refused,
// or for one whose portrait would take the importer past their upload
// budget (src/lib/upload-budget.ts).
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
  const portraitSize = bundlePortraitSize(parsed.bundle);
  const overBudget = admitUpload(user, portraitSize, portraitSize ? 1 : 0);
  if (overBudget) {
    return uploadRefusalResponse(overBudget);
  }
  // The Homebrew the file carries lands on the importer's shelf first, and
  // the sheet is judged against it; a refusal takes the arrivals back.
  let landed: { sheet: CreateSheetInput; arrival: FileArrival; admitted: Extract<ReturnType<typeof admitSheet>, { ok: true }> };
  try {
    landed = getDatabase().transaction(() => {
      const file = landCharacterFile(user.id, parsed.bundle);
      const verdict = admitSheet({ door: "import", level: parsed.bundle.level, sheet: file.sheet, userId: user.id });
      if (!verdict.ok) {
        throw new RefusedFile(verdict.problems);
      }
      return { ...file, admitted: verdict };
    })();
  } catch (error) {
    if (error instanceof RefusedFile) {
      forgetRefusedArrivals();
      return refusal(error.problems);
    }
    throw error;
  }
  const admitted = landed.admitted;
  const unpacked = await unpackCharacterBundle(parsed.bundle, writeUploadedImage);
  let character: ReturnType<typeof createCharacter>;
  try {
    character = createCharacter(
      user.id,
      unpacked.level,
      { ...admitted.sheet, name: unpacked.sheet.name, portrait: unpacked.sheet.portrait },
      "pc",
      "",
      unpacked.xp,
    );
  } catch (error) {
    // No character row names the portrait just written, so it would sit in
    // public/uploads forever.
    if (unpacked.sheet.portrait) {
      removeUnreferencedFiles([unpacked.sheet.portrait.url]);
    }
    throw error;
  }
  if (!unpacked.carriedPortrait) {
    queueLibraryPortrait(character);
  }
  // A file older than a rule that asks for a pick comes in without it, and
  // says what is still to choose: the builder asks when it is next opened.
  return Response.json(
    {
      character: { ...character, portraitStatus: portraitStatus(character.id), campaigns: [] },
      ...(admitted.owed?.length ? { owed: admitted.owed } : {}),
      // What of the file's Homebrew landed on the importer's shelf.
      ...(landed.arrival.copied || landed.arrival.reused.length || landed.arrival.renamed.length ? { homebrew: landed.arrival } : {}),
    },
    { status: 201 },
  );
}

class RefusedFile extends Error {
  readonly problems: Parameters<typeof refusal>[0];
  constructor(problems: Parameters<typeof refusal>[0]) {
    super("refused");
    this.problems = problems;
  }
}
