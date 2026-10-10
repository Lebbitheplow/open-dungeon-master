import { currentUser, unauthorized } from "@/lib/auth";
import { archiveHomebrew, deleteHomebrew, getHomebrew, restoreHomebrew, updateHomebrew } from "@/lib/db/homebrew";
import { serverPublishedNameProblem } from "@/lib/homebrew/published-names-server";
import { normalizeHomebrewData } from "@/lib/homebrew/gear";
import { patchHomebrewSchema } from "@/lib/schemas/homebrew";
import { forgetSpeciesRules } from "@/lib/characters/species-rules";
import { forgetTableFeats } from "@/lib/db/table-feats";
import { forgetTableHazards } from "@/lib/db/table-hazards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { id } = await params;
  const entry = getHomebrew(user.id, id);
  return entry
    ? Response.json({ entry })
    : Response.json({ error: "Not found." }, { status: 404 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { id } = await params;
  const existing = getHomebrew(user.id, id);
  if (!existing) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = patchHomebrewSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid homebrew patch." }, { status: 400 });
  }
  // A rename to a published name is refused; an entry saved under one before
  // the rule keeps its name (and the editor says what that means).
  const renamed = parsed.data.name !== undefined && parsed.data.name.trim().toLowerCase() !== existing.name.trim().toLowerCase();
  const published = renamed ? serverPublishedNameProblem(existing.kind, parsed.data.name ?? "") : null;
  if (published) {
    return Response.json({ error: published }, { status: 400 });
  }
  let data = parsed.data.data;
  if (data !== undefined) {
    const normalized = normalizeHomebrewData(existing.kind, data, parsed.data.name ?? existing.name);
    if ("error" in normalized) {
      return Response.json({ error: normalized.error }, { status: 400 });
    }
    data = normalized.data;
  }
  const entry = updateHomebrew(user.id, id, { name: parsed.data.name, data });
  forgetSpeciesRules(`homebrew:${id}`);
  forgetTableFeats();
  forgetTableHazards();
  if (!entry) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return Response.json({ entry });
}

// Forgets an entry: it is archived (src/lib/db/homebrew.ts archiveHomebrew),
// off the shelf and out of every picker, and whatever already carries it
// keeps its rules. ?purge=1 deletes a forgotten one for good. POST
// {restore: true} brings one back.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { id } = await params;
  const purge = new URL(request.url).searchParams.get("purge") === "1";
  const done = purge ? deleteHomebrew(user.id, id) : archiveHomebrew(user.id, id) || Boolean(getHomebrew(user.id, id)?.archivedAt);
  if (!done) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  forgetSpeciesRules(`homebrew:${id}`);
  forgetTableFeats();
  forgetTableHazards();
  return Response.json({ ok: true });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { id } = await params;
  const raw = (await request.json().catch(() => ({}))) as { restore?: unknown };
  if (raw.restore !== true) {
    return Response.json({ error: "Expected {restore: true}." }, { status: 400 });
  }
  if (!restoreHomebrew(user.id, id)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  forgetSpeciesRules(`homebrew:${id}`);
  forgetTableFeats();
  forgetTableHazards();
  return Response.json({ entry: getHomebrew(user.id, id) });
}
