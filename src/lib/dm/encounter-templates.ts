import type { Campaign } from "@/lib/db/campaigns";
import { partyLevelsFor } from "@/lib/dm/party-budget";
import { resolveEnemyRequests } from "@/lib/dm/encounter-spawn";
import { encounterCeiling, evaluateEncounter } from "@/lib/srd/encounter-math";
import { invokeEngine } from "@/lib/dm/invoke";
import { deployPreparedMap } from "@/lib/dm/map-library";
import { applyStudioMap } from "@/lib/dm/map-studio";
import type { EncounterTemplate } from "@/lib/db/encounter-templates";
import { allocateSeq } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, patchEnemyIdentity } from "@/lib/db/encounters";
import {
  getBattleMapForEncounter,
  getTokenByRef,
  listTokens,
  placeToken,
  renameTokenByRef,
  setTokenHidden,
} from "@/lib/db/battle-maps";
import { insertNote } from "@/lib/db/notes";
import { nearestOpenTile } from "@/lib/battlemap/paint";
import { occupiedTiles } from "@/lib/battlemap/view";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import type { MapTheme } from "@/lib/battlemap/generate";
import { tileIndex, type AmbientLight } from "@/lib/battlemap/types";
import {
  describeExtras,
  expandRoster,
  matchSlots,
  type TemplateEnemy,
} from "@/lib/dm/encounter-template-logic";

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
  const mapError = applyTemplateMap(campaign, template);
  // The rest of the plan lands on whatever board the fight ended up with:
  // where each enemy starts, who is hidden, the overrides, and the note.
  applyTemplateExtras(campaign, userId, template);
  return mapError
    ? { ok: true, result: outcome.result, mapError }
    : { ok: true, result: outcome.result };
}

// The saved map settings, applied after the fight exists. Returns the one
// sentence to show when the map could not be applied, or null.
function applyTemplateMap(campaign: Campaign, template: EncounterTemplate): string | null {
  const settings = template.map;
  // A linked prepared map wins over the generation dials: a DM who picked a
  // drawn map meant that map, not a reroll of its seed. A mapId that no
  // longer resolves (the map was forgotten since, or the template arrived in
  // a bundle whose maps did not travel) lands in mapError through the same
  // half-deploy path as any other map failure, and the fight stands.
  if (settings.mapId) {
    const applied = deployPreparedMap(campaign, settings.mapId);
    return "error" in applied ? applied.error : null;
  }
  const wanted =
    settings.seed !== null ||
    settings.theme !== null ||
    settings.ambient !== null ||
    settings.width !== null ||
    settings.height !== null;
  if (!wanted) {
    return null;
  }
  const applied = applyStudioMap(campaign, {
    seed: settings.seed ?? undefined,
    width: settings.width ?? undefined,
    height: settings.height ?? undefined,
    theme: (settings.theme as MapTheme | null) ?? undefined,
    ambient: (settings.ambient as AmbientLight | null) ?? undefined,
    hint: template.battlefield || undefined,
  });
  return "error" in applied ? applied.error : null;
}

// Placements, hidden enemies, overrides and the DM's note. Every part is
// best effort against the fight that was actually made: a slot the roster
// no longer has, or a tile that is now rock, is skipped rather than
// undoing a fight the enemies are already rolled into.
function applyTemplateExtras(campaign: Campaign, userId: string, template: EncounterTemplate) {
  const extras = template.extras;
  const hasBoardWork = extras.placements.length || extras.hidden.length || extras.overrides.length || extras.entry;
  const encounter = getActiveEncounter(campaign.id);
  if (encounter && hasBoardWork) {
    const map = getBattleMapForEncounter(encounter.id);
    const enemies = listEnemies(encounter.id).filter((enemy) => enemy.status === "alive");
    const matched = matchSlots(expandRoster(template.enemies), enemies);
    for (const override of extras.overrides) {
      const enemy = matched.get(override.slot);
      if (!enemy) {
        continue;
      }
      patchEnemyIdentity(enemy.id, { displayName: override.name, maxHp: override.hp });
      if (override.name && map) {
        renameTokenByRef(map.id, enemy.id, override.name);
      }
    }
    if (map) {
      const tokens = listTokens(map.id);
      const taken = occupiedTiles(map, tokens, null);
      const moveTo = (tokenId: string, from: { x: number; y: number }, current: { x: number; y: number }) => {
        taken.delete(tileIndex(map.width, current.x, current.y));
        const spot = nearestOpenTile(map.terrain, map.width, map.height, from, taken);
        taken.add(tileIndex(map.width, spot.x, spot.y));
        placeToken(tokenId, spot.x, spot.y);
      };
      for (const placement of extras.placements) {
        const enemy = matched.get(placement.slot);
        const token = enemy ? getTokenByRef(map.id, enemy.id) : null;
        if (token) {
          moveTo(token.id, placement, token);
        }
      }
      if (extras.entry) {
        for (const token of tokens.filter((entry) => entry.kind === "pc")) {
          moveTo(token.id, extras.entry, token);
        }
      }
      for (const slot of extras.hidden) {
        const enemy = matched.get(slot);
        const token = enemy ? getTokenByRef(map.id, enemy.id) : null;
        if (token) {
          setTokenHidden(token.id, true);
        }
      }
      publishBattleMapUpdate(campaign.id);
    }
    publishEncounter(campaign.id);
  }
  const lines = describeExtras(extras);
  if (lines.length) {
    insertNote({
      campaignId: campaign.id,
      characterId: null,
      authorUserId: userId,
      authorKind: "dm",
      visibility: "private",
      status: "active",
      title: `${template.name}: the plan`,
      body: lines.join("\n"),
      seq: allocateSeq(campaign.id),
    });
  }
}
