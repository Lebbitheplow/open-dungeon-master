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
} as const;

export type MapLabel = { x: number; y: number; text: string; dmOnly: boolean };

export const PROP_KINDS = ["prop", "npc"] as const;
export type PropKind = (typeof PROP_KINDS)[number];
export type MapProp = { x: number; y: number; name: string; kind: PropKind };

export const DOOR_STATES = ["locked", "secret"] as const;
export type DoorState = (typeof DOOR_STATES)[number];
// Keyed "x,y". A door tile with no entry is an ordinary open doorway.
export type DoorStates = Record<string, DoorState>;

export type LightZone = { x0: number; y0: number; x1: number; y1: number; ambient: AmbientLight };

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
    out.push({ ...at, text: label, dmOnly: source.dmOnly === true });
    if (out.length >= SCENE_LIMITS.labels) {
      break;
    }
  }
  return out;
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
    const ambient = source.ambient;
    if (ambient !== "bright" && ambient !== "dim" && ambient !== "dark") {
      continue;
    }
    const zone: LightZone = {
      x0: Math.max(0, Math.min(width - 1, Math.min(x0, x1))),
      y0: Math.max(0, Math.min(height - 1, Math.min(y0, y1))),
      x1: Math.max(0, Math.min(width - 1, Math.max(x0, x1))),
      y1: Math.max(0, Math.min(height - 1, Math.max(y0, y1))),
      ambient,
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
