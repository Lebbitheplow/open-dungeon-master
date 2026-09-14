import { TERRAIN, inBounds, tileIndex, type AmbientLight, type XY } from "@/lib/battlemap/types";

// The scene layer: what a map carries beyond its ground and its lights.
//
// docs/workshop-parity-audit.md phase 13. Foundry puts these on separate
// canvas layers (walls with door states, notes, regions, tiles); here each
// is a small JSON column on the map row, validated by this module, and the
// engine learns exactly one new thing: a door can be locked or secret, and
// while it is, the tile it sits on is a wall to everything that walks or
// looks. That is done ONCE, in the database rim, by handing the engine a
// terrain string with those doors already turned to rock
// (effectiveTerrain), so no movement, sight, cover or spawn code learns a
// second shape.
//
// Everything else here is what a person sees: labels on tiles, furniture
// to put on the board at deploy, patches of light or dark, a picture only
// the DM sees, and the sound a place makes.
//
// Pure by design: no DB and no I/O, so scripts/test-map-scene.mjs drives it.

export const SCENE_LIMITS = {
  labels: 40,
  labelText: 60,
  props: 30,
  propName: 40,
  doors: 80,
  zones: 12,
  drawings: 40,
  drawingPoints: 64,
} as const;

// What a label may point at: tapping the pin opens the entry for whoever
// the entry's visibility allows (docs/vtt-parity-implementation-plan.md
// section 3.5).
export const LABEL_REF_KINDS = ["lore", "npc", "monster", "table"] as const;
export type LabelRefKind = (typeof LABEL_REF_KINDS)[number];
export type LabelRef = { kind: LabelRefKind; id: string };

export type MapLabel = { x: number; y: number; text: string; dmOnly: boolean; ref?: LabelRef };

// A freehand mark on the board (section 3.6): a shared intention, not a
// fact, so it is never fogged; DM-only marks are projected out. Points are
// in tile units with decimals, simplified to at most drawingPoints.
export const DRAWING_KINDS = ["stroke", "arrow", "rect", "ellipse"] as const;
export type DrawingKind = (typeof DRAWING_KINDS)[number];
export const DRAWING_TONES = ["gold", "ember", "sky", "moss", "bone"] as const;
export type DrawingTone = (typeof DRAWING_TONES)[number];
export type MapDrawing = {
  id: string;
  kind: DrawingKind;
  points: XY[];
  tone: DrawingTone;
  dmOnly: boolean;
  // Who drew it, so they may erase their own.
  authorId?: string;
  // The last round it is shown in; absent means until erased.
  expiresRound?: number;
};

export const PROP_KINDS = ["prop", "npc"] as const;
export type PropKind = (typeof PROP_KINDS)[number];
export type MapProp = { x: number; y: number; name: string; kind: PropKind };

export const DOOR_STATES = ["locked", "secret"] as const;
export type DoorState = (typeof DOOR_STATES)[number];
// Keyed "x,y". A door tile with no entry is an ordinary open doorway.
export type DoorStates = Record<string, DoorState>;

// A patch of light, a patch of darkness, or magical darkness that even
// darkvision cannot pierce (section 3.3). "light" is the ordinary zone with
// its own ambient; the two darkness kinds are always dark.
export const ZONE_KINDS = ["light", "darkness", "magical_darkness"] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];
export type LightZone = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  ambient: AmbientLight;
  kind: ZoneKind;
};

// Cue ids from src/lib/ambience/catalog.ts, or "" for "leave it alone".
export type SceneAmbience = { bed: string; music: string };

export const EMPTY_AMBIENCE: SceneAmbience = { bed: "", music: "" };

type Raw = Record<string, unknown>;

function int(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.round(number) : null;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function point(raw: Raw, width: number, height: number): XY | null {
  const x = int(raw.x);
  const y = int(raw.y);
  return x !== null && y !== null && inBounds(width, height, x, y) ? { x, y } : null;
}

export function doorKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseDoorKey(key: string): XY | null {
  const match = /^(\d+),(\d+)$/.exec(key);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

// ---- normalizers: a list cleaned, never refused ----

export function normalizeLabels(raw: unknown, width: number, height: number): MapLabel[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<number>();
  const out: MapLabel[] = [];
  for (const entry of raw) {
    const source = (entry ?? {}) as Raw;
    const at = point(source, width, height);
    const label = text(source.text, SCENE_LIMITS.labelText);
    if (!at || !label) {
      continue;
    }
    const index = tileIndex(width, at.x, at.y);
    if (seen.has(index)) {
      continue;
    }
    seen.add(index);
    const ref = normalizeLabelRef(source.ref);
    out.push({ ...at, text: label, dmOnly: source.dmOnly === true, ...(ref ? { ref } : {}) });
    if (out.length >= SCENE_LIMITS.labels) {
      break;
    }
  }
  return out;
}

function normalizeLabelRef(raw: unknown): LabelRef | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const source = raw as Raw;
  const kind = LABEL_REF_KINDS.includes(source.kind as LabelRefKind) ? (source.kind as LabelRefKind) : null;
  const id = text(source.id, 80);
  return kind && id ? { kind, id } : null;
}

// ---- drawings ----

// Ramer-Douglas-Peucker: keep the points that matter to the shape, drop
// the rest, so a finger's jitter does not become forty vertices.
export function simplifyPoints(points: XY[], epsilon: number): XY[] {
  if (points.length <= 2) {
    return points;
  }
  const first = points[0];
  const last = points[points.length - 1];
  let farthest = 0;
  let index = -1;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const length = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i];
    const distance = Math.abs(dy * p.x - dx * p.y + last.x * first.y - last.y * first.x) / length;
    if (distance > farthest) {
      farthest = distance;
      index = i;
    }
  }
  if (farthest > epsilon && index > 0) {
    const left = simplifyPoints(points.slice(0, index + 1), epsilon);
    const right = simplifyPoints(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function drawingPoint(raw: unknown, width: number, height: number): XY | null {
  const source = (raw ?? {}) as Raw;
  const x = Number(source.x);
  const y = Number(source.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return {
    x: Math.round(Math.max(0, Math.min(width, x)) * 100) / 100,
    y: Math.round(Math.max(0, Math.min(height, y)) * 100) / 100,
  };
}

export function normalizeDrawing(raw: unknown, width: number, height: number): MapDrawing | null {
  const source = (raw ?? {}) as Raw;
  const kind = DRAWING_KINDS.includes(source.kind as DrawingKind) ? (source.kind as DrawingKind) : null;
  if (!kind) {
    return null;
  }
  const rawPoints = Array.isArray(source.points) ? source.points : [];
  let points = rawPoints
    .map((entry) => drawingPoint(entry, width, height))
    .filter((entry): entry is XY => entry !== null);
  if (kind !== "stroke") {
    // Two corners describe a box, an ellipse or an arrow.
    points = points.length >= 2 ? [points[0], points[points.length - 1]] : points;
  }
  if (points.length < 2) {
    return null;
  }
  if (kind === "stroke") {
    let epsilon = 0.08;
    while (points.length > SCENE_LIMITS.drawingPoints) {
      points = simplifyPoints(points, epsilon);
      epsilon *= 1.6;
    }
  }
  const tone = DRAWING_TONES.includes(source.tone as DrawingTone) ? (source.tone as DrawingTone) : "gold";
  const id = text(source.id, 40) || crypto.randomUUID();
  const expires = Number(source.expiresRound);
  const authorId = text(source.authorId, 80);
  return {
    id,
    kind,
    points,
    tone,
    dmOnly: source.dmOnly === true,
    ...(authorId ? { authorId } : {}),
    ...(Number.isFinite(expires) && expires > 0 ? { expiresRound: Math.round(expires) } : {}),
  };
}

export function normalizeDrawings(raw: unknown, width: number, height: number): MapDrawing[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: MapDrawing[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const drawing = normalizeDrawing(entry, width, height);
    if (!drawing || seen.has(drawing.id)) {
      continue;
    }
    seen.add(drawing.id);
    out.push(drawing);
  }
  // Newest last; the oldest go first when over the cap.
  return out.slice(-SCENE_LIMITS.drawings);
}

// The drawings a viewer sees: the DM's own stay with the DM, and a mark
// with a round to live has already faded once the round has passed.
export function drawingsFor(
  drawings: MapDrawing[],
  viewer: { dm: boolean; round: number },
): MapDrawing[] {
  return drawings.filter(
    (drawing) =>
      (viewer.dm || !drawing.dmOnly) &&
      (drawing.expiresRound === undefined || drawing.expiresRound >= viewer.round),
  );
}

// Furniture cannot stand in a wall; anything on rock is dropped.
export function normalizeProps(raw: unknown, terrain: string, width: number, height: number): MapProp[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<number>();
  const out: MapProp[] = [];
  for (const entry of raw) {
    const source = (entry ?? {}) as Raw;
    const at = point(source, width, height);
    const name = text(source.name, SCENE_LIMITS.propName);
    if (!at || !name) {
      continue;
    }
    const index = tileIndex(width, at.x, at.y);
    if (seen.has(index) || terrain[index] === TERRAIN.wall) {
      continue;
    }
    seen.add(index);
    out.push({ ...at, name, kind: source.kind === "npc" ? "npc" : "prop" });
    if (out.length >= SCENE_LIMITS.props) {
      break;
    }
  }
  return out;
}

// A state only means something on a door tile; entries elsewhere (a door
// that was painted over since) are dropped rather than kept as ghosts.
export function normalizeDoors(raw: unknown, terrain: string, width: number, height: number): DoorStates {
  const out: DoorStates = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return out;
  }
  let count = 0;
  for (const [key, state] of Object.entries(raw as Raw)) {
    const at = parseDoorKey(key);
    if (!at || !inBounds(width, height, at.x, at.y)) {
      continue;
    }
    if (!DOOR_STATES.includes(state as DoorState)) {
      continue;
    }
    if (terrain[tileIndex(width, at.x, at.y)] !== TERRAIN.door) {
      continue;
    }
    out[doorKey(at.x, at.y)] = state as DoorState;
    count += 1;
    if (count >= SCENE_LIMITS.doors) {
      break;
    }
  }
  return out;
}

export function normalizeZones(raw: unknown, width: number, height: number): LightZone[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: LightZone[] = [];
  for (const entry of raw) {
    const source = (entry ?? {}) as Raw;
    const x0 = int(source.x0);
    const y0 = int(source.y0);
    const x1 = int(source.x1);
    const y1 = int(source.y1);
    if (x0 === null || y0 === null || x1 === null || y1 === null) {
      continue;
    }
    const kind = ZONE_KINDS.includes(source.kind as ZoneKind) ? (source.kind as ZoneKind) : "light";
    // A darkness zone is dark whatever it says; a light zone needs a level.
    const ambient = kind === "light" ? source.ambient : "dark";
    if (ambient !== "bright" && ambient !== "dim" && ambient !== "dark") {
      continue;
    }
    const zone: LightZone = {
      x0: Math.max(0, Math.min(width - 1, Math.min(x0, x1))),
      y0: Math.max(0, Math.min(height - 1, Math.min(y0, y1))),
      x1: Math.max(0, Math.min(width - 1, Math.max(x0, x1))),
      y1: Math.max(0, Math.min(height - 1, Math.max(y0, y1))),
      ambient,
      kind,
    };
    out.push(zone);
    if (out.length >= SCENE_LIMITS.zones) {
      break;
    }
  }
  return out;
}

export function normalizeAmbience(raw: unknown): SceneAmbience {
  const source = (raw ?? {}) as Raw;
  return { bed: text(source.bed, 60), music: text(source.music, 60) };
}

// ---- what the engine and the people see ----

// The terrain the engine runs. A locked door is a wall to everyone; a
// secret door is a wall to everyone until the DM reveals it. The DM's own
// drawing keeps the door glyphs and a badge (see the projection), because
// the DM has to be able to find the door to open it.
export function effectiveTerrain(terrain: string, width: number, doors: DoorStates): string {
  const keys = Object.keys(doors);
  if (!keys.length) {
    return terrain;
  }
  const tiles = terrain.split("");
  for (const key of keys) {
    const at = parseDoorKey(key);
    if (!at) {
      continue;
    }
    const index = tileIndex(width, at.x, at.y);
    if (tiles[index] === TERRAIN.door) {
      tiles[index] = TERRAIN.wall;
    }
  }
  return tiles.join("");
}

// One tap on a door walks it round: open, locked, secret, open.
export function nextDoorState(state: DoorState | undefined): DoorState | undefined {
  if (!state) {
    return "locked";
  }
  return state === "locked" ? "secret" : undefined;
}

export function toggleDoor(
  doors: DoorStates,
  at: XY,
  terrain: string,
  width: number,
  height: number,
): { doors: DoorStates; state: DoorState | null } | { error: string } {
  if (!inBounds(width, height, at.x, at.y)) {
    return { error: "That tile is off the map." };
  }
  if (terrain[tileIndex(width, at.x, at.y)] !== TERRAIN.door) {
    return { error: "Only a door can be locked or hidden. Paint a door there first." };
  }
  const key = doorKey(at.x, at.y);
  const next = nextDoorState(doors[key]);
  const out = { ...doors };
  if (next) {
    out[key] = next;
  } else {
    delete out[key];
  }
  return { doors: out, state: next ?? null };
}

// The ambient light on one tile: the last zone drawn over it wins, so a
// small dark corner inside a lit hall can be drawn after the hall.
// Whether a tile lies in magical darkness, which darkvision cannot pierce.
export function magicalDarknessAt(zones: LightZone[], x: number, y: number): boolean {
  let dark = false;
  for (const zone of zones) {
    if (x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1) {
      dark = zone.kind === "magical_darkness";
    }
  }
  return dark;
}

export function ambientAt(zones: LightZone[], x: number, y: number, base: AmbientLight): AmbientLight {
  let ambient = base;
  for (const zone of zones) {
    if (x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1) {
      ambient = zone.ambient;
    }
  }
  return ambient;
}

// Labels a viewer may see: the DM sees all of them; a player sees the ones
// meant for the table, and only where they have been.
export function labelsFor(
  labels: MapLabel[],
  width: number,
  viewer: { dm: boolean; explored?: Set<number> },
): MapLabel[] {
  if (viewer.dm) {
    return labels;
  }
  return labels.filter(
    (label) => !label.dmOnly && (!viewer.explored || viewer.explored.has(tileIndex(width, label.x, label.y))),
  );
}

// One line each for the DM's prompt, so the model running the fight knows
// which doors are shut and what the rooms are called.
export function describeScene(input: { doors: DoorStates; labels: MapLabel[] }): string[] {
  const lines: string[] = [];
  const locked = Object.entries(input.doors).filter(([, state]) => state === "locked").map(([key]) => `(${key})`);
  const secret = Object.entries(input.doors).filter(([, state]) => state === "secret").map(([key]) => `(${key})`);
  if (locked.length) {
    lines.push(`Locked doors (a wall until unlocked) at ${locked.join(", ")}.`);
  }
  if (secret.length) {
    lines.push(`Secret doors (unknown to the party; a wall until found) at ${secret.join(", ")}.`);
  }
  if (input.labels.length) {
    lines.push(
      `Labels: ${input.labels.map((label) => `(${label.x},${label.y}) ${label.text}${label.dmOnly ? " [DM only]" : ""}`).join("; ")}.`,
    );
  }
  return lines;
}
