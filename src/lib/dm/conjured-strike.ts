// A strike from something a spell made, on the live board (issue 659):
// where Spiritual Weapon's weapon floats, whether this strike reaches the
// target from there or from a square the weapon can fly to, and, once
// nothing can refuse the attack, the weapon moved there. The choice of
// square is pure and lives in conjured-strike-logic.ts.
//
// Off the map (theatre of the mind) there is nothing to measure: the
// attack goes ahead as before.
//
// Must not import pc-attack, encounter-tools or map-tools: they call here.

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import type { Encounter } from "@/lib/db/encounters";
import { footprintTiles } from "@/lib/battlemap/footprint";
import { tileIndex, type XY } from "@/lib/battlemap/types";
import { zoneKey } from "@/lib/battlemap/zones-spells";
import type { GrantedAttack } from "@/lib/srd/condition-effect-types";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { tokenFootprint } from "@/lib/dm/board-reach";
import { conjuredStrikeSpot, type StrikeMode } from "@/lib/dm/conjured-strike-logic";
import { liveZones, publishZones } from "@/lib/dm/zone-store";
import { moveZoneTo, placeSpellZone } from "@/lib/dm/zone-cast";
import type { ToolError } from "@/lib/dm/tool-errors";

const FEET = 5;

export type ConjuredStrike = {
  // The weapon's area on the board, or null when the board holds none yet
  // (cast before the board was laid, or before this rule): the strike lays it.
  zoneId: string | null;
  // The attack, and the spell whose area marks it.
  name: string;
  at: XY;
  movedTiles: number;
  mode: StrikeMode;
  // The weapon's reach, for the notes.
  reachFeet: number;
};

export function planConjuredStrike(input: {
  encounter: Encounter;
  sheet: CharacterSheet;
  enemy: { id: string; displayName: string };
  attackName: string;
  from: NonNullable<GrantedAttack["from"]>;
}): { strike: ConjuredStrike } | { refused: ToolError } | null {
  const { encounter, sheet, enemy, from } = input;
  const map = getBattleMapForEncounter(encounter.id);
  const caster = map ? getTokenByRef(map.id, sheet.id) : null;
  const target = map ? getTokenByRef(map.id, enemy.id) : null;
  if (!map || !caster || !target) {
    return null;
  }
  const zone = liveZones(map, encounter).find((entry) => entry.casterId === sheet.id && zoneKey(entry) === zoneKey(from.zone)) ?? null;
  // The casting turn: a weapon laid where the caster named strikes from
  // there; one the server set down may still appear beside the target. Any
  // later turn it flies its move first.
  const castNow = zone !== null && zone.castRound === encounter.round;
  const mode: StrikeMode = !zone ? "place" : castNow ? (zone.named ? "fixed" : "place") : "move";
  const occupied = new Set<number>();
  for (const token of listTokens(map.id)) {
    for (const tile of footprintTiles(token, tokenFootprint(token))) {
      occupied.add(tileIndex(map.width, tile.x, tile.y));
    }
  }
  const spot = conjuredStrikeSpot({
    board: map,
    mode,
    reachTiles: Math.max(1, Math.round(from.reachFeet / FEET)),
    moveTiles: Math.max(0, Math.round(from.moveFeet / FEET)),
    rangeTiles: Math.max(1, Math.round(from.rangeFeet / FEET)),
    caster: { x: caster.x, y: caster.y },
    origin: zone?.origin ?? null,
    target: { at: { x: target.x, y: target.y }, footprint: tokenFootprint(target) },
    occupied,
  });
  const name = input.attackName;
  if ("out" in spot) {
    const where = zone ? `(${zone.origin.x},${zone.origin.y})` : "";
    const error =
      spot.out === "fixed"
        ? `${sheet.name}'s ${name} appeared at ${where}, the square named when it was cast, ${spot.apartTiles * FEET} feet from ${enemy.displayName}: the strike that comes with the casting reaches only a creature within ${from.reachFeet} feet of the weapon. Nothing was spent.`
        : spot.out === "move"
          ? `${sheet.name}'s ${name} floats at ${where}, ${spot.apartTiles * FEET} feet from ${enemy.displayName}: it moves up to ${from.moveFeet} feet and strikes a creature within ${from.reachFeet} feet of it, so ${enemy.displayName} is out of its reach this turn. Nothing was spent.`
          : `${sheet.name}'s ${name} appears within ${from.rangeFeet} feet of ${sheet.name}, where a clear path leads, and strikes a creature within ${from.reachFeet} feet of it; ${enemy.displayName} is ${spot.apartTiles * FEET} feet from ${sheet.name}, out of its reach. Nothing was spent.`;
    return { refused: { error, refused: "rules" } };
  }
  return { strike: { zoneId: zone?.id ?? null, name, at: spot.at, movedTiles: spot.movedTiles, mode, reachFeet: from.reachFeet } };
}

// The weapon moved to the square its strike is made from, or laid there
// when the board did not hold it. Called once nothing can refuse the
// attack. The note for the roll.
export function commitConjuredStrike(campaign: Campaign, encounter: Encounter, sheet: CharacterSheet, strike: ConjuredStrike): string {
  const map = getBattleMapForEncounter(encounter.id);
  const square = `(${strike.at.x},${strike.at.y})`;
  if (!map) {
    return `${strike.name} strikes`;
  }
  if (strike.zoneId) {
    const same = map.spellZones.find((zone) => zone.id === strike.zoneId);
    const moved = same && (same.origin.x !== strike.at.x || same.origin.y !== strike.at.y);
    if (moved) {
      moveZoneTo(map, strike.zoneId, strike.at);
      publishZones(campaign.id);
    }
    return strike.movedTiles > 0
      ? `${strike.name} flies ${strike.movedTiles * FEET} feet to ${square} and strikes`
      : moved
        ? `${strike.name} appears at ${square} and strikes`
        : `${strike.name} strikes from ${square}`;
  }
  placeSpellZone(campaign, { spell: strike.name, caster: { kind: "pc", id: sheet.id, name: sheet.name }, at: strike.at });
  return `${strike.name} appears at ${square} and strikes`;
}
