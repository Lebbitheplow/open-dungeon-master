import type { Campaign } from "@/lib/db/campaigns";
import { partyLevelsFor } from "@/lib/dm/party-budget";
import { resolveEnemyRequests } from "@/lib/dm/encounter-spawn";
import { encounterCeiling, evaluateEncounter } from "@/lib/srd/encounter-math";
import { invokeEngine } from "@/lib/dm/invoke";
import { deployPreparedMap } from "@/lib/dm/map-library";
import { applyStudioMap } from "@/lib/dm/map-studio";
import type { EncounterTemplate } from "@/lib/db/encounter-templates";
import type { MapTheme } from "@/lib/battlemap/generate";
import type { AmbientLight } from "@/lib/battlemap/types";
import type { TemplateEnemy } from "@/lib/dm/encounter-template-logic";

// What a prepared encounter is worth, and what happens when the DM deploys
// it. Both answers come from the engine that already owns them: the same
// XP maths start_encounter refuses fights with, and start_encounter itself.

export type TemplateReadout = {
  // "hard for this party", or why the roster cannot be costed.
  verdict: string;
  adjustedXp: number;
  // The ceiling start_encounter will refuse above, at this difficulty.
  ceiling: number;
  // True when deploying would be refused as written.
  tooDeadly: boolean;
  // The first monster reference the bestiary could not resolve, if any.
  unknownMonster: string | null;
  count: number;
};

// The difficulty readout the plan asks for, computed the way the engine
// computes it, so a template that reads "deadly" is a template
// start_encounter will treat as deadly.
export function templateDifficulty(
  campaign: Campaign,
  enemies: TemplateEnemy[],
): TemplateReadout {
  const levels = partyLevelsFor(campaign);
  const outcome = resolveEnemyRequests(
    campaign.gameSettings,
    enemies.map((row) => ({ monster: row.monster, count: row.count })),
    campaign.ownerUserId,
  );
  if ("unknownMonster" in outcome) {
    return {
      verdict: "unknown monster",
      adjustedXp: 0,
      ceiling: 0,
      tooDeadly: false,
      unknownMonster: outcome.unknownMonster,
      count: 0,
    };
  }
  const evaluation = evaluateEncounter(
    levels,
    outcome.resolved.map((entry) => entry.stats.cr),
  );
  const ceiling = encounterCeiling(campaign.difficulty, evaluation.thresholds.deadly);
  return {
    verdict: `${evaluation.verdict.replace(/_/g, " ")} for this party`,
    adjustedXp: evaluation.adjustedXp,
    ceiling,
    tooDeadly: evaluation.adjustedXp > ceiling,
    unknownMonster: null,
    count: outcome.resolved.length,
  };
}

export type DeployOutcome =
  | { ok: true; result: Record<string, unknown>; mapError?: string }
  | { ok: false; error: string };

// Deploying is not a second way to start a fight. It fills in the same form
// the console offers and pushes it through the same façade, so every refusal
// the engine already makes (a fight is running, too deadly, unknown monster)
// still happens and still says the same thing.
export async function deployTemplate(
  campaign: Campaign,
  userId: string,
  template: EncounterTemplate,
): Promise<DeployOutcome> {
  const outcome = await invokeEngine(
    campaign,
    { kind: "human", userId },
    {
      name: "start_encounter",
      args: {
        enemies: template.enemies,
        summary: template.notes.split("\n")[0]?.slice(0, 200) ?? "",
        battlefield: template.battlefield,
      },
    },
  );
  if (!outcome.ok) {
    return { ok: false, error: outcome.error };
  }
  // The saved map settings are applied after the fight exists, because the
  // board they replace is the one start_encounter just made. A map that
  // cannot be applied is reported and does not undo the fight: the enemies
  // are already rolled into initiative, and a half-deployed encounter is
  // worse than one on the generator's own map.
  const settings = template.map;
  // A linked prepared map wins over the generation dials: a DM who picked a
  // drawn map meant that map, not a reroll of its seed. A mapId that no
  // longer resolves (the map was forgotten since, or the template arrived in
  // a bundle whose maps did not travel) lands in mapError through the same
  // half-deploy path as any other map failure, and the fight stands.
  if (settings.mapId) {
    const applied = deployPreparedMap(campaign, settings.mapId);
    return "error" in applied
      ? { ok: true, result: outcome.result, mapError: applied.error }
      : { ok: true, result: outcome.result };
  }
  const wanted =
    settings.seed !== null ||
    settings.theme !== null ||
    settings.ambient !== null ||
    settings.width !== null ||
    settings.height !== null;
  if (!wanted) {
    return { ok: true, result: outcome.result };
  }
  const applied = applyStudioMap(campaign, {
    seed: settings.seed ?? undefined,
    width: settings.width ?? undefined,
    height: settings.height ?? undefined,
    theme: (settings.theme as MapTheme | null) ?? undefined,
    ambient: (settings.ambient as AmbientLight | null) ?? undefined,
    hint: template.battlefield || undefined,
  });
  return "error" in applied
    ? { ok: true, result: outcome.result, mapError: applied.error }
    : { ok: true, result: outcome.result };
}
