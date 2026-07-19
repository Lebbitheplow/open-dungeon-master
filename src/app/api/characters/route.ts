import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { createCharacter, listCharactersForUser } from "@/lib/db/characters";
import { portraitStatus, queueLibraryPortrait } from "@/lib/portrait";
import { createSheetSchema } from "@/lib/schemas/sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createLibrarySchema = z.object({
  level: z.number().int().min(1).max(20).default(1),
  sheet: createSheetSchema,
});

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  return Response.json({
    characters: listCharactersForUser(user.id).map((character) => ({
      ...character,
      portraitStatus: portraitStatus(character.id),
    })),
  });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = createLibrarySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid character." },
      { status: 400 },
    );
  }
  const character = createCharacter(user.id, parsed.data.level, parsed.data.sheet);
  queueLibraryPortrait(character);
  return Response.json(
    { character: { ...character, portraitStatus: portraitStatus(character.id) } },
    { status: 201 },
  );
}
