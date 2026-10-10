// Where the spell areas of a board live: battle_maps.spell_zones_json, read
// back through the map row (src/lib/db/battle-maps.ts spellZones) and
// written here. Which areas still hold is decided here too: one whose
// caster's concentration on it has ended, or whose rounds have run out, or
// whose damage budget is spent, is gone.
//
// Must not import encounter-tools, map-tools or mutations (they reach here).

import { getDatabase, nowIso } from "@/lib/db/core";
import { getBattleMapForEncounter, listTokens, type BattleMap } from "@/lib/db/battle-maps";
import { getActiveBoard, getEnemy, type Encounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { publishEphemeral } from "@/lib/events";
import { MAX_ZONES, withAnchors, type SpellZone } from "@/lib/battlemap/zones";
import { zoneKey, zoneRowFor } from "@/lib/battlemap/zones-spells";
import { holdGasesBack } from "@/lib/battlemap/zones-walls";

export function saveZones(mapId: string, zones: SpellZone[]) {
  getDatabase()
    .prepare(`UPDATE battle_maps SET spell_zones_json = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(zones.slice(-MAX_ZONES)), nowIso(), mapId);
}

// The board changed under everyone: a refetch, as a token move does.
export function publishZones(campaignId: string) {
  publishEphemeral(campaignId, "battle_map_updated", {});
}

// Whether the caster still holds this area up: concentrating on the spell
// (a character's sheet, an enemy's row), and standing.
export function casterHolds(zone: SpellZone): boolean {
  // A Wall of Ice's frigid air holds while its caster holds the wall (by
  // the wall's own name, a renamed workshop copy's too).
  const wanted = zoneKey(zone.heldBy ?? zoneRowFor(zone)?.heldBy ?? zone.spell);
  if (zone.casterKind === "enemy") {
    const enemy = getEnemy(zone.casterId);
    return Boolean(enemy && enemy.status === "alive" && enemy.concentration && zoneKey(enemy.concentration) === wanted);
  }
  const sheet = getSheetById(zone.casterId);
  return Boolean(sheet && !sheet.deathSaves?.dead && sheet.concentratingOn && zoneKey(sheet.concentratingOn) === wanted);
}

// Whether an area still holds in this round.
export function zoneHolds(zone: SpellZone, round: number): boolean {
  const row = zoneRowFor(zone);
  if (!row) {
    return false;
  }
  if (zone.untilRound !== null && round > zone.untilRound) {
    return false;
  }
  if (row.budget && (zone.dealt ?? 0) >= row.budget) {
    return false;
  }
  return !zone.concentration || casterHolds(zone);
}

// The areas that still hold on a board, auras moved to where their casters
// stand and clouds held back by a Wind Wall; the ones that no longer hold
// are cleared from the row.
export function liveZones(map: BattleMap, encounter: Pick<Encounter, "round"> | null): SpellZone[] {
  if (!map.spellZones.length) {
    return [];
  }
  const round = encounter?.round ?? 1;
  const holding = map.spellZones.filter((zone) => zoneHolds(zone, round));
  if (holding.length !== map.spellZones.length) {
    saveZones(map.id, holding);
  }
  return holdGasesBack(withAnchors(holding, listTokens(map.id), map), map.width);
}

export function liveZonesFor(encounter: Pick<Encounter, "id" | "round">): { map: BattleMap; zones: SpellZone[] } | null {
  const map = getBattleMapForEncounter(encounter.id);
  return map ? { map, zones: liveZones(map, encounter) } : null;
}

// A spell's areas end: every one of that spell by that caster (any caster
// when none is named), from the active board. Returns what ended.
export function endZones(encounterId: string, spell: string, casterId?: string): string[] {
  const map = getBattleMapForEncounter(encounterId);
  if (!map?.spellZones.length) {
    return [];
  }
  const wanted = zoneKey(spell);
  const ending = map.spellZones.filter(
    (zone) =>
      (zoneKey(zone.spell) === wanted || zoneKey(zone.heldBy ?? zoneRowFor(zone)?.heldBy ?? "") === wanted) &&
      (!casterId || zone.casterId === casterId),
  );
  if (!ending.length) {
    return [];
  }
  saveZones(map.id, map.spellZones.filter((zone) => !ending.includes(zone)));
  return ending.map((zone) => zone.spell);
}

// Writes one area's new state back (a Guardian's running total, who it
// struck this turn, where a cloud drifted), dropping it when it is spent.
export function updateZone(mapId: string, zones: SpellZone[], next: SpellZone | null, id: string) {
  saveZones(
    mapId,
    zones.flatMap((zone) => (zone.id === id ? (next ? [next] : []) : [zone])),
  );
}

// A spell ended (its concentration broke, it was dispelled): its areas on
// the active board end with it. Called first thing by
// src/lib/dm/concentration.ts clearSpellConditionsByName.
export function endSpellZones(campaignId: string, spell: string, casterId?: string) {
  const board = getActiveBoard(campaignId);
  if (board && endZones(board.id, spell, casterId).length) {
    publishZones(campaignId);
  }
}
