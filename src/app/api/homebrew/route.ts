import { currentUser, unauthorized } from "@/lib/auth";
import { createHomebrew, listHomebrew } from "@/lib/db/homebrew";
import { createHomebrewSchema, HOMEBREW_KINDS, type HomebrewKind } from "@/lib/schemas/homebrew";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const kindParam = new URL(request.url).searchParams.get("kind");
  const kind = HOMEBREW_KINDS.includes(kindParam as HomebrewKind)
    ? (kindParam as HomebrewKind)
    : undefined;
  return Response.json({ entries: listHomebrew(user.id, kind) });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = createHomebrewSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid homebrew entry." }, { status: 400 });
  }
  const entry = createHomebrew(user.id, parsed.data);
  return Response.json({ entry }, { status: 201 });
}
