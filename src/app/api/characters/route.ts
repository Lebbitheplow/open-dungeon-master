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
import { libraryCompanionsOfCampaign } from "@/lib/db/companion-npcs";
import { admitSheet, refusal } from "@/lib/characters/admit";
import { olderBuilderOf } from "@/lib/srd/legality/older-builder";
import { createSheetSchema } from "@/lib/schemas/sheet";
import { libraryWords } from "@/lib/characters/species-rules";

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
  const search = new URL(request.url).searchParams;
  const asked = search.get("role");
  const role = (CHARACTER_ROLES as readonly string[]).includes(asked ?? "")
    ? (asked as CharacterRole)
    : undefined;
  // `joinable`: a campaign's Add a companion dialog asks for the ones that
  // could still join it, so it leaves out any that campaign has or had, the
  // ones companions/create refuses (issue 661).
  const joinable = search.get("joinable");
  const taken = joinable ? libraryCompanionsOfCampaign(joinable) : null;
  // Which campaigns each one is playing in, resolved once for the whole
  // roster rather than per tile.
  const assignments = listAssignmentsForUser(user.id);
  return Response.json({
    characters: listCharactersForUser(user.id, role)
      .filter((character) => !taken?.has(character.id))
      .map((character) => ({
        ...character,
        portraitStatus: portraitStatus(character.id),
        campaigns: assignments.get(character.id) ?? [],
        // A workshop class, a homebrew or content-pack species and a homebrew
        // background show by their names, not their ids.
        ...libraryWords(character),
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
  // The library's door holds what the table's does: the sheet is checked
  // against the rules and stored with what the server derives.
  const admitted = admitSheet({
    door: "library",
    level: parsed.data.level,
    sheet: parsed.data.sheet,
    userId: user.id,
    olderBuilder: olderBuilderOf((raw as { sheet?: unknown } | null)?.sheet),
  });
  if (!admitted.ok) {
    return refusal(admitted.problems);
  }
  const character = createCharacter(
    user.id,
    parsed.data.level,
    admitted.sheet,
    parsed.data.role as CharacterRole,
  );
  admitted.settle();
  queueLibraryPortrait(character);
  return Response.json(
    { character: { ...character, portraitStatus: portraitStatus(character.id) } },
    { status: 201 },
  );
}
