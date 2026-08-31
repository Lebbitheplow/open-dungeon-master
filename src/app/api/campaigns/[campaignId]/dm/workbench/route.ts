import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { resolveMonster } from "@/lib/bestiary";
import { partyLevelsFor } from "@/lib/dm/party-budget";
import { workbench, type WorkbenchRosterEntry } from "@/lib/dm/encounter-workbench";
import {
  checkRoster,
  parseRoster,
  TEMPLATE_MAX_ENEMIES,
} from "@/lib/dm/encounter-template-logic";
import { encounterCeiling, thresholdsForParty } from "@/lib/srd/encounter-math";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The encounter workbench: a roster in, the whole readout back.
//
// The roster arrives as the same shorthand the console's Start a fight box
// and the prepared-encounter panel already take ("goblin x4"), parsed by the
// same function, and every monster is resolved by the same resolver
// start_encounter uses. That is the point: a fight that reads "hard" here is
// one the engine will also treat as hard, and a monster this cannot find is
// one the engine would refuse.
//
// Nothing is written. This is a calculator.

const bodySchema = z.object({
  enemies: z.string().trim().min(1).max(2_000),
  // Overriding the party is what makes this a workbench rather than a
  // readout: "what if they are two levels higher" is the question a DM
  // planning ahead is actually asking.
  partyLevel: z.number().int().min(1).max(20).optional(),
  partySize: z.number().int().min(1).max(8).optional(),
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
  const { campaign } = context;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "A roster needs at least one monster." }, { status: 400 });
  }

  const roster = checkRoster(parseRoster(parsed.data.enemies));
  if ("error" in roster) {
    return Response.json({ error: roster.error }, { status: 400 });
  }

  const resolved: WorkbenchRosterEntry[] = [];
  for (const row of roster.rows) {
    const match = resolveMonster(row.monster, campaign.gameSettings, {
      userId: campaign.ownerUserId,
    });
    if (!match) {
      return Response.json(
        { error: `Nothing in the bestiary answers to "${row.monster}".` },
        { status: 400 },
      );
    }
    resolved.push({
      name: match.reskinName ?? match.baseName,
      count: row.count,
      stats: match.stats,
    });
  }

  // The party the numbers are measured against: this campaign's, unless the
  // DM asked a what-if.
  const levels =
    parsed.data.partyLevel !== undefined || parsed.data.partySize !== undefined
      ? Array.from(
          { length: parsed.data.partySize ?? partyLevelsFor(campaign).length },
          () => parsed.data.partyLevel ?? partyLevelsFor(campaign)[0] ?? 1,
        )
      : partyLevelsFor(campaign);

  const readout = workbench({
    partyLevels: levels,
    roster: resolved,
    variantRules: {
      powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
      multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
    },
    ceiling: encounterCeiling(campaign.difficulty, thresholdsForParty(levels).deadly),
  });

  return Response.json({
    readout,
    party: { levels, size: levels.length },
    roster: resolved.map((entry) => ({
      name: entry.name,
      count: entry.count,
      cr: entry.stats.cr,
      ac: entry.stats.ac,
      hp: entry.stats.maxHp,
    })),
    // The cap the engine enforces, so the panel can say why a bigger roster
    // will not deploy even though the maths for it is fine.
    maxEnemies: TEMPLATE_MAX_ENEMIES,
  });
}
