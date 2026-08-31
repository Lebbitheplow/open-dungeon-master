import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import {
  CHARACTER_ROLES,
  createCharacter,
  listAssignmentsForUser,
  listCharactersForUser,
  type CharacterRole,
} from "@/lib/db/characters";
import { portraitStatus, queueLibraryPortrait } from "@/lib/portrait";
import { createSheetSchema } from "@/lib/schemas/sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createLibrarySchema = z.object({
  level: z.number().int().min(1).max(20).default(1),
  // A character somebody plays, or an ally the DM plays. Same sheet either
  // way (src/lib/db/characters.ts); the role decides which door it comes
  // through into a campaign.
  role: z.enum(CHARACTER_ROLES as unknown as [string, ...string[]]).default("pc"),
  sheet: createSheetSchema,
});

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const asked = new URL(request.url).searchParams.get("role");
  const role = (CHARACTER_ROLES as readonly string[]).includes(asked ?? "")
    ? (asked as CharacterRole)
    : undefined;
  // Which campaigns each one is playing in, resolved once for the whole
  // roster rather than per tile.
  const assignments = listAssignmentsForUser(user.id);
  return Response.json({
    characters: listCharactersForUser(user.id, role).map((character) => ({
      ...character,
      portraitStatus: portraitStatus(character.id),
      campaigns: assignments.get(character.id) ?? [],
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
  const character = createCharacter(
    user.id,
    parsed.data.level,
    parsed.data.sheet,
    parsed.data.role as CharacterRole,
  );
  queueLibraryPortrait(character);
  return Response.json(
    { character: { ...character, portraitStatus: portraitStatus(character.id) } },
    { status: 201 },
  );
}
