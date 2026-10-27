import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { listPregens } from "@/lib/db/characters";
import { getWorkshopForUser } from "@/lib/db/workshops";
import { draftPregens, draftReadiness } from "@/lib/dm/pregen-draft";
import { DRAFT_COUNT_MAX } from "@/lib/dm/pregen-draft-logic";
import { normalizeTargetParty } from "@/lib/workshop/kind";
import { publicPregen } from "@/lib/workshop/pregen-roster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Draft pregens" (src/lib/dm/pregen-draft.ts): the AI DM proposes a party
// for this workshop's adventure and the quick-build engine builds each hero.
// GET says whether it can (no AI DM set up: not, and why); POST drafts.
//
// One hero for each seat of the party the workshop is built for, at its
// level (the target party bar), as the Party tool's Build makes one: the
// roster's off-level flag stays quiet on a fresh draft, and a player who
// takes one at another table gets a copy at that table's level
// (src/lib/db/pregen-offers.ts). A count may be named, within that party's
// largest size.

const bodySchema = z.object({
  count: z.number().int().min(1).max(DRAFT_COUNT_MAX).optional(),
});

function draftSize(workshop: { gameSettings: { targetParty?: unknown } }) {
  const party = normalizeTargetParty(workshop.gameSettings.targetParty);
  return { count: Math.min(DRAFT_COUNT_MAX, party.size), level: party.level };
}

// One draft at a time per workshop: a second press while the AI DM is
// still answering would draft a second party.
declare global {
  var __odmPregenDrafts: Set<string> | undefined;
}
const drafting = () => (globalThis.__odmPregenDrafts ??= new Set<string>());

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

export async function GET(_request: Request, { params }: { params: Promise<{ workshopId: string }> }) {
  const { workshopId } = await params;
  const resolved = await resolve(workshopId);
  if (resolved.error) {
    return resolved.error;
  }
  const readiness = await draftReadiness(resolved.workshop);
  return Response.json({ ...readiness, ...draftSize(resolved.workshop) });
}

export async function POST(request: Request, { params }: { params: Promise<{ workshopId: string }> }) {
  const { workshopId } = await params;
  const resolved = await resolve(workshopId);
  if (resolved.error) {
    return resolved.error;
  }
  const { user, workshop } = resolved;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: `Draft between 1 and ${DRAFT_COUNT_MAX} pregens.` }, { status: 400 });
  }
  const party = draftSize(workshop);
  const count = parsed.data.count ?? party.count;
  const { level } = party;
  const readiness = await draftReadiness(workshop);
  if (!readiness.ready) {
    return Response.json({ error: readiness.reason, reason: "no_ai" }, { status: 409 });
  }
  if (drafting().has(workshop.id)) {
    return Response.json({ error: "The AI GM is already drafting pregens for this workshop." }, { status: 409 });
  }
  drafting().add(workshop.id);
  try {
    const outcome = await draftPregens({ workshop, userId: user.id, count, level });
    if (!outcome.ok) {
      return Response.json({ error: outcome.error }, { status: outcome.status });
    }
    return Response.json(
      {
        drafted: outcome.characters.map((character) => character.id),
        changes: outcome.changes,
        level,
        pregens: listPregens(user.id, workshop.id).map(publicPregen),
      },
      { status: 201 },
    );
  } finally {
    drafting().delete(workshop.id);
  }
}
