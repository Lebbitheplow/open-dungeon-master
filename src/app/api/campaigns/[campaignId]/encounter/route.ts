import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { getFloor, setFloor } from "@/lib/db/campaigns";
import { endEncounter, getActiveEncounter, listEnemies, patchEnemyHp } from "@/lib/db/encounters";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lead escape hatch: force-end a wedged encounter. No XP, no outcome
// narration; the fiction is the lead's to patch up with a direction.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
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
