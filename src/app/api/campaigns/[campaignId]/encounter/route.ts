import { capsFor, isErrorResponse, requireMember, requireStoryAuthority } from "@/lib/campaign-api";
import { getFloor, setFloor } from "@/lib/db/campaigns";
import { endEncounter, getActiveEncounter, listEnemies, patchEnemyHp } from "@/lib/db/encounters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { publishPersisted } from "@/lib/events";

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
// narration; the fiction is the lead's to patch up with a direction.
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
  for (const enemy of listEnemies(encounter.id)) {
    if (enemy.status === "alive") {
      patchEnemyHp(enemy.id, enemy.currentHp, "fled");
    }
  }
  endEncounter(encounter.id, "aborted");
  const floor = getFloor(campaignId);
  if (floor.mode === "initiative" || (floor.mode === "hold" && floor.next.mode === "initiative")) {
    setFloor(campaignId, { mode: "open" });
    publishPersisted(campaignId, "floor_changed", { floor: { mode: "open" } });
  }
  publishPersisted(campaignId, "encounter_updated", { encounter: null });
  publishBattleMapUpdate(campaignId);
  return Response.json({ ok: true });
}
