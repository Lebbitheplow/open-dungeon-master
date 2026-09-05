import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { listPregens, setCharacterWorkshop } from "@/lib/db/characters";
import { getWorkshopForUser } from "@/lib/db/workshops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The workshop's pregens: the owner's library characters filed under it
// (docs/workshop-parity-audit.md phase 15). A pregen is an ordinary
// library character; this route only decides which workshop lists it. The
// sheet itself is edited where every sheet is, at /characters/:id.

const bodySchema = z.object({ characterId: z.string().min(1).max(80) });

async function resolve(workshopId: string) {
  const user = await currentUser();
  if (!user) {
    return { error: unauthorized() };
  }
  const workshop = getWorkshopForUser(workshopId, user.id);
  if (!workshop) {
    return { error: Response.json({ error: "Workshop not found." }, { status: 404 }) };
  }
  return { user, workshop };
}

function publicPregen(character: ReturnType<typeof listPregens>[number]) {
  return {
    id: character.id,
    name: character.name,
    role: character.role,
    race: character.race,
    class: character.class,
    subclass: character.subclass,
    background: character.background,
    level: character.level,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const resolved = await resolve(workshopId);
  if (resolved.error) {
    return resolved.error;
  }
  return Response.json({
    pregens: listPregens(resolved.user.id, resolved.workshop.id).map(publicPregen),
  });
}

// Files one of the caller's library characters under this workshop. A
// character already filed under another workshop moves.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const resolved = await resolve(workshopId);
  if (resolved.error) {
    return resolved.error;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Pick a character." }, { status: 400 });
  }
  const character = setCharacterWorkshop(
    resolved.user.id,
    parsed.data.characterId,
    resolved.workshop.id,
  );
  if (!character) {
    return Response.json({ error: "That character is not in your library." }, { status: 404 });
  }
  return Response.json({
    pregens: listPregens(resolved.user.id, resolved.workshop.id).map(publicPregen),
  });
}

// Takes a character off the roster. It stays in the library.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const resolved = await resolve(workshopId);
  if (resolved.error) {
    return resolved.error;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Pick a character." }, { status: 400 });
  }
  const listed = listPregens(resolved.user.id, resolved.workshop.id).some(
    (character) => character.id === parsed.data.characterId,
  );
  if (!listed) {
    return Response.json({ error: "That character is not on this roster." }, { status: 404 });
  }
  setCharacterWorkshop(resolved.user.id, parsed.data.characterId, "");
  return Response.json({
    pregens: listPregens(resolved.user.id, resolved.workshop.id).map(publicPregen),
  });
}
