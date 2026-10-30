// One with Shadows (SRD 5.1, a warlock invocation): "When you are in an area
// of dim light or darkness, you can use your action to become invisible until
// you move or take an action or a reaction." (issue #570, the SRD text audit,
// CLS-26). Before this use_resource did not know it at all.
//
// The use is a use_resource action (src/lib/dm/resource-tools.ts): on a
// battle map the warlock's square must be in dim light or darkness, as the
// board's light, its spell areas and the lights carried and placed say; off
// the map the GM judges the light. The invisibility it gives carries the
// invocation as its source, and ends when the warlock moves (the move route
// and move_token), takes an action (take_action; an attack or a spell ends
// any invisibility but Greater Invisibility's already, attack-marks.ts) or
// takes a reaction (markReactionUsed).
import { getClock } from "@/lib/db/clock";
import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { effectiveAmbient } from "@/lib/battlemap/daylight";
import { cachedLitTiles } from "@/lib/battlemap/lit-cache";
import { ambientAt, magicalDarknessAt } from "@/lib/battlemap/scene";
import { tileIndex } from "@/lib/battlemap/types";
import { breakDown } from "@/lib/dm/calendar";
import { lightsWithZones } from "@/lib/dm/zone-rules";
import { weatherObscurementTiles } from "@/lib/srd/weather";
import { removeConditionInstances, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { isNamed } from "@/lib/srd/feature-names";

export const ONE_WITH_SHADOWS = "One with Shadows";

// Why the warlock's square is too bright to vanish in, or null when it is dim
// or dark (or there is no board to read the light from).
export function shadowLightProblem(campaignId: string, sheet: Pick<CharacterSheet, "id" | "name">): ToolError | null {
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!map || !token) {
    return null;
  }
  const clock = getClock(campaignId);
  const ambient = effectiveAmbient(map.ambient, map.outdoors, breakDown(clock.calendar, clock.instant).hour, clock.weather);
  const zones = lightsWithZones(map);
  if (zones.length && magicalDarknessAt(zones, token.x, token.y)) {
    return null;
  }
  const local = zones.length ? ambientAt(zones, token.x, token.y, ambient) : ambient;
  // A lamp or a carried light on the square brightens it; the lit set does
  // not tell its bright radius from its dim one, so a lit square counts as
  // bright.
  const lit =
    local !== "bright" &&
    cachedLitTiles(
      {
        id: map.id,
        terrain: map.terrain,
        width: map.width,
        height: map.height,
        ambient,
        zones,
        obscureBeyond: map.outdoors ? weatherObscurementTiles(clock.weather) : Infinity,
      },
      listTokens(map.id),
      map.lights,
    ).has(tileIndex(map.width, token.x, token.y));
  if (local === "bright" || lit) {
    return {
      error: `${sheet.name} stands in bright light at (${token.x},${token.y}); One with Shadows works only in dim light or darkness. Nothing was spent.`,
      refused: "rules",
    };
  }
  return null;
}

// The invisibility One with Shadows gives, as the condition list and meta to
// write: an instance with the invocation as its source and no rounds, since
// it lasts until the warlock moves or acts.
export function shadowInvisibility(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">): Pick<CharacterSheet, "conditions" | "conditionMeta"> {
  const meta = { ...(sheet.conditionMeta as ConditionMetaMap) };
  meta.invisible = { source: ONE_WITH_SHADOWS };
  return {
    conditions: sheet.conditions.some((name) => isNamed(name, "invisible")) ? sheet.conditions : [...sheet.conditions, "invisible"],
    conditionMeta: meta as CharacterSheet["conditionMeta"],
  };
}

// Ends the warlock's One with Shadows invisibility because they moved, took
// an action or a reaction. Returns a line for the result, or null when they
// held none.
export function endShadowInvisibility(campaignId: string, sheetId: string, why: string): string | null {
  const sheet = getSheetById(sheetId);
  if (!sheet || !sheet.conditions.some((name) => isNamed(name, "invisible"))) {
    return null;
  }
  const held = sheet.conditions.find((name) => isNamed(name, "invisible")) ?? "invisible";
  const cleared = removeConditionInstances(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, held, (entry) => isNamed(entry.source ?? "", ONE_WITH_SHADOWS));
  if (!cleared.removed) {
    return null;
  }
  const updated = patchSheet(sheetId, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
  return `${sheet.name} ${why}, and One with Shadows' invisibility ends.`;
}
