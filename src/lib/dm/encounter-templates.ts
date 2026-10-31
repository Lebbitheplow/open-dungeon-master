import type { Campaign } from "@/lib/db/campaigns";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { partyLevelsFor, rosterBudget } from "@/lib/dm/party-budget";
import { preparedFit } from "@/lib/dm/prepared-fit";
import { resolveEnemyRequests } from "@/lib/dm/encounter-spawn";
import { resolveMonster } from "@/lib/bestiary";
import { invokeEngine } from "@/lib/dm/invoke";
import type { EncounterTemplate } from "@/lib/db/encounter-templates";
import { applyTemplateExtras, applyTemplateMap } from "@/lib/dm/template-apply";
import { rosterSummary, type TemplateEnemy } from "@/lib/dm/encounter-template-logic";

// What a prepared encounter is worth, and what happens when the DM deploys
// it. Both answers come from the engine that already owns them: the same
// XP maths start_encounter refuses fights with, and start_encounter itself.

export type TemplateReadout = {
  // "hard for this party", or why the roster cannot be costed.
  verdict: string;
  adjustedXp: number;
  // The ceiling start_encounter will refuse above, at this difficulty.
  ceiling: number;
  // True when deploying would be refused as written: past the ceiling, or
  // more creatures than a fight takes.
  tooDeadly: boolean;
  // What the storyteller runs instead (src/lib/dm/prepared-fit.ts): the
  // creatures it leaves out ("goblin x3"), or held when even the strongest
  // alone is beyond the party. Empty and false when the fight runs as
  // written.
  scaledWithout: string;
  held: boolean;
  // The first monster reference the bestiary could not resolve, if any.
  unknownMonster: string | null;
  count: number;
  // A hand-built monster's name by the ref its roster line carries
  // ("homebrew:<id>", rosterLabel), for the rows that list the roster.
  names: Record<string, string>;
};

// The difficulty readout the plan asks for, computed the way the engine
// computes it, so a template that reads "deadly" is a template
// start_encounter will treat as deadly.
export function templateDifficulty(
  campaign: Campaign,
  enemies: TemplateEnemy[],
): TemplateReadout {
  const levels = partyLevelsFor(campaign);
  const authors = spellAuthorsFor(campaign);
  const names: Record<string, string> = {};
  for (const row of enemies) {
    if (row.monster.startsWith("homebrew:")) {
      const own = resolveMonster(row.monster, campaign.gameSettings, { userIds: authors });
      if (own) {
        names[row.monster] = own.baseName;
      }
    }
  }
  const outcome = resolveEnemyRequests(
    campaign.gameSettings,
    enemies.map((row) => ({ monster: row.monster, count: row.count })),
    authors,
    // The table's cast, as start_encounter reads it: an NPC with a stat
    // block, a companion come back against the party (issue 503).
    campaign.id,
  );
  if (!("resolved" in outcome)) {
    return {
      verdict: "unknown monster",
      adjustedXp: 0,
      ceiling: 0,
      tooDeadly: false,
      scaledWithout: "",
      held: false,
      unknownMonster: "unknownMonster" in outcome ? outcome.unknownMonster : outcome.unknownReturning,
      count: 0,
      names,
    };
  }
  // The same rails start_encounter reads (src/lib/dm/party-budget.ts).
  const budget = rosterBudget(campaign, levels, outcome.resolved);
  const refused = budget.tooDeadly || budget.tooMany;
  const fit = refused ? preparedFit(campaign, enemies) : null;
  return {
    verdict: `${budget.evaluation.verdict.replace(/_/g, " ")} for this party`,
    adjustedXp: budget.stagedXp,
    ceiling: budget.ceiling,
    tooDeadly: refused,
    scaledWithout: fit?.kind === "scaled" ? rosterSummary(fit.dropped) : "",
    held: fit?.kind === "held",
    unknownMonster: null,
    count: outcome.resolved.length,
    names,
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
        ...(template.map.scene ? { scene: template.map.scene } : {}),
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
  const mapError = applyTemplateMap(campaign, template);
  // The rest of the plan lands on whatever board the fight ended up with:
  // where each enemy starts, who is hidden, the overrides, and the note.
  applyTemplateExtras(campaign, userId, template);
  return mapError
    ? { ok: true, result: outcome.result, mapError }
    : { ok: true, result: outcome.result };
}
