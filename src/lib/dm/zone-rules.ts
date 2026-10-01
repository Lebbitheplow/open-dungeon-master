// What the spell areas on the live board answer for the rest of the engine,
// one small question each, so every call site outside the zone files is a
// line or two: what a mover's step costs, whether a creature can see
// another through a cloud, whether a caster stands in Silence, what cover a
// Blade Barrier gives, whether a Wind Wall turns an arrow, and the sight
// terrain and patches of light the board's fog of war reads.
//
// Off the map there are no areas: every answer is "nothing to add".
// Must not import encounter-tools, map-tools, pc-attack or mutations.

import { getBattleMapForEncounter, getTokenByRef, type BattleMap } from "@/lib/db/battle-maps";
import { getActiveBoard, getActiveEncounter, getEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { sizeForRace } from "@/lib/srd";
import { barredByShell, barredCells, ignoresZoneSteps, moverSpellTraits, withBarred, withEdges, type ZoneMover } from "@/lib/battlemap/zones-movers";
import { effectiveTerrain, type LightZone } from "@/lib/battlemap/scene";
import { tileIndex, type MoveTraits, type XY } from "@/lib/battlemap/types";
import {
  missileDeflectedBy,
  silentAt,
  zoneBlocksSight,
  zoneCover,
  zoneLights,
  zoneSightTerrain,
  zoneStepCost,
  type SpellZone,
  type ZoneSenses,
} from "@/lib/battlemap/zones";
import { liveZones } from "@/lib/dm/zone-store";
import { zoneRowFor } from "@/lib/battlemap/zones-spells";
import type { SpellFacts } from "@/lib/srd/spell-facts";
import { spellFactsFor } from "@/lib/content";

function zonesOf(map: BattleMap | null): SpellZone[] {
  if (!map?.spellZones.length) {
    return [];
  }
  const board = getActiveBoard(map.campaignId);
  return liveZones(map, board && board.id === map.encounterId ? board : null);
}

// The mover a walk is for, as the zone rules read it: its size, whether it
// flies, and the spells on it (src/lib/battlemap/zones-movers.ts).
function moverOf(map: BattleMap, moverKind: string, moverRef: string | undefined): ZoneMover | null {
  if (!moverRef) {
    return null;
  }
  const token = getTokenByRef(map.id, moverRef);
  const flying = token?.movement === "fly";
  if (moverKind === "enemy") {
    const enemy = getEnemy(moverRef);
    return enemy ? { size: enemy.stats.size ?? null, flying, conditions: enemy.conditions, ref: moverRef, type: enemy.stats.type ?? null } : null;
  }
  const sheet = getSheetById(moverRef);
  // A summoned creature is what its stat block says (a skeleton is undead).
  return sheet ? { size: sizeForRace(sheet.race), flying, conditions: sheet.conditions, ref: moverRef, type: sheet.summon?.creatureType || "humanoid" } : null;
}

// A mover's walking traits with the spell areas' say on each step, and what
// spells on the mover change of its walk (Freedom of Movement, Spider Climb,
// Water Walk; a Wind Wall barring a small flyer). `moverRef` names the
// mover; without it only the areas' own costs apply.
export function withZoneSteps(traits: MoveTraits, map: BattleMap, moverKind: string, moverRef?: string): MoveTraits {
  const mover = moverOf(map, moverKind, moverRef);
  const zones = zonesOf(map);
  const own = moverSpellTraits(mover);
  const step = withEdges(withBarred(ignoresZoneSteps(mover) ? null : zoneStepCost(zones, map.width, moverKind), barredCells(zones, mover)), zones, mover);
  if (!step && !Object.keys(own).length) {
    return traits;
  }
  return { ...(typeof traits === "object" ? traits : { swims: traits }), ...own, ...(step ? { zoneStep: step } : {}) };
}

// The same for an encounter's board, when the caller holds no map.
export function zoneStepsFor(traits: MoveTraits, encounterId: string, moverKind: string, moverRef?: string): MoveTraits {
  const map = getBattleMapForEncounter(encounterId);
  return map ? withZoneSteps(traits, map, moverKind, moverRef) : traits;
}

// Whether the spell areas keep a viewer from seeing a creature on the board
// (a cloud, magical darkness, an opaque wall on the line). False off it.
export function zoneHidesFrom(
  map: BattleMap,
  viewer: XY,
  subject: XY & { movement?: string },
  senses: ZoneSenses,
): boolean {
  const zones = zonesOf(map);
  return zones.length > 0 && zoneBlocksSight(zones, map.width, viewer, { ...subject, flying: subject.movement === "fly" }, senses);
}

// The patches of light the board's vision reads, with the spells' own:
// Daylight's bright light, Darkness's magical dark.
export function lightsWithZones(map: BattleMap): LightZone[] {
  const zones = zonesOf(map);
  return zones.length ? [...(map.zones ?? []), ...zoneLights(zones, map.width)] : (map.zones ?? []);
}

// The terrain a viewer's sight is cast over: clouds and opaque walls stop
// it, a wall of force does not, magical darkness does unless the viewer
// sees into it.
export function sightTerrainFor(map: BattleMap, senses: ZoneSenses = {}): string {
  const zones = zonesOf(map);
  return zones.length
    ? zoneSightTerrain(map.terrain, effectiveTerrain(map.drawnTerrain, map.width, map.doors), zones, senses)
    : map.terrain;
}

// Silence around a caster: no spell with a verbal component (SRD 5.1).
// The refusal, or null.
export function silenceProblem(campaignId: string, casterId: string, casterName: string, facts: SpellFacts | null): string | null {
  if (!facts?.verbal) {
    return null;
  }
  const encounter = getActiveEncounter(campaignId) ?? getActiveBoard(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, casterId) : null;
  if (!map || !token) {
    return null;
  }
  const hush = silentAt(zonesOf(map), tileIndex(map.width, token.x, token.y));
  return hush
    ? `${casterName} stands inside ${hush.casterName ? `${hush.casterName}'s ` : ""}Silence, where no sound is made: ${facts.name} has a verbal component and cannot be cast there. Step out of the silence first, or cast a spell with no verbal component. Nothing was spent.`
    : null;
}

// ", thunder" for a creature standing inside Silence, which is immune to
// thunder damage there; "" otherwise. Appended to its immunities.
export function silencedImmunity(campaignId: string, refId: string): string {
  const board = getActiveBoard(campaignId);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  const token = map ? getTokenByRef(map.id, refId) : null;
  if (!map || !token) {
    return "";
  }
  return silentAt(zonesOf(map), tileIndex(map.width, token.x, token.y)) ? ", thunder" : "";
}

// Blade Barrier's three-quarters cover between two combatants: 5 or 0.
export function zoneCoverBetween(encounterId: string, attackerRef: string, targetRef: string): 0 | 5 {
  const map = getBattleMapForEncounter(encounterId);
  const from = map ? getTokenByRef(map.id, attackerRef) : null;
  const to = map ? getTokenByRef(map.id, targetRef) : null;
  return map && from && to ? zoneCover(zonesOf(map), map.width, from, to) : 0;
}

// A Wind Wall between a shooter and its target: the refusal a ranged weapon
// attack meets, or null.
export function missileProblem(encounterId: string, attackerRef: string, targetRef: string, targetName: string): string | null {
  const map = getBattleMapForEncounter(encounterId);
  const from = map ? getTokenByRef(map.id, attackerRef) : null;
  const to = map ? getTokenByRef(map.id, targetRef) : null;
  const wall = map && from && to ? missileDeflectedBy(zonesOf(map), map.width, from, to) : null;
  return wall
    ? `${wall.casterName ? `${wall.casterName}'s ` : ""}Wind Wall stands between them: arrows, bolts and other ranged weapon attacks at ${targetName} are blown aside and miss. Attack in melee, with a spell, or from a clear line.`
    : null;
}

// A creature standing in an obscured area sees poorly (SRD 5.1, Vision and
// Light): a Wisdom (Perception) check that relies on sight is made at
// disadvantage, and its passive Perception is 5 lower. The note naming the
// area, or null.
export function obscuredFor(campaignId: string, refId: string): string | null {
  const board = getActiveBoard(campaignId);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  const token = map ? getTokenByRef(map.id, refId) : null;
  if (!map || !token) {
    return null;
  }
  const cell = tileIndex(map.width, token.x, token.y);
  const veil = zonesOf(map).find((zone) => {
    const row = zoneRowFor(zone.spell);
    return Boolean(row && (row.obscured || row.darkness) && zone.cells.includes(cell));
  });
  if (!veil) {
    return null;
  }
  const heavy = zoneRowFor(veil.spell)?.obscured === "heavy";
  return `${heavy ? "heavily" : "lightly"} obscured in ${veil.spell}: disadvantage on Perception by sight`;
}

// Globe of Invulnerability (SRD 5.1): a spell of 5th level or lower (more
// from a higher slot) cast from outside the barrier has no effect on
// anything within it. The refusal a spell at a creature inside meets before
// anything is spent, or null. `spellLevel` is the level the spell is cast
// at, its own when the slot is not yet known.
export function globeProblem(encounterId: string, casterRef: string, targetRef: string, targetName: string, spell: string, spellLevel: number): string | null {
  const map = getBattleMapForEncounter(encounterId);
  const caster = map ? getTokenByRef(map.id, casterRef) : null;
  const target = map ? getTokenByRef(map.id, targetRef) : null;
  if (!map || !caster || !target) {
    return null;
  }
  const at = tileIndex(map.width, target.x, target.y);
  const from = tileIndex(map.width, caster.x, caster.y);
  const globe = zonesOf(map).find((zone) => {
    const row = zoneRowFor(zone.spell);
    // An Antimagic Field stops every spell from outside, whatever its level.
    const ward = row?.antimagic ? 9 : row?.wardsSpellsUpTo;
    if (!ward || !zone.cells.includes(at) || zone.cells.includes(from)) {
      return false;
    }
    return spellLevel <= ward + (row?.antimagic ? 0 : Math.max(0, (zone.slotLevel ?? 6) - 6));
  });
  if (globe && zoneRowFor(globe.spell)?.antimagic) {
    return `${targetName} stands inside ${globe.casterName ? `${globe.casterName}'s ` : ""}Antimagic Field: no spell from outside has any effect there. Nothing was spent; choose another target.`;
  }
  return globe
    ? `${targetName} stands inside ${globe.casterName ? `${globe.casterName}'s ` : ""}Globe of Invulnerability: ${spell} is cast from outside it at ${spellLevel === 0 ? "cantrip level" : `level ${spellLevel}`}, too low to reach through it, and has no effect there. Nothing was spent; cast from inside the globe, with a higher slot, or at another target.`
    : null;
}

// The same for a spell named by the caller, at the level named or its own.
export function globeProblemFor(encounterId: string, casterRef: string, targetRef: string, targetName: string, spell: string | undefined, level?: number | null): string | null {
  if (!spell) {
    return null;
  }
  const facts = spellFactsFor(spell);
  return globeProblem(encounterId, casterRef, targetRef, targetName, facts?.name ?? spell, level ?? facts?.level ?? 1);
}

// Antilife Shell between a living attacker and its target in melee: the
// refusal (the attack cannot reach through the barrier), or null.
export function reachThroughProblem(encounterId: string, attackerRef: string, targetRef: string, attackerType: string | null | undefined, attackerName: string): string | null {
  if (!barredByShell(attackerType)) {
    return null;
  }
  const map = getBattleMapForEncounter(encounterId);
  const from = map ? getTokenByRef(map.id, attackerRef) : null;
  const to = map ? getTokenByRef(map.id, targetRef) : null;
  if (!map || !from || !to) {
    return null;
  }
  const a = tileIndex(map.width, from.x, from.y);
  const b = tileIndex(map.width, to.x, to.y);
  const shell = zonesOf(map).find((zone) => zoneRowFor(zone.spell)?.barsLiving && zone.casterId !== attackerRef && zone.cells.includes(a) !== zone.cells.includes(b));
  return shell
    ? `${shell.casterName ? `${shell.casterName}'s ` : ""}Antilife Shell stands between them: ${attackerName} cannot reach through it with a melee attack. It may attack at range, cast, or take another action.`
    : null;
}

// A caster standing in an Antimagic Field casts nothing: the refusal, or
// null.
export function antimagicProblem(campaignId: string, casterId: string, casterName: string): string | null {
  const encounter = getActiveEncounter(campaignId) ?? getActiveBoard(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, casterId) : null;
  if (!map || !token) {
    return null;
  }
  const cell = tileIndex(map.width, token.x, token.y);
  const field = zonesOf(map).find((zone) => zoneRowFor(zone.spell)?.antimagic && zone.cells.includes(cell));
  return field
    ? `${casterName} stands inside ${field.casterName ? `${field.casterName}'s ` : ""}Antimagic Field, where no spell can be cast. Step out of it first. Nothing was spent.`
    : null;
}
