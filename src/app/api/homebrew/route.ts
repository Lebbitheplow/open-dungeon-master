import { currentUser, unauthorized } from "@/lib/auth";
import { createHomebrew, listHomebrew } from "@/lib/db/homebrew";
import { normalizeHomebrewData } from "@/lib/homebrew/gear";
import { homebrewLimitProblems } from "@/lib/homebrew/limits";
import { serverPublishedNameProblem } from "@/lib/homebrew/published-names-server";
import { forgetTableFeats } from "@/lib/db/table-feats";
import { forgetTableHazards } from "@/lib/db/table-hazards";
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
  // ?archived=1: the forgotten entries, for the shelf's Forgotten view.
  const archived = new URL(request.url).searchParams.get("archived") === "1";
  return Response.json({ entries: listHomebrew(user.id, kind, archived ? { archived: "only" } : {}) });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = createHomebrewSchema.safeParse(raw);
  if (!parsed.success) {
    // A description past what an entry keeps fails the schema as well: it is
    // named, as the limits check below names it (WA-02).
    const kind = (raw as { kind?: unknown })?.kind;
    const problems = HOMEBREW_KINDS.includes(kind as HomebrewKind) ? homebrewLimitProblems(kind as HomebrewKind, (raw as { data?: unknown }).data) : [];
    const over = problems[0];
    return Response.json(over ? { error: over.text, field: over.field } : { error: "Invalid homebrew entry." }, { status: 400 });
  }
  const published = serverPublishedNameProblem(parsed.data.kind, parsed.data.name);
  if (published) {
    return Response.json({ error: published }, { status: 400 });
  }
  // A list longer than its kind keeps is refused by name, not cut short.
  const over = homebrewLimitProblems(parsed.data.kind, parsed.data.data)[0];
  if (over) {
    return Response.json({ error: over.text, field: over.field }, { status: 400 });
  }
  const normalized = normalizeHomebrewData(parsed.data.kind, parsed.data.data, parsed.data.name);
  if ("error" in normalized) {
    return Response.json({ error: normalized.error }, { status: 400 });
  }
  const entry = createHomebrew(user.id, { ...parsed.data, data: normalized.data });
  forgetTableFeats();
  forgetTableHazards();
  return Response.json({ entry }, { status: 201 });
}
