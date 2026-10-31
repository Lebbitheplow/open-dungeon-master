import { capsFor, isErrorResponse, requireMember, requireStoryAuthority } from "@/lib/campaign-api";
import { endEncounter, getActiveEncounter, listEnemies, patchEnemyHp } from "@/lib/db/encounters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { afterTheFight, settleFightState } from "@/lib/dm/enemy-damage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The caller's projection of the active fight. The shared stream carries
// only the player-safe payload, so a DM (who is allowed the real hit points
// and AC) re-fetches here after every encounter_updated ping, the same
// ping-and-self-fetch pattern the fogged battle map already uses.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({
    encounter: activePublicEncounter(campaignId, {
      enemyNumbers: capsFor(context).enemyNumbers,
    }),
  });
}

// Lead escape hatch: force-end a wedged encounter. No XP, no outcome
// narration; the fiction is the lead's to patch up with a direction. What
// follows any fight's end follows this one too (enemy-damage.ts
// afterTheFight, issue 657): the fight music stopped only for a fight that
// ended in play, and a guest ally stayed on in the party.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return Response.json({ error: "No active encounter." }, { status: 404 });
  }
  const enemies = listEnemies(encounter.id);
  for (const enemy of enemies) {
    if (enemy.status === "alive") {
      patchEnemyHp(enemy.id, enemy.currentHp, "fled");
    }
  }
  endEncounter(encounter.id, "aborted");
  // A fight called off is over all the same: what lasted until its end ends.
  settleFightState(context.campaign, encounter.id);
  afterTheFight(context.campaign, encounter, enemies);
  return Response.json({ ok: true });
}
