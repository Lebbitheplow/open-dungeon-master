// Whether one area holds every creature an area spell or ability names
// (docs/dnd-rules-audit-2026-10-09-extent.md, F13). A sphere, cube, cone,
// line or cylinder is laid once: from its point of origin (a point within
// range, or the caster for a Self spell) and, for a cone, a line or a cube,
// a direction. Every creature named must have a square inside that one
// shape. Reach from the caster alone let Burning Hands catch creatures on
// both sides of its caster and Fireball creatures 100 feet apart.
//
// On the battle map only: a fight with no board is theatre of the mind, and
// the DM's word places the area there.

import { getEnemy } from "@/lib/db/encounters";
import { getBattleMapForEncounter, listTokens } from "@/lib/db/battle-maps";
import { findSpellByName } from "@/lib/content";
import { authoredSpellRow } from "@/lib/srd/spell-mechanics";
import { templateTiles, type TemplateShape } from "@/lib/battlemap/template";
import { footprintForSize, footprintTiles } from "@/lib/battlemap/footprint";
import { chebyshev, tileIndex, type XY } from "@/lib/battlemap/types";
import type { ToolError } from "@/lib/dm/tool-errors";
import { areaShapeFromText, blastPickOf, blastTemplate, SRD_AREAS, type AreaShape } from "@/lib/battlemap/area-shape";
import { textKey } from "@/lib/language/text-logic";

export type { AreaShape } from "@/lib/battlemap/area-shape";
export { areaShapeFromText } from "@/lib/battlemap/area-shape";

const FEET_PER_TILE = 5;

export function spellAreaShape(spell: string, authors?: string | string[]): AreaShape | null {
  const entry = findSpellByName(spell, authors);
  if (entry) {
    const found = areaShapeFromText(String(entry.data.desc ?? ""), String(entry.data.range ?? ""));
    if (found) {
      return found;
    }
  }
  const authored = authoredSpellRow(spell);
  return (authored ? areaShapeFromText(authored.desc) : null) ?? SRD_AREAS[textKey(spell)] ?? null;
}

// A monster's area ability, read from the line its block prints.
export function abilityAreaShape(stats: { traits?: string[] }, ability: string): AreaShape | null {
  const key = ability.trim().toLowerCase();
  const line = (stats.traits ?? []).find((entry) => entry.toLowerCase().replace(/^[a-z ]+:\s*/, "").startsWith(key));
  return line ? areaShapeFromText(line) : null;
}

type Creature = { id: string; name: string };

// Null when one placement of the area holds everyone named (or there is no
// board to judge on); the refusal otherwise.
export function areaProblem(input: {
  encounterId: string;
  casterId: string;
  casterName: string;
  label: string;
  area: AreaShape;
  // The spell's range in feet, for where a point of origin may sit.
  rangeFeet: number | null;
  creatures: Creature[];
  at?: XY;
  toward?: XY;
}): ToolError | null {
  const map = getBattleMapForEncounter(input.encounterId);
  if (!map || !input.creatures.length) {
    return null;
  }
  const tokens = listTokens(map.id);
  const caster = tokens.find((token) => token.refId === input.casterId);
  const placed = input.creatures
    .map((creature) => {
      const token = tokens.find((entry) => entry.refId === creature.id);
      if (!token) return null;
      const size = token.kind === "enemy" ? getEnemy(token.refId)?.stats.size : undefined;
      const cells = footprintTiles({ x: token.x, y: token.y }, footprintForSize(size)).map((cell) => tileIndex(map.width, cell.x, cell.y));
      return { ...creature, at: { x: token.x, y: token.y }, cells };
    })
    .filter((entry): entry is Creature & { at: XY; cells: number[] } => Boolean(entry));
  if (!placed.length || (input.area.self && !caster)) {
    return null;
  }
  const shape: TemplateShape = input.area.shape === "cylinder" ? "sphere" : input.area.shape;
  const holds = (origin: XY, target: XY) => {
    const cells = new Set(templateTiles(map, { shape, origin, target, sizeFeet: input.area.feet }));
    return placed.every((creature) => creature.cells.some((cell) => cells.has(cell)));
  };
  const reach = Math.max(1, Math.round(input.area.feet / FEET_PER_TILE));
  const directions = (origin: XY): XY[] => {
    if (input.toward) return [input.toward];
    const aims = placed.map((creature) => creature.at);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx || dy) aims.push({ x: origin.x + dx * reach, y: origin.y + dy * reach });
      }
    }
    return aims;
  };
  // A Self area starts at the caster; any other at a point within range.
  let origins: XY[];
  if (input.area.self && caster) {
    origins = [{ x: caster.x, y: caster.y }];
  } else if (input.at) {
    if (caster && input.rangeFeet !== null && chebyshev(caster.x, caster.y, input.at.x, input.at.y) * FEET_PER_TILE > input.rangeFeet) {
      return { error: `${input.label}'s point of origin (${input.at.x}, ${input.at.y}) is beyond its ${input.rangeFeet}-foot range from ${input.casterName}. Nothing was spent.`, retry: true };
    }
    origins = [input.at];
  } else {
    // Any square that could be the centre: near every creature named, and
    // within range of the caster.
    const xs = placed.map((creature) => creature.at.x);
    const ys = placed.map((creature) => creature.at.y);
    origins = [];
    for (let y = Math.max(0, Math.max(...ys) - reach - 1); y <= Math.min(map.height - 1, Math.min(...ys) + reach + 1); y += 1) {
      for (let x = Math.max(0, Math.max(...xs) - reach - 1); x <= Math.min(map.width - 1, Math.min(...xs) + reach + 1); x += 1) {
        if (!caster || input.rangeFeet === null || chebyshev(caster.x, caster.y, x, y) * FEET_PER_TILE <= input.rangeFeet) {
          origins.push({ x, y });
        }
      }
    }
  }
  for (const origin of origins) {
    const aims = shape === "sphere" ? [origin] : directions(origin);
    if (aims.some((target) => holds(origin, target))) {
      return null;
    }
  }
  const names = placed.map((creature) => creature.name).join(", ");
  const where = input.area.self ? `from ${input.casterName}` : input.at ? `at (${input.at.x}, ${input.at.y})` : "anywhere in its range";
  return { error: `${input.label}'s ${input.area.feet}-foot ${input.area.shape} cannot hold ${names} in one placement ${where}: an area catches only the creatures inside it. Name the creatures one ${input.area.shape} reaches${input.area.self ? " (towardX/towardY aims it)" : " (atX/atY places it)"}. Nothing was spent.`, retry: true };
}

// Who a blast laid on the battle map catches (issue 570): every creature
// with a square inside the one placement the caster picked
// (src/lib/battlemap/area-shape.ts blastTemplate, the squares the Hand drew
// while they aimed), the party's own included, since a Fireball burns a
// friend standing in it, unless the spell lets its caster choose. The caster
// of a cone, a line or a burst around them is never in it. The model used to
// list the creatures and the engine only checked the list fit one
// placement; the engine now reads the board itself. Null with no board, or
// no caster on it for an area that starts at them: the DM's word places the
// area there.
export function creaturesInBlast(input: {
  encounterId: string;
  casterId: string;
  casterName: string;
  label: string;
  area: AreaShape;
  rangeFeet: number | null;
  at?: XY;
  toward?: XY;
}): { enemyIds: string[]; characterIds: string[] } | ToolError | null {
  const map = getBattleMapForEncounter(input.encounterId);
  if (!map) {
    return null;
  }
  const tokens = listTokens(map.id);
  const casterToken = tokens.find((token) => token.refId === input.casterId);
  const caster = casterToken ? { x: casterToken.x, y: casterToken.y } : null;
  const pick = blastPickOf(input.area);
  if (!caster && (input.area.self || pick !== "point")) {
    return null;
  }
  if (pick === "point" && input.at && caster && input.rangeFeet !== null && chebyshev(caster.x, caster.y, input.at.x, input.at.y) * FEET_PER_TILE > input.rangeFeet) {
    return { error: `${input.label}'s point of origin (${input.at.x}, ${input.at.y}) is beyond its ${input.rangeFeet}-foot range from ${input.casterName}. Nothing was spent.`, retry: true };
  }
  const spec = blastTemplate(input.area, { caster, ...(input.at ? { at: input.at } : {}), ...(input.toward ? { toward: input.toward } : {}) });
  if (!spec) {
    const needs = pick === "point" ? "the square it is centred on (atX, atY)" : "the way it points (towardX, towardY)";
    return { error: `${input.label}'s ${input.area.feet}-foot ${input.area.shape} needs ${needs} to be laid on the battle map, or the creatures it catches in enemyIds and characterIds. Nothing was spent.`, retry: true };
  }
  const cells = new Set(templateTiles(map, spec));
  const enemyIds: string[] = [];
  const characterIds: string[] = [];
  for (const token of tokens) {
    if (token.refId === input.casterId && (input.area.self || pick !== "point")) {
      continue;
    }
    if (token.kind === "enemy") {
      const enemy = getEnemy(token.refId);
      if (!enemy || enemy.status !== "alive") continue;
      const covered = footprintTiles({ x: token.x, y: token.y }, footprintForSize(enemy.stats.size)).some((cell) => cells.has(tileIndex(map.width, cell.x, cell.y)));
      if (covered) enemyIds.push(enemy.id);
    } else if (token.kind === "pc" && !input.area.choose && cells.has(tileIndex(map.width, token.x, token.y))) {
      characterIds.push(token.refId);
    }
  }
  return { enemyIds, characterIds };
}
