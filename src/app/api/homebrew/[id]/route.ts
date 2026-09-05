import { currentUser, unauthorized } from "@/lib/auth";
import { deleteHomebrew, getHomebrew, updateHomebrew } from "@/lib/db/homebrew";
import { normalizeHomebrewData } from "@/lib/homebrew/gear";
import { patchHomebrewSchema } from "@/lib/schemas/homebrew";

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
  let data = parsed.data.data;
  if (data !== undefined) {
    const normalized = normalizeHomebrewData(existing.kind, data, parsed.data.name ?? existing.name);
    if ("error" in normalized) {
      return Response.json({ error: normalized.error }, { status: 400 });
    }
    data = normalized.data;
  }
  const entry = updateHomebrew(user.id, id, { name: parsed.data.name, data });
  if (!entry) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return Response.json({ entry });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { id } = await params;
  if (!deleteHomebrew(user.id, id)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
