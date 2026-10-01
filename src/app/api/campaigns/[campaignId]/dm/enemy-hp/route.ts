import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { getActiveEncounter, getEnemy, patchEnemyConditions, patchEnemyHp } from "@/lib/db/encounters";
import { enemyHpCorrection } from "@/lib/dm/catalog-enemy-hp";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The human DM's correction of an enemy's hit points (U:UD9). DM seat only;
// the AI DM has no such tool (src/lib/dm/catalog-enemy-hp.ts says why).

const bodySchema = z.object({
  enemyId: z.string().trim().min(1).max(80),
  currentHp: z.number().int().min(0).max(10000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Name the enemy and the hit points it now has." }, { status: 400 });
  }
  const encounter = getActiveEncounter(campaignId);
  const enemy = getEnemy(parsed.data.enemyId);
  if (!encounter || !enemy || enemy.encounterId !== encounter.id) {
    return Response.json({ error: "That enemy is not in the fight running now." }, { status: 404 });
  }
  const correction = enemyHpCorrection(enemy, parsed.data.currentHp);
  if ("error" in correction) {
    return Response.json({ error: correction.error }, { status: 409 });
  }
  patchEnemyHp(enemy.id, correction.currentHp, "alive");
  if (correction.wakes) {
    const meta = { ...(enemy.conditionMeta as ConditionMetaMap) };
    const kept = enemy.conditions.filter((entry) => {
      const woke = entry.trim().toLowerCase() === "unconscious";
      if (woke) {
        delete meta[entry];
      }
      return !woke;
    });
    patchEnemyConditions(enemy.id, kept, meta);
  }
  publishEncounter(campaignId);
  return Response.json({
    ok: true,
    name: enemy.displayName,
    hp: `${correction.currentHp}/${enemy.maxHp}`,
    ...(correction.wakes ? { woke: true } : {}),
  });
}
