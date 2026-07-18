import { currentUser, unauthorized } from "@/lib/auth";
import { deleteHomebrew, updateHomebrew } from "@/lib/db/homebrew";
import { patchHomebrewSchema } from "@/lib/schemas/homebrew";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { id } = await params;
  const raw = await request.json().catch(() => ({}));
  const parsed = patchHomebrewSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid homebrew patch." }, { status: 400 });
  }
  const entry = updateHomebrew(user.id, id, parsed.data);
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
