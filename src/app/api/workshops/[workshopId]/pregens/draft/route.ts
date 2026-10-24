import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { getCampaignForUser } from "@/lib/db/campaigns";
import { listPregens } from "@/lib/db/characters";
import { getWorkshopForUser } from "@/lib/db/workshops";
import { draftPregens, draftReadiness } from "@/lib/dm/pregen-draft";
import { DRAFT_COUNT_DEFAULT, DRAFT_COUNT_MAX } from "@/lib/dm/pregen-draft-logic";
import { publicPregen } from "@/lib/workshop/pregen-roster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Draft pregens" (src/lib/dm/pregen-draft.ts): the AI DM proposes a party
// for this workshop's adventure and the quick-build engine builds each hero.
// GET says whether it can (no AI DM set up: not, and why); POST drafts.
//
// The heroes are built at the starting level of the table being made from
// this workshop when the campaign creator asks (campaignId), and at level 1
// from the workshop itself: a player who takes one at a higher table gets
// a copy at that table's level (src/lib/db/pregen-offers.ts).

const bodySchema = z.object({
  count: z.number().int().min(1).max(DRAFT_COUNT_MAX).default(DRAFT_COUNT_DEFAULT),
  campaignId: z.string().min(1).max(80).optional(),
});

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
  return Response.json({ ...readiness, defaultCount: DRAFT_COUNT_DEFAULT, maxCount: DRAFT_COUNT_MAX });
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
  let level = 1;
  if (parsed.data.campaignId) {
    const campaign = getCampaignForUser(parsed.data.campaignId, user.id);
    if (!campaign || campaign.ownerUserId !== user.id) {
      return Response.json({ error: "Campaign not found." }, { status: 404 });
    }
    level = Math.min(20, Math.max(1, campaign.startingLevel || 1));
  }
  const readiness = await draftReadiness(workshop);
  if (!readiness.ready) {
    return Response.json({ error: readiness.reason, reason: "no_ai" }, { status: 409 });
  }
  if (drafting().has(workshop.id)) {
    return Response.json({ error: "The AI DM is already drafting pregens for this workshop." }, { status: 409 });
  }
  drafting().add(workshop.id);
  try {
    const outcome = await draftPregens({ workshop, userId: user.id, count: parsed.data.count, level });
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
