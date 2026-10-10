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

export type AreaShape = {
  shape: "sphere" | "cube" | "cone" | "line" | "cylinder";
  feet: number;
  // The area starts at the caster (a Self spell, a breath weapon).
  self: boolean;
};

const FEET_PER_TILE = 5;

// The area a spell or an ability's text prints: "a 20-foot-radius sphere",
// "a 15-foot cone", "a line 100 feet long and 5 feet wide", "a 10-foot-radius,
// 40-foot-high cylinder", "Self (15-foot cube)".
export function areaShapeFromText(text: string, rangeText = ""): AreaShape | null {
  const all = `${rangeText} ${text}`;
  const self = /\bself\b/i.test(rangeText) || /\b(?:exhales?|breath|from you|originat\w* from you|you (?:emit|unleash|send))\b/i.test(text);
  const radius = /(\d+)-foot[- ]radius(?:,?\s*\d+-foot[- ]high)?\s+(sphere|cylinder)/i.exec(all);
  if (radius) {
    return { shape: radius[2].toLowerCase() as AreaShape["shape"], feet: Number(radius[1]), self };
  }
  const sized = /(\d+)-foot[- ](cube|cone|line|sphere|cylinder)/i.exec(all);
  if (sized) {
    return { shape: sized[2].toLowerCase() as AreaShape["shape"], feet: Number(sized[1]), self: self || sized[2].toLowerCase() === "cone" };
  }
  const line = /\bline\s+(\d+)\s+feet\s+long/i.exec(all);
  if (line) {
    return { shape: "line", feet: Number(line[1]), self: true };
  }
  return null;
}

// The SRD's instant blasts, for a server with no content pack to read the
// text from. Lasting areas are laid on the board by their zone rows.
const SRD_AREAS: Record<string, AreaShape> = {
  "burning hands": { shape: "cone", feet: 15, self: true },
  "color spray": { shape: "cone", feet: 15, self: true },
  thunderwave: { shape: "cube", feet: 15, self: true },
  shatter: { shape: "sphere", feet: 10, self: false },
  fireball: { shape: "sphere", feet: 20, self: false },
  "lightning bolt": { shape: "line", feet: 100, self: true },
  fear: { shape: "cone", feet: 30, self: true },
  "hypnotic pattern": { shape: "cube", feet: 30, self: false },
  sleep: { shape: "sphere", feet: 20, self: false },
  slow: { shape: "cube", feet: 40, self: false },
  "faerie fire": { shape: "cube", feet: 20, self: false },
  "ice storm": { shape: "cylinder", feet: 20, self: false },
  "cone of cold": { shape: "cone", feet: 60, self: true },
  "flame strike": { shape: "cylinder", feet: 10, self: false },
  "circle of death": { shape: "sphere", feet: 60, self: false },
  "delayed blast fireball": { shape: "sphere", feet: 20, self: false },
  "prismatic spray": { shape: "cone", feet: 60, self: true },
  sunburst: { shape: "sphere", feet: 60, self: false },
  "destructive wave": { shape: "sphere", feet: 30, self: true },
};

export function spellAreaShape(spell: string, authors?: string | string[]): AreaShape | null {
  const entry = findSpellByName(spell, authors);
  if (entry) {
    const found = areaShapeFromText(String(entry.data.desc ?? ""), String(entry.data.range ?? ""));
    if (found) {
      return found;
    }
  }
  const authored = authoredSpellRow(spell);
  return (authored ? areaShapeFromText(authored.desc) : null) ?? SRD_AREAS[spell.trim().toLowerCase()] ?? null;
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
}): string | null {
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
      return `${input.label}'s point of origin (${input.at.x}, ${input.at.y}) is beyond its ${input.rangeFeet}-foot range from ${input.casterName}. Nothing was spent.`;
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
  return `${input.label}'s ${input.area.feet}-foot ${input.area.shape} cannot hold ${names} in one placement ${where}: an area catches only the creatures inside it. Name the creatures one ${input.area.shape} reaches${input.area.self ? " (towardX/towardY aims it)" : " (atX/atY places it)"}. Nothing was spent.`;
}
