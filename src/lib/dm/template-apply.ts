import type { Campaign } from "@/lib/db/campaigns";
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
import { describeExtras, expandRoster, matchSlots } from "@/lib/dm/encounter-template-logic";

// What a prepared fight brings to the board once the fight exists: its
// saved map and the rest of its plan. Split from src/lib/dm/encounter-
// templates.ts so the storyteller's run_prepared_encounter tool
// (src/lib/dm/prepared-encounter-tool.ts) applies the very same steps a DM's
// Deploy does, without the encounter tools importing the adjudication
// facade that imports them.

// The saved map settings, applied after the fight exists. Returns the one
// sentence to show when the map could not be applied, or null.
export function applyTemplateMap(campaign: Campaign, template: EncounterTemplate): string | null {
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
  });
  return "error" in applied ? applied.error : null;
}

// Placements, hidden enemies, overrides and the DM's note. Every part is
// best effort against the fight that was actually made: a slot the roster
// no longer has, or a tile that is now rock, is skipped rather than
// undoing a fight the enemies are already rolled into.
export function applyTemplateExtras(campaign: Campaign, userId: string, template: EncounterTemplate) {
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
