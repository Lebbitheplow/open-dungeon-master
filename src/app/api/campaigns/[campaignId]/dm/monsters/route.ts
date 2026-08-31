import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { delegated } from "@/lib/dm/delegation";
import { monstersReady, playMonsterTurns } from "@/lib/dm/delegate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Assisted mode: the DM hands the monsters' turn to the AI.
//
// Every action the AI takes here goes through invokeEngine with actor.kind
// "ai" (src/lib/dm/delegate.ts), so the reach checks, the dice, the damage and
// the audit trail are the same ones a person clicking "Enemy attacks" in the
// console gets. What is delegated is the choosing, not the resolving.

// How many monsters a press would move, so the console can label the button
// honestly instead of offering it into an empty fight.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const { campaign } = context;
  return Response.json({
    delegated: delegated(
      campaign.gameSettings.dmMode,
      campaign.gameSettings.dmAssist,
      "monsters",
    ),
    ready: monstersReady(campaignId).map((enemy) => ({
      id: enemy.id,
      name: enemy.displayName,
      initiative: enemy.initiative,
    })),
  });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const { campaign } = context;
  if (campaign.status !== "active") {
    return Response.json({ error: "The adventure has not started yet." }, { status: 400 });
  }
  if (!delegated(campaign.gameSettings.dmMode, campaign.gameSettings.dmAssist, "monsters")) {
    return Response.json(
      { error: "The monsters are yours to run; turn on AI monsters under Game settings." },
      { status: 403 },
    );
  }

  const outcome = await playMonsterTurns(campaign);
  if (outcome.error) {
    // Nothing to do is an answer, not a failure: 409 so the console shows it
    // the way it shows any other refusal from the engine.
    return Response.json({ error: outcome.error }, { status: 409 });
  }
  return Response.json({ notes: outcome.notes });
}
