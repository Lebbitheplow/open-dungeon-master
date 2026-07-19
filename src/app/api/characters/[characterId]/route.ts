import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import {
  deleteCharacter,
  getCharacterForUser,
  updateCharacter,
  updateCharacterPortrait,
} from "@/lib/db/characters";
import { listEventsForLibraryCharacter } from "@/lib/db/character-events";
import { mirrorToCampaignSheets, portraitStatus } from "@/lib/portrait";
import { attachmentSchema, createSheetSchema } from "@/lib/schemas/sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateLibrarySchema = z.object({
  level: z.number().int().min(1).max(20),
  sheet: createSheetSchema,
});

// Portrait-only PATCH from the library list page; attachmentSchema keeps
// the url pinned to local /uploads/ files.
const updatePortraitSchema = z.object({ portrait: attachmentSchema.nullable() }).strict();

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
  return Response.json({
    character: { ...character, portraitStatus: portraitStatus(character.id) },
    events: listEventsForLibraryCharacter(characterId),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ characterId: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { characterId } = await params;
  const raw = await request.json().catch(() => ({}));
  if (raw && typeof raw === "object" && !("sheet" in raw)) {
    const parsedPortrait = updatePortraitSchema.safeParse(raw);
    if (!parsedPortrait.success) {
      return Response.json(
        { error: parsedPortrait.error.issues[0]?.message || "Invalid portrait update." },
        { status: 400 },
      );
    }
    const character = updateCharacterPortrait(user.id, characterId, parsedPortrait.data.portrait);
    if (!character) {
      return Response.json({ error: "Character not found." }, { status: 404 });
    }
    // Manual uploads land on every campaign copy so chat and party views
    // show the character's photo, not the account avatar.
    mirrorToCampaignSheets(characterId, parsedPortrait.data.portrait, { overwrite: true });
    return Response.json({ character });
  }
  const parsed = updateLibrarySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid character update." },
      { status: 400 },
    );
  }
  const character = updateCharacter(user.id, characterId, parsed.data.level, parsed.data.sheet);
  if (!character) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }
  return Response.json({ character });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ characterId: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { characterId } = await params;
  if (!deleteCharacter(user.id, characterId)) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
