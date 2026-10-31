// The area an instant spell blasts (Fireball's sphere, Burning Hands' cone,
// Lightning Bolt's line, Thunderwave's cube) and where it lands on the battle
// map for a pick: one placement of the template the board draws and the
// engine catches creatures in (issue 570). Lasting areas (Web, a wall) are
// laid by their zone rows instead (zones-spells.ts).
//
// Pure, so the Hand's preview and the engine's catch read the same squares:
// src/lib/battlemap/hand-area.ts draws them, src/lib/dm/aoe-shape.ts
// creaturesInBlast catches whoever stands on them.
import type { TemplateSpec } from "@/lib/battlemap/template";
import type { XY } from "@/lib/battlemap/types";
import { textKey } from "@/lib/language/text-logic";

export type AreaShape = {
  shape: "sphere" | "cube" | "cone" | "line" | "cylinder";
  feet: number;
  // The area starts at the caster (a Self spell, a breath weapon).
  self: boolean;
  // The caster picks the creatures in it (Slow's six "of your choice",
  // Destructive Wave's "you choose"): their own side is spared.
  choose?: boolean;
};

// The area a spell or an ability's text prints: "a 20-foot-radius sphere",
// "a 15-foot cone", "a line 100 feet long and 5 feet wide", "a 10-foot-radius,
// 40-foot-high cylinder", "Self (15-foot cube)".
export function areaShapeFromText(text: string, rangeText = ""): AreaShape | null {
  const all = `${rangeText} ${text}`;
  // Creatures chosen, not a point: Fireball's "a point you choose" spares
  // nobody.
  const choose = /\bcreatures? (?:of your choice|you choose)\b/i.test(text) ? { choose: true } : {};
  const self = /\bself\b/i.test(rangeText) || /\b(?:exhales?|breath|from you|originat\w* from you|you (?:emit|unleash|send))\b/i.test(text);
  const radius = /(\d+)-foot[- ]radius(?:,?\s*\d+-foot[- ]high)?\s+(sphere|cylinder)/i.exec(all);
  if (radius) {
    return { shape: radius[2].toLowerCase() as AreaShape["shape"], feet: Number(radius[1]), self, ...choose };
  }
  const sized = /(\d+)-foot[- ](cube|cone|line|sphere|cylinder)/i.exec(all);
  if (sized) {
    return { shape: sized[2].toLowerCase() as AreaShape["shape"], feet: Number(sized[1]), self: self || sized[2].toLowerCase() === "cone", ...choose };
  }
  const line = /\bline\s+(\d+)\s+feet\s+long/i.exec(all);
  if (line) {
    return { shape: "line", feet: Number(line[1]), self: true, ...choose };
  }
  return null;
}

// The SRD's instant blasts, for a server with no content pack to read the
// text from. Lasting areas are laid on the board by their zone rows.
export const SRD_AREAS: Record<string, AreaShape> = {
  "burning hands": { shape: "cone", feet: 15, self: true },
  "color spray": { shape: "cone", feet: 15, self: true },
  thunderwave: { shape: "cube", feet: 15, self: true },
  shatter: { shape: "sphere", feet: 10, self: false },
  fireball: { shape: "sphere", feet: 20, self: false },
  "lightning bolt": { shape: "line", feet: 100, self: true },
  fear: { shape: "cone", feet: 30, self: true },
  "hypnotic pattern": { shape: "cube", feet: 30, self: false },
  sleep: { shape: "sphere", feet: 20, self: false },
  slow: { shape: "cube", feet: 40, self: false, choose: true },
  "faerie fire": { shape: "cube", feet: 20, self: false },
  "ice storm": { shape: "cylinder", feet: 20, self: false },
  "cone of cold": { shape: "cone", feet: 60, self: true },
  "flame strike": { shape: "cylinder", feet: 10, self: false },
  "circle of death": { shape: "sphere", feet: 60, self: false },
  "delayed blast fireball": { shape: "sphere", feet: 20, self: false },
  "prismatic spray": { shape: "cone", feet: 60, self: true },
  sunburst: { shape: "sphere", feet: 60, self: false },
  "destructive wave": { shape: "sphere", feet: 30, self: true, choose: true },
};

// A spell's blast from its own words, else the SRD row of its name.
export function blastShape(name: string, text?: { desc?: string; range?: string }): AreaShape | null {
  return (text?.desc ? areaShapeFromText(text.desc, text.range ?? "") : null) ?? SRD_AREAS[textKey(name)] ?? null;
}

// What the caster picks for a blast: the point a burst or a cube is centred
// on, the way a cone, a line or a cube from the caster points, or nothing
// for a burst around the caster (Destructive Wave).
export type BlastPick = "point" | "direction" | "none";

export function blastPickOf(area: AreaShape): BlastPick {
  if (area.self) {
    return area.shape === "sphere" || area.shape === "cylinder" ? "none" : "direction";
  }
  return area.shape === "cone" || area.shape === "line" ? "direction" : "point";
}

const step = (value: number) => Math.sign(value);

// The template for one placement, or null while the pick does not fix it
// yet (a burst with no centre, a cone with no direction). A burst or a
// cylinder is laid around its point; a cube picked on a point is centred
// on it; a cube from the caster sits against the caster's square on the
// side it is aimed at; a cone and a line start at the caster's square,
// which they never take in.
export function blastTemplate(area: AreaShape, place: { caster: XY | null; at?: XY; toward?: XY }): TemplateSpec | null {
  const shape = area.shape === "cylinder" ? "sphere" : area.shape;
  const tiles = Math.max(1, Math.round(area.feet / 5));
  const half = Math.floor((tiles - 1) / 2);
  const pick = blastPickOf(area);
  if (pick === "none") {
    return place.caster ? { shape, origin: place.caster, target: place.caster, sizeFeet: area.feet } : null;
  }
  if (pick === "point") {
    const at = place.at;
    if (!at) return null;
    if (shape === "cube") {
      const origin = { x: Math.max(0, at.x - half), y: Math.max(0, at.y - half) };
      return { shape, origin, target: { x: origin.x + 1, y: origin.y + 1 }, sizeFeet: area.feet };
    }
    return { shape, origin: at, target: at, sizeFeet: area.feet };
  }
  // A direction: from the caster, or from the square picked for a cone or a
  // line some text places away from its caster.
  const from = area.self ? place.caster : (place.at ?? place.caster);
  const toward = place.toward;
  if (!from || !toward || (toward.x === from.x && toward.y === from.y)) return null;
  if (shape !== "cube") {
    return { shape, origin: from, target: toward, sizeFeet: area.feet };
  }
  // Thunderwave: the cube against the caster's square, centred across the
  // way it is aimed, or out from the caster's corner on a diagonal.
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const straight = Math.abs(dx) > Math.abs(dy) * 2 ? "x" : Math.abs(dy) > Math.abs(dx) * 2 ? "y" : null;
  if (straight === "x") {
    const origin = { x: from.x + step(dx), y: Math.max(0, from.y - half) };
    return { shape, origin, target: { x: origin.x + step(dx), y: origin.y + 1 }, sizeFeet: area.feet };
  }
  if (straight === "y") {
    const origin = { x: Math.max(0, from.x - half), y: from.y + step(dy) };
    return { shape, origin, target: { x: origin.x + 1, y: origin.y + step(dy) }, sizeFeet: area.feet };
  }
  const origin = { x: from.x + step(dx), y: from.y + step(dy) };
  return { shape, origin, target: { x: origin.x + step(dx), y: origin.y + step(dy) }, sizeFeet: area.feet };
}

// The template's measure in words, for the card and the aim bar.
export function blastSummary(area: AreaShape): string {
  switch (area.shape) {
    case "sphere":
      return `${area.feet}-foot-radius sphere${area.self ? " around you" : ""}`;
    case "cylinder":
      return `${area.feet}-foot-radius cylinder`;
    case "cube":
      return `${area.feet}-foot cube${area.self ? " from you" : ""}`;
    case "cone":
      return `${area.feet}-foot cone from you`;
    case "line":
      return `${area.feet}-foot line from you`;
  }
}
