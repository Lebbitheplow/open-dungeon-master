// Breaking a section of a Wall of Ice (SRD 5.1): "The wall is an object that
// can be damaged and thus breached. It has AC 12 and 30 hit points per
// 10-foot section, and it is vulnerable to fire damage. Reducing a 10-foot
// section of wall to 0 hit points destroys it and leaves behind a sheet of
// frigid air in the space the wall occupied. A creature moving through the
// sheet of frigid air for the first time on a turn must make a Constitution
// saving throw. That creature takes 5d6 cold damage on a failed save, or half
// as much damage on a successful one."
//
// damage_object (src/lib/dm/object-damage.ts) asks wallSectionFor for the
// section a name points at, rolls against its armor class and keeps its
// damage like any named object's; breakWallSection takes the section out of
// the wall (its squares open) and lays the frigid air there
// (zones-spells.ts "frigid air", struck by zone-triggers.ts on entering).
//
// Must not import encounter-tools, map-tools or mutations (they reach here).

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import { getActiveBoard } from "@/lib/db/encounters";
import type { SpellZone } from "@/lib/battlemap/zones";
import { zoneKey, zoneRowFor } from "@/lib/battlemap/zones-spells";
import { parseSectionName, sectionCells, sectionOf } from "@/lib/battlemap/zones-walls";
import { liveZones, publishZones, saveZones } from "@/lib/dm/zone-store";

export type WallSection = {
  zoneId: string;
  spell: string;
  section: number;
  ac: number;
  hp: number;
  vulnerable: string;
};

// The standing wall section a damage_object name points at, a refusal for
// a sectioned wall named without a standing section, or null for any other
// object.
export function wallSectionFor(campaignId: string, name: string): WallSection | { error: string } | null {
  const named = parseSectionName(name);
  if (!named) {
    return null;
  }
  const encounter = getActiveBoard(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const row = zoneRowFor(named.spell);
  const walls = map && row?.sections ? liveZones(map, encounter).filter((zone) => zoneKey(zone.spell) === zoneKey(named.spell)) : [];
  if (!map || !row?.sections || !walls.length) {
    return null;
  }
  const sections = row.sections;
  const standing = (zone: SpellZone) => sectionNumbers(zone, map.width, sections.feet);
  const wall = named.section ? [...walls].reverse().find((zone) => standing(zone).includes(named.section as number)) : null;
  if (!wall || !named.section) {
    const listed = walls.flatMap((zone) => standing(zone)).sort((a, b) => a - b);
    return {
      error: `Name the section of the ${walls[0].spell} to strike, "${walls[0].spell} section N" (sections are 10 feet, numbered from the end it was laid from; standing now: ${listed.join(", ") || "none"}). Nothing was rolled.`,
    };
  }
  return { zoneId: wall.id, spell: wall.spell, section: named.section, ac: sections.ac, hp: sections.hp, vulnerable: sections.vulnerable };
}

// The sections of a wall still standing (a broken one's squares are gone).
function sectionNumbers(zone: SpellZone, width: number, feet: number): number[] {
  return [...new Set(zone.cells.map((cell) => sectionOf(zone, cell, width, feet)))].sort((a, b) => a - b);
}

// The damage a blow deals the section: double from the type it is
// vulnerable to (fire), said in `notes`.
export function sectionHit(target: WallSection, dealt: number, type: string, notes: string[]): number {
  if (type !== target.vulnerable) {
    return dealt;
  }
  notes.push(`${target.spell} is vulnerable to ${type}: ${dealt} doubles to ${dealt * 2}`);
  return dealt * 2;
}

// The section is destroyed: its squares leave the wall and a sheet of
// frigid air takes their place, held as long as the wall is. Returns the
// line for the result.
export function breakWallSection(campaign: Campaign, target: WallSection): string {
  const encounter = getActiveBoard(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const zones = map ? liveZones(map, encounter) : [];
  const wall = zones.find((zone) => zone.id === target.zoneId);
  const row = wall ? zoneRowFor(wall.spell) : null;
  if (!map || !encounter || !wall || !row?.sections) {
    return `${target.spell} section ${target.section} breaks.`;
  }
  const cells = sectionCells(wall, target.section, map.width, row.sections.feet);
  const leaves = row.sections.leaves;
  const first = cells[0] ?? wall.cells[0];
  const air: SpellZone = {
    id: crypto.randomUUID().slice(0, 12),
    spell: leaves.replace(/\b\w/g, (letter) => letter.toUpperCase()),
    casterId: wall.casterId,
    casterKind: wall.casterKind,
    casterName: wall.casterName,
    origin: { x: first % map.width, y: Math.floor(first / map.width) },
    cells,
    concentration: wall.concentration,
    castRound: encounter.round,
    untilRound: wall.untilRound,
    slotLevel: wall.slotLevel,
    dc: wall.dc,
  };
  const rest = wall.cells.filter((cell) => !cells.includes(cell));
  saveZones(map.id, [...zones.flatMap((zone) => (zone.id === wall.id ? (rest.length ? [{ ...zone, cells: rest }] : []) : [zone])), ...(cells.length ? [air] : [])]);
  publishZones(campaign.id);
  return `${wall.spell} section ${target.section} is destroyed: its ${cells.length} square${cells.length === 1 ? "" : "s"} open, and a sheet of ${leaves} fills them (moving through it for the first time on a turn: CON save, 5d6 cold, half on a success).`;
}
