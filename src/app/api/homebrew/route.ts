import { currentUser, unauthorized } from "@/lib/auth";
import { createHomebrew, listHomebrew } from "@/lib/db/homebrew";
import { normalizeHomebrewData } from "@/lib/homebrew/gear";
import { createHomebrewSchema, HOMEBREW_KINDS, type HomebrewKind } from "@/lib/schemas/homebrew";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The user's homebrew: items, spells and character options the pickers
// search beside the SRD and the engines read like SRD gear. Every write is
// normalized per kind (src/lib/homebrew/gear.ts), so a weapon whose damage
// the dice engine cannot roll is refused here, where a person can fix it,
// rather than mid-fight.

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
  const normalized = normalizeHomebrewData(parsed.data.kind, parsed.data.data, parsed.data.name);
  if ("error" in normalized) {
    return Response.json({ error: normalized.error }, { status: 400 });
  }
  const entry = createHomebrew(user.id, { ...parsed.data, data: normalized.data });
  return Response.json({ entry }, { status: 201 });
}
