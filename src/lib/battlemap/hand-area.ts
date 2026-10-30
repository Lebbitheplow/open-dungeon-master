// Aiming a spell that leaves an area on the battle map (Web, Moonbeam, a Wall
// of Fire, Gust of Wind), or blasts one at once (Fireball, Burning Hands,
// Thunderwave: issue 570): which squares the caster picks, what the pick
// sends as the tool's placement arguments (src/lib/dm/zone-args.ts
// ZONE_ARGS), and the squares the engine will lay or catch creatures in for
// it, drawn on the board while the player or the DM aims.
//
// The squares come from the engine's own geometry (src/lib/battlemap/zones.ts
// layZone) and the spell's own row (zones-spells.ts), laid from the point
// src/lib/dm/zone-cast.ts placeSpellZone takes for a named square: a burst on
// the square named, a wall from its first square toward the second, a line
// from the caster toward the square named, an aura (Spirit Guardians) or a
// self-centred spell (Globe of Invulnerability) on the caster whatever is
// named. scripts/test-enforce-zones-ui.mjs casts each shape with the pick's
// arguments and holds the stored area to this preview. A blast's squares are
// the template src/lib/battlemap/area-shape.ts places, the same one the
// engine catches creatures in (src/lib/dm/aoe-shape.ts creaturesInBlast).
//
// Pure: the Hand, the board and the console's form all import it.
import { layZone, type ZoneLayout, type ZoneMap } from "@/lib/battlemap/zones";
import { zoneRowFor, type ZoneNamed, type ZoneShape, type ZoneTone } from "@/lib/battlemap/zones-spells";
import { blastPickOf, blastShape, blastSummary, blastTemplate, type AreaShape } from "@/lib/battlemap/area-shape";
import { templateTiles } from "@/lib/battlemap/template";
import type { XY } from "@/lib/battlemap/types";

// What the caster picks: a point (a burst's centre), a wall (its first
// square, then the square it runs toward), a direction (a line from the
// caster), or nothing (the area sits on the caster).
export type AreaPickKind = "point" | "wall" | "direction" | "none";

export type HandArea = {
  spell: string;
  // A table's workshop copy: the published spell whose area it lays.
  runsAs?: string;
  slotLevel: number | null;
  pick: AreaPickKind;
  shape: ZoneShape;
  tone: ZoneTone;
  // The spell row's own line, for the aim bar ("difficult terrain; ...").
  summary: string;
  // An instant blast's template (Fireball's sphere, Burning Hands' cone):
  // nothing stays on the ground, and the creatures on its squares are the
  // ones it catches. Absent for a lasting area.
  blast?: AreaShape;
};

export type AreaPick = { at?: XY; toward?: XY };

export type AreaArgs = { atX?: number; atY?: number; towardX?: number; towardY?: number };

export function areaFor(named: ZoneNamed, slotLevel: number | null = null): HandArea | null {
  const row = zoneRowFor(named);
  // A light spell lights the caster's token; there is nothing to aim.
  if (!row) return null;
  const spell = typeof named === "string" ? named : named.spell;
  const runsAs = typeof named === "string" ? undefined : named.runsAs;
  const pick: AreaPickKind =
    row.shape === "aura" || row.self ? "none" : row.shape === "line" ? "direction" : row.shape === "wall" ? "wall" : "point";
  return { spell, ...(runsAs ? { runsAs } : {}), slotLevel, pick, shape: row.shape, tone: row.tone, summary: row.summary };
}

// The colour a blast is drawn in, by what it deals.
const BLAST_TONES: Record<string, ZoneTone> = {
  fire: "fire",
  cold: "frost",
  lightning: "storm",
  thunder: "storm",
  radiant: "radiant",
  necrotic: "gloom",
  poison: "poison",
  acid: "poison",
  force: "force",
  psychic: "hush",
};

// An instant blast's area for its card, read from the spell's own words (or
// the SRD row of its name); null for a spell with a lasting area or none.
export function blastAreaFor(
  named: ZoneNamed,
  text: { desc?: string; range?: string },
  slotLevel: number | null = null,
  damageType = "",
): HandArea | null {
  if (zoneRowFor(named)) return null;
  const spell = typeof named === "string" ? named : named.spell;
  const runsAs = typeof named === "string" ? undefined : named.runsAs;
  const blast = blastShape(runsAs ?? spell, runsAs ? undefined : text) ?? (runsAs ? blastShape(spell, text) : null);
  if (!blast) return null;
  const shape: ZoneShape = blast.shape === "cube" ? "cube" : blast.shape === "cone" || blast.shape === "line" ? "line" : "sphere";
  return {
    spell,
    ...(runsAs ? { runsAs } : {}),
    slotLevel,
    pick: blastPickOf(blast),
    shape,
    tone: BLAST_TONES[damageType.toLowerCase()] ?? "force",
    summary: blastSummary(blast),
    blast,
  };
}

const same = (a: XY | undefined, b: XY | undefined) => Boolean(a && b && a.x === b.x && a.y === b.y);

// The placement arguments a pick sends, under the tools' own names.
export function areaArgs(area: HandArea, pick: AreaPick): AreaArgs {
  const at = pick.at && (area.pick === "point" || area.pick === "wall") ? { atX: pick.at.x, atY: pick.at.y } : {};
  const toward =
    pick.toward && (area.pick === "direction" || (area.pick === "wall" && pick.at && !same(pick.at, pick.toward)))
      ? { towardX: pick.toward.x, towardY: pick.toward.y }
      : {};
  return { ...at, ...toward };
}

// Whether the pick names anything the tool would send.
export function hasPick(area: HandArea | null | undefined, pick: AreaPick | null | undefined): boolean {
  return Boolean(area && pick && Object.keys(areaArgs(area, pick)).length);
}

// What a tap on the board makes of the pick so far. A wall takes two taps
// (its first square, then where it runs); a third starts it again.
export function nextPick(area: HandArea, pick: AreaPick, tap: XY): AreaPick {
  switch (area.pick) {
    case "point":
      return { at: tap };
    case "direction":
      return { toward: tap };
    case "wall":
      if (!pick.at || pick.toward || same(pick.at, tap)) return { at: tap };
      return { at: pick.at, toward: tap };
    case "none":
      return pick;
  }
}

// The pick as it would be if the square under the pointer were tapped: what
// the board previews while the player aims.
export function hoverPick(area: HandArea, pick: AreaPick, hover: XY | null): AreaPick {
  if (!hover) return pick;
  if (area.pick === "wall" && pick.at && !pick.toward) {
    return same(pick.at, hover) ? pick : { at: pick.at, toward: hover };
  }
  return nextPick(area, pick, hover);
}

// The squares the engine lays for this pick, or null when the pick does not
// fix them yet (a burst with no centre, a line with no direction).
export function areaCells(area: HandArea, pick: AreaPick, map: ZoneMap, caster: XY | null): ZoneLayout | null {
  if (area.blast) {
    const spec = blastTemplate(area.blast, { caster, ...(pick.at ? { at: pick.at } : {}), ...(pick.toward ? { toward: pick.toward } : {}) });
    return spec ? { cells: templateTiles(map, spec) } : null;
  }
  const row = zoneRowFor(area);
  if (!row) return null;
  let origin: XY | null;
  let toward: XY | null = null;
  if (area.pick === "none") {
    origin = caster;
  } else if (area.pick === "direction") {
    origin = caster;
    toward = pick.toward ?? null;
    if (!toward) return null;
  } else {
    origin = pick.at ?? null;
    toward = area.pick === "wall" ? pick.toward ?? null : null;
  }
  if (!origin) return null;
  return layZone(row, { origin, toward, caster, slotLevel: area.slotLevel }, map);
}

// The pick in words, for the aim bar and the sentence the engine reads.
export function describePick(area: HandArea, pick: AreaPick): string {
  const square = (point: XY) => `(${point.x},${point.y})`;
  if (area.pick === "none") return area.blast ? "around me" : "centred on you";
  if (area.pick === "direction") return pick.toward ? `toward ${square(pick.toward)}` : "";
  if (area.pick === "wall") {
    if (!pick.at) return "";
    return pick.toward && !same(pick.at, pick.toward)
      ? `from ${square(pick.at)} toward ${square(pick.toward)}`
      : `from ${square(pick.at)}`;
  }
  return pick.at ? `centred on ${square(pick.at)}` : "";
}

// What the board asks for next, in the aim bar's words.
export function pickHint(area: HandArea, pick: AreaPick): string {
  switch (area.pick) {
    case "none":
      return area.blast ? "It bursts around you." : "It is laid around you.";
    case "direction":
      return pick.toward
        ? "Tap another square to turn it."
        : area.blast
          ? `Tap the board where the ${area.blast.shape} points.`
          : "Tap the board where the line blows toward.";
    case "wall":
      return !pick.at
        ? "Tap the board where the wall begins."
        : pick.toward
          ? "Tap again to start the wall over."
          : "Tap where it runs toward, or leave it across your view.";
    case "point":
      return pick.at ? "Tap another square to move it." : "Tap the board where it is centred.";
  }
}

// ---- the window events that carry a pick between screens ----
//
// The Hand announces its raised card on HAND_AIM_EVENT (hand-play.ts), now
// with the area and the pick so far; the board answers a tap with
// HAND_AREA_EVENT. A console form asks the board for one square with
// SQUARE_REQUEST_EVENT; the board says it is listening with
// SQUARE_ARMED_EVENT and answers with SQUARE_PICKED_EVENT (null when the
// pick was called off). A board opened after the card was raised asks for it
// again with HAND_AIM_ASK_EVENT.
export const HAND_AREA_EVENT = "odm:hand-area";
export const HAND_AIM_ASK_EVENT = "odm:hand-aim-ask";
export const SQUARE_REQUEST_EVENT = "odm:square-request";
export const SQUARE_ARMED_EVENT = "odm:square-armed";
export const SQUARE_PICKED_EVENT = "odm:square-picked";

export type HandAreaDetail = { cardId: string; pick: AreaPick };

export type SquareRequestDetail = {
  requestId: string;
  // Which square of the area this is: its centre or first square, or where
  // it runs toward.
  role: "at" | "toward";
  label: string;
  area: HandArea | null;
  // The other square of the pair when it is already filled in.
  at?: XY;
  toward?: XY;
  // Whose area it is, to lay a line or an aura from their token.
  casterRef?: string;
};

export type SquarePickedDetail = { requestId: string; square: XY | null };

// The pick a console request previews with the square under the pointer.
export function requestPick(request: SquareRequestDetail, hover: XY | null): AreaPick {
  const base: AreaPick = { ...(request.at ? { at: request.at } : {}), ...(request.toward ? { toward: request.toward } : {}) };
  if (!hover) return base;
  if (request.role === "toward" || request.area?.pick === "direction") return { ...base, toward: hover };
  return { ...base, at: hover };
}
