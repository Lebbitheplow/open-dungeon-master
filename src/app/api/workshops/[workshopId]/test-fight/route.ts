import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { testFightsOf } from "@/lib/db/test-fights";
import { getWorkshopForUser } from "@/lib/db/workshops";
import { TARGET_PARTY_LIMITS } from "@/lib/workshop/kind";
import { standInClasses } from "@/lib/workshop/stand-ins";
import { endTestFights, openTestFight, testFightReadiness } from "@/lib/workshop/test-fight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A workshop's test fight (issue 553, src/lib/workshop/test-fight.ts): what
// the Test fight sheet reads before it offers the button (whether an AI DM
// can run one, the stand-in party, the test already open), starting one,
// and ending it.

const startSchema = z.object({
  templateId: z.string().trim().min(1).max(80),
  party: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("stand-ins") }),
    z.object({
      kind: z.literal("characters"),
      characterIds: z.array(z.string().trim().min(1).max(80)).min(1).max(TARGET_PARTY_LIMITS.size.max),
    }),
  ]),
});

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const resolved = await resolve(workshopId);
  if (resolved.error) {
    return resolved.error;
  }
  const { user, workshop } = resolved;
  const readiness = await testFightReadiness(workshop);
  const party = workshop.gameSettings.targetParty;
  return Response.json({
    ready: readiness.ready,
    reason: readiness.reason,
    standIns: { size: party.size, level: party.level, classes: standInClasses(party.size) },
    open: testFightsOf(workshop.id, user.id)[0] ?? null,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const resolved = await resolve(workshopId);
  if (resolved.error) {
    return resolved.error;
  }
  const parsed = startSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Pick a fight and who fights it." }, { status: 400 });
  }
  const outcome = await openTestFight({
    workshop: resolved.workshop,
    userId: resolved.user.id,
    templateId: parsed.data.templateId,
    party: parsed.data.party,
  });
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: outcome.status });
  }
  return Response.json({ ok: true, campaignId: outcome.campaignId });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const resolved = await resolve(workshopId);
  if (resolved.error) {
    return resolved.error;
  }
  return Response.json({ ok: true, ended: endTestFights(resolved.workshop.id, resolved.user.id) });
}
