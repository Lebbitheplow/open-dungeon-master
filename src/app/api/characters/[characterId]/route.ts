import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import {
  CHARACTER_ROLES,
  deleteCharacter,
  getCharacterForUser,
  listAssignmentsForCharacter,
  updateCharacter,
  updateCharacterPortrait,
} from "@/lib/db/characters";
import { listEventsForLibraryCharacter } from "@/lib/db/character-events";
import { mirrorToCampaignSheets, portraitStatus, queueLibraryPortrait } from "@/lib/portrait";
import { admitSheet, refusal } from "@/lib/characters/admit";
import { attachmentSchema, createSheetSchema } from "@/lib/schemas/sheet";
import { workshopClassDefs } from "@/lib/classes/workshop-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateLibrarySchema = z.object({
  level: z.number().int().min(1).max(20),
  sheet: createSheetSchema,
  // Who plays them. Changed only while no campaign holds a copy (issue
  // 229): a seated copy came in through the door its role opened.
  role: z.enum(CHARACTER_ROLES).optional(),
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
    character: {
      ...character,
      portraitStatus: portraitStatus(character.id),
      campaigns: listAssignmentsForCharacter(user.id, characterId),
    },
    events: listEventsForLibraryCharacter(characterId),
    // The workshop classes it holds, read in the browser as on the server.
    workshopClasses: workshopClassDefs([character.class, ...((character.sheet as { classes?: Array<{ id: string }> } | undefined)?.classes ?? []).map((entry) => entry.id)]),
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
  const stored = getCharacterForUser(user.id, characterId);
  if (!stored) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }
  const role = parsed.data.role;
  if (role && role !== stored.role) {
    const tables = listAssignmentsForCharacter(user.id, characterId);
    if (tables.length) {
      return Response.json(
        {
          error: `${stored.name} already has a copy at ${tables.map((table) => table.title).join(", ")}, so who plays them stays as it is. Duplicate them to file a copy the other way.`,
        },
        { status: 409 },
      );
    }
  }
  // An edit keeps what the stored character holds and adds only what the
  // rules give: the stored sheet is the baseline the request is read against.
  const admitted = admitSheet({
    door: "library",
    level: parsed.data.level,
    sheet: parsed.data.sheet,
    userId: user.id,
    baseline: { sheet: stored.sheet, level: stored.level },
  });
  if (!admitted.ok) {
    return refusal(admitted.problems);
  }
  const character = updateCharacter(user.id, characterId, parsed.data.level, admitted.sheet, role);
  if (!character) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }
  admitted.settle();
  // The builder's "Regenerate portrait" clears the saved one to have a new
  // one painted; a character with none (the placeholder chosen) stays so.
  if (stored.sheet.portrait && !character.sheet.portrait) {
    queueLibraryPortrait(character);
  }
  return Response.json({
    character: {
      ...character,
      portraitStatus: portraitStatus(character.id),
      campaigns: listAssignmentsForCharacter(user.id, characterId),
    },
  });
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
