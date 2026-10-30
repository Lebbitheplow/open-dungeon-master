import { normalizeOptionValues, type OptionValues } from "@/lib/addons/contracts";
import type { OptionField } from "@/lib/addons/manifest";
import type { FxEvent } from "@/lib/battlemap/fx-plan";
import type { TokenIntent } from "@/lib/battlemap/intent";
import type { PlayerMapView } from "@/lib/battlemap/view-types";
import type { Gender } from "@/lib/gender";
import type { Ruler } from "@/lib/battlemap/board-move";

// The board view contract: what the table page posts into an addon's
// sandboxed frame, and what it accepts back (docs/addons/extension-points.md,
// "Board views").
//
// The frame is an addon's own HTML page, loaded with sandbox="allow-scripts"
// and no allow-same-origin, so it runs in an opaque origin: it cannot read
// the session cookie, call the API as the player, or reach the page around
// it. Everything it knows arrives in a snapshot, and everything it can do is
// a message the page turns into the tap the built-in board would have
// received. The rules engine never hears from the addon directly.
//
// The snapshot is built from the projection the server already made for
// this viewer, so fog, hidden tokens and the DM-only layers are exactly what
// the built-in board would draw: a player's frame never holds a hidden
// enemy because the server never sent it. It carries every layer the flat
// board draws (spell areas, auras, labels, marks, intents, who attacked
// whom), and the moments arrive as they happen: effects, pings, the DM's
// camera. A view that draws figures somewhere other than the grid's squares
// reports where they are on screen ("anchors"), so the table's plates and
// action ring sit on the figures it drew.
//
// Pure and client-safe.

export const BOARD_BRIDGE_VERSION = 1;

export type BoardSnapshotToken = {
  id: string;
  kind: string;
  name: string;
  x: number;
  y: number;
  // Squares per side: 1 for medium, 2 for large, and so on.
  size: number;
  mine: boolean;
  down: boolean;
  hidden: boolean;
  elevation: "flying" | "burrowing" | null;
  health: string | null;
  conditions: string[];
  // A painted object a prop is drawn as, or "".
  stamp: string;
  // What it is, for a view that draws creatures by kind: a monster's type,
  // stat block and challenge rating, or a character's lineage and class.
  // Null when it is neither (a prop, a bystander the DM put down by hand).
  creature: { type: string; slug: string; cr: number } | null;
  character: { race: string; class: string; gender?: Gender } | null;
  // Auras around it, by reach in feet and what they do.
  auras: Array<{ radiusFeet: number; tone: string }>;
};

// A tile on the board, as the effects and marks give them.
export type BoardPoint = { x: number; y: number };

// What makes the snapshot beyond the projection: who the tokens are, and
// what the enemies mean to do, from the page's own state.
export type BoardLook = { creature?: BoardSnapshotToken["creature"]; character?: BoardSnapshotToken["character"] };

export type BoardSnapshot = {
  bridge: number;
  mapId: string;
  width: number;
  height: number;
  // Row-major, one character per tile; unexplored tiles are spaces.
  terrain: string;
  legend: Record<string, string>;
  theme: string;
  // Optional public visual binding; older board views can ignore it.
  skin?: PlayerMapView["skin"];
  genre?: string | null;
  ambient: string;
  outdoors: boolean;
  visible: number[];
  explored: number[];
  fullVision: boolean;
  tokens: BoardSnapshotToken[];
  lights: Array<{ x: number; y: number; radius: number }>;
  turn: { tokenId: string; round: number } | null;
  board: "fight" | "scene";
  myTokenId: string | null;
  reachable: number[];
  // Remaining movement in squares; absent from older hosts.
  budgetLeft?: number;
  // The square a first tap aimed this viewer's walk at, or null: a second
  // tap there makes the walk (the flat board holds its ruler on it).
  moveAim: { x: number; y: number } | null;
  // Whether the map has a picture under it; ask for it as the file "backdrop".
  hasBackdrop: boolean;
  // What this addon's own generator left on the map, or null.
  view: { data: unknown; files: Array<{ name: string; type: string; bytes: number }> } | null;
  // Where this addon's asset library is served (its data folder's public/,
  // which its setup fills): fetch "<assetsUrl><file>".
  assetsUrl: string;
  // This viewer's choices for the view's own options (the manifest's
  // boardViews[].options), normalized to the fields, defaults filled in.
  options: OptionValues;
  viewer: { canDirect: boolean };
  appearance: { theme: "night" | "day"; reducedMotion: boolean; audio?: { muted: boolean; volume: number } };
  round: number;
  turnName: string;
  // Spell areas on the squares this viewer has explored: how each is drawn
  // ("wall", "cloud", "ground", "light", "dark", "ward"), its squares, and
  // a wall of fire's burning side.
  zones: Array<{ id: string; spell: string; caster: string; tone: string; look: string; cells: number[]; hot: number[]; label: string; untilRound: number | null }>;
  // Labels pinned to squares, and the marks people drew (points in tiles).
  labels: Array<{ x: number; y: number; text: string; dmOnly: boolean }>;
  marks: Array<{ id: string; kind: string; tone: string; points: BoardPoint[] }>;
  // What each enemy this viewer can see means to do this round.
  intents: Array<{ tokenId: string; verb: string; targetTokenId: string | null; expected: number | null; stale: boolean }>;
  // Who attacked whom this round, by token id.
  targets: Record<string, string[]>;
  // The DM's view only: locked and secret doors, keyed "x,y".
  doors: Record<string, string> | null;
};

const LEGEND = {
  ".": "floor",
  "#": "wall",
  "~": "water",
  ",": "difficult",
  "+": "door",
  "|": "lowwall",
  "^": "climb",
  " ": "unexplored",
};

export function boardSnapshot(
  view: PlayerMapView,
  addonId: string,
  options: {
    canDirect: boolean;
    genre?: string | null;
    appearance: BoardSnapshot["appearance"];
    looks?: Map<string, BoardLook>;
    intents?: TokenIntent[] | null;
    moveAim?: { x: number; y: number } | null;
    assetsUrl?: string;
    // The view's option fields and what this device chose for them.
    viewOptions?: { fields: OptionField[]; values: unknown };
  },
): BoardSnapshot {
  const own = view.addonView && view.addonView.addonId === addonId ? view.addonView : null;
  const shown = new Set(view.tokens.map((token) => token.id));
  return {
    bridge: BOARD_BRIDGE_VERSION,
    mapId: view.mapId,
    width: view.width,
    height: view.height,
    terrain: view.terrain,
    legend: LEGEND,
    theme: view.theme,
    skin: view.skin,
    genre: options.genre ?? null,
    ambient: view.ambient,
    outdoors: view.outdoors,
    visible: view.visible,
    explored: view.explored,
    fullVision: view.fullVision,
    tokens: view.tokens.map((token) => ({
      id: token.id,
      kind: token.kind,
      name: token.name,
      x: token.x,
      y: token.y,
      size: view.tokenFootprint[token.id] ?? 1,
      mine: token.mine,
      down: token.down,
      hidden: token.hidden,
      elevation: view.tokenElevation[token.id] ?? null,
      health: view.tokenHealth[token.id] ?? null,
      conditions: (view.tokenConditions[token.id] ?? []).map((entry) => entry.label),
      stamp: token.stamp,
      creature: options.looks?.get(token.refId)?.creature ?? null,
      character: options.looks?.get(token.refId)?.character ?? null,
      auras: (view.tokenAuras[token.id] ?? []).map((aura) => ({ radiusFeet: aura.radiusFeet, tone: aura.tone })),
    })),
    lights: view.lights,
    turn: view.turn,
    board: view.board,
    myTokenId: view.myTokenId,
    reachable: view.reachable,
    budgetLeft: view.budgetLeft,
    moveAim: options.moveAim ?? null,
    hasBackdrop: Boolean(view.backdrop),
    view: own ? { data: own.data, files: own.files.map(({ name, type, bytes }) => ({ name, type, bytes })) } : null,
    assetsUrl: options.assetsUrl ?? `/api/addons/${addonId}/assets/`,
    options: options.viewOptions ? normalizeOptionValues(options.viewOptions.fields, options.viewOptions.values) : {},
    viewer: { canDirect: options.canDirect },
    appearance: options.appearance,
    round: view.round,
    turnName: view.currentTurnName,
    zones: (view.spellZones ?? []).map((zone) => ({
      id: zone.id,
      spell: zone.spell,
      caster: zone.casterName,
      tone: zone.tone,
      look: zone.look,
      cells: zone.cells,
      hot: zone.hot,
      label: zone.label,
      untilRound: zone.untilRound,
    })),
    labels: view.labels.map((label) => ({ x: label.x, y: label.y, text: label.text, dmOnly: label.dmOnly })),
    marks: view.drawings.map((mark) => ({ id: mark.id, kind: mark.kind, tone: mark.tone, points: mark.points.map((point) => ({ x: point.x, y: point.y })) })),
    // Only about figures this viewer can see, like the flat board's layer.
    intents: (options.intents ?? view.intents ?? [])
      .filter((intent) => shown.has(intent.actorTokenId))
      .map((intent) => ({
        tokenId: intent.actorTokenId,
        verb: intent.verb,
        targetTokenId: intent.targetTokenId && shown.has(intent.targetTokenId) ? intent.targetTokenId : null,
        expected: typeof intent.expected === "number" ? intent.expected : null,
        stale: typeof intent.round === "number" && intent.round < view.round,
      })),
    targets: Object.fromEntries(
      Object.entries(view.targets ?? {})
        .filter(([id]) => shown.has(id))
        .map(([id, list]) => [id, list.filter((target) => shown.has(target))]),
    ),
    doors: view.doors ? { ...view.doors } : null,
  };
}

// An effect as a board view gets it: what happened, where, to whom, and the
// number when this viewer may see it (the projection already took it out
// when not). The sound cue stays with the page, which plays it.
export type BoardFx = Omit<FxEvent, "sting" | "numbers">;

export function boardFx(events: FxEvent[]): BoardFx[] {
  return events.map((event) => {
    const rest: Partial<FxEvent> = { ...event };
    delete rest.sting;
    delete rest.numbers;
    return rest as BoardFx;
  });
}

// What the page sends the frame. Effects, pings and the camera are moments:
// each arrives once, as it happens.
export function boardRuler(view: PlayerMapView, ruler: Ruler | null): Ruler | null {
  if (!ruler || ruler.path.length < 2 || ruler.path.length > view.width * view.height + 1) return null;
  return ruler.path.every(({ x, y }) => Number.isInteger(x) && Number.isInteger(y)
    && x >= 0 && y >= 0 && x < view.width && y < view.height
    && view.terrain[y * view.width + x] !== " ") ? ruler : null;
}

export type CameraControl = "zoom-in" | "zoom-out" | "fit" | "left" | "right" | "up" | "down";
export type ViewCameraState = { x: number; y: number; zoom: number };

// Host-owned presentation only; callbacks and gameplay rules never cross the bridge.
export type BoardActionMenu = { tokenId: string; hint?: string; actions: Array<{ id: string; label: string; disabled: string | null }> };
export const BOARD_VALUE_CONTROLS = ["prompt-submit", "move-mode", "view", "play-as", "tool", "place-kind", "place-name", "measure-shape", "measure-size", "draw-kind", "draw-tone", "hand-card", "hand-target", "hand-option", "hand-rider", "hand-choice", "hand-share", "hand-trigger", "order-entry", "order-name", "order-score"] as const;
export const BOARD_CONTROL_IDS = ["end-turn", "undo-move", "zoom-in", "zoom-out", "fit", "follow-turn", "camera-pull", "camera-lock", "camera-free", "camera-release", "cancel", "prompt-cancel", "order", "panel-close", "tools", "enlarge", "point", "draw", "draw-ttl", "draw-erase", "measure-clear", "measure-copy", "hand-back", "hand-play", "hand-edit", "hand-area-clear", "hand-confirm", "hand-keep", "order-up", "order-down", "order-delay", "order-remove", "order-take", "order-back", "order-forward", "order-reset", "order-insert", "order-enemies-play", "order-enemies-pass", "order-companion", "confirm", ...BOARD_VALUE_CONTROLS] as const;
export type BoardControlId = typeof BOARD_CONTROL_IDS[number];
export type BoardControl = { id: BoardControlId; label: string; disabled: string | null; value?: string; options?: Array<{ value: string; label: string; disabled: string | null }>; input?: { value: string; numeric?: boolean } };
export type BoardPanel = { title: string; lines: string[]; controls: BoardControl[]; boardInput?: boolean };
export type BoardHud = {
  selection: { tokenId: string; name: string; lines: string[] } | null;
  turn: string;
  stats: string[];
  hint: string;
  notices: string[];
  error: string;
  pending: boolean;
  controls: BoardControl[];
  panel?: BoardPanel | null;
  drawing?: { kind: string; tone: string } | null;
  tiles?: number[];
  prompt: { title: string; label: string; numeric: boolean } | null;
};

// The sent projection is also the offer checked when the renderer replies.
export function nativeBoardHud(hud: BoardHud): BoardHud {
  const text = (value: string) => value.slice(0, 300);
  const lines = (values: string[]) => values.slice(0, 12).map(text);
  const control = (entry: BoardControl): BoardControl => ({
    id: entry.id, label: entry.label.slice(0, 80), disabled: entry.disabled === null ? null : text(entry.disabled),
    ...(entry.value !== undefined ? { value: entry.value.slice(0, 200) } : {}),
    ...(entry.options ? { options: entry.options.slice(0, 2048).map(option => ({ value: option.value.slice(0, 200), label: option.label.slice(0, 200), disabled: option.disabled === null ? null : text(option.disabled) })) } : {}),
    ...(entry.input ? { input: { ...entry.input, value: entry.input.value.slice(0, 200) } } : {}),
  });
  return {
    ...hud,
    selection: hud.selection ? { tokenId: hud.selection.tokenId, name: text(hud.selection.name), lines: lines(hud.selection.lines) } : null,
    turn: text(hud.turn), stats: lines(hud.stats), hint: text(hud.hint), error: text(hud.error), notices: lines(hud.notices),
    controls: hud.controls.slice(0, 20).map(control),
    panel: hud.panel ? { ...hud.panel, title: text(hud.panel.title), lines: hud.panel.lines.slice(0, 512).map(line => line.slice(0, 1000)), controls: hud.panel.controls.slice(0, 64).map(control) } : null,
    prompt: hud.prompt ? { ...hud.prompt, title: text(hud.prompt.title), label: text(hud.prompt.label) } : null,
  };
}

export function offeredBoardControl(hud: Pick<BoardHud, "controls" | "panel" | "pending">, id: BoardControlId, value?: string): BoardControl | null {
  const control = (hud.panel ? hud.panel.controls : hud.controls).find(entry => entry.id === id);
  if (!control || control.disabled !== null || hud.pending) return null;
  if (control.options && !control.options.some(option => option.value === value && option.disabled === null)) return null;
  if (control.input && (typeof value !== "string" || value.length > 200)) return null;
  return control;
}
export type HostMessage =
  | { odm: number; type: "battlefield-ui"; mapId: string; revision: number; hud: BoardHud }
  | { odm: number; type: "action-menu"; revision: number; menu: BoardActionMenu | null }
  | { odm: number; type: "rendering"; active: boolean }
  | { odm: number; type: "snapshot"; snapshot: BoardSnapshot; sessionLayout?: "stage" }
  | { odm: number; type: "scene"; genre: string | null; appearance: BoardSnapshot["appearance"]; options: BoardSnapshot["options"]; assetsUrl: string }
  | { odm: number; type: "ruler"; mapId: string; ruler: Ruler | null }
  | { odm: number; type: "fx"; events: BoardFx[] }
  | { odm: number; type: "ping"; x: number; y: number; focus: boolean; at: number }
  | { odm: number; type: "camera"; mode: "pull" | "lock" | "free"; x: number | null; y: number | null; zoom: number | null }
  | { odm: number; type: "camera-control"; action: CameraControl }
  | { odm: number; type: "file"; requestId: string; ok: true; name: string; mime: string; bytes: ArrayBuffer }
  | { odm: number; type: "file"; requestId: string; ok: false; name: string; error: string };

// A message as the page writes it, before the bridge version is added.
export type HostMessageBody = HostMessage extends infer T ? (T extends unknown ? Omit<T, "odm"> : never) : never;

// What the frame may send the page.
export type ViewMessage =
  | { type: "ready"; nativeOnly?: boolean; actions?: boolean; battlefieldUi?: boolean; battlefieldTools?: boolean }
  | { type: "board-control"; revision: number; mapId: string; actionId: BoardControlId; value?: string }
  | { type: "board-draw"; revision: number; mapId: string; points: BoardPoint[] }
  | { type: "action"; revision: number; tokenId: string; actionId: string }
  | { type: "cancel" }
  | ({ type: "camera-state" } & ViewCameraState)
  | { type: "tile"; x: number; y: number }
  | { type: "token"; tokenId: string; menu?: boolean }
  | { type: "hover"; x: number; y: number }
  | { type: "hover"; x: null; y: null }
  | { type: "file"; requestId: string; name: string }
  | { type: "face"; requestId: string; tokenId: string }
  // Where the view drew each figure, as fractions of its frame: the
  // figure's centre across, and its top and bottom.
  | { type: "anchors"; tokens: Record<string, Anchor> }
  | { type: "error"; message: string };

export type Anchor = [x: number, top: number, bottom: number];

// Where a view drew each figure, kept outside the page's state. A view
// reports anchors as its camera moves, as often as every frame, and only the
// plate and the action ring read them: they subscribe to their own figure
// (AddonBoardView.tsx useAnchor), so a camera sweep re-renders those two and
// not the board around them. An anchor that did not move keeps its identity,
// and a report that moved nothing tells nobody.
export type AnchorStore = {
  get: (tokenId: string) => Anchor | undefined;
  set: (tokens: Record<string, Anchor>) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createAnchorStore(): AnchorStore {
  let anchors: Record<string, Anchor> = {};
  const listeners = new Set<() => void>();
  return {
    get: (tokenId) => anchors[tokenId],
    set: (tokens) => {
      let moved = Object.keys(tokens).length !== Object.keys(anchors).length;
      const next: Record<string, Anchor> = {};
      for (const [id, anchor] of Object.entries(tokens)) {
        const before = anchors[id];
        if (before && before[0] === anchor[0] && before[1] === anchor[1] && before[2] === anchor[2]) {
          next[id] = before;
        } else {
          next[id] = anchor;
          moved = true;
        }
      }
      if (!moved) return;
      anchors = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const MAX_ANCHORS = 300;

function readAnchors(raw: unknown): Record<string, Anchor> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_ANCHORS) return null;
  const out: Record<string, Anchor> = {};
  const near = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 2;
  for (const [id, value] of entries) {
    if (!SHORT.test(id) || !Array.isArray(value) || value.length !== 3 || !value.every(near)) return null;
    const [x, top, bottom] = value as number[];
    out[id] = [x, Math.min(top, bottom), Math.max(top, bottom)];
  }
  return out;
}

const SHORT = /^[A-Za-z0-9_.:-]{1,120}$/;

// Reads a message from the frame, or null for anything that is not one of
// the shapes above. Coordinates are held to the board by the caller.
export function readViewMessage(raw: unknown): ViewMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const message = raw as Record<string, unknown>;
  if (message.odm !== BOARD_BRIDGE_VERSION) return null;
  const int = (value: unknown) => (typeof value === "number" && Number.isInteger(value) ? value : null);
  switch (message.type) {
    case "ready":
      if (message.battlefieldTools !== undefined && typeof message.battlefieldTools !== "boolean") return null;
      if (message.battlefieldUi !== undefined && typeof message.battlefieldUi !== "boolean") return null;
      if (message.nativeOnly !== undefined && typeof message.nativeOnly !== "boolean") return null;
      if (message.actions !== undefined && typeof message.actions !== "boolean") return null;
      return { type: "ready", ...(message.nativeOnly === undefined ? {} : { nativeOnly: message.nativeOnly }), ...(message.actions === undefined ? {} : { actions: message.actions }), ...(message.battlefieldUi === undefined ? {} : { battlefieldUi: message.battlefieldUi }), ...(message.battlefieldTools === undefined ? {} : { battlefieldTools: message.battlefieldTools }) };
    case "board-control":
      if (!Number.isSafeInteger(message.revision) || (message.revision as number) < 1
        || typeof message.mapId !== "string" || !SHORT.test(message.mapId)
        || !BOARD_CONTROL_IDS.includes(message.actionId as BoardControlId)
        || (BOARD_VALUE_CONTROLS.includes(message.actionId as typeof BOARD_VALUE_CONTROLS[number]) ? typeof message.value !== "string" || message.value.length > 200 : message.value !== undefined)) return null;
      return { type: "board-control", revision: message.revision as number, mapId: message.mapId, actionId: message.actionId as BoardControlId,
        ...(typeof message.value === "string" ? { value: message.value } : {}) };
    case "board-draw":
      if (!Number.isSafeInteger(message.revision) || (message.revision as number) < 1 || typeof message.mapId !== "string" || !SHORT.test(message.mapId)
        || !Array.isArray(message.points) || message.points.length < 2 || message.points.length > 64
        || !message.points.every(point => point && typeof point === "object" && [point.x, point.y].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 4096))) return null;
      return { type: "board-draw", revision: message.revision as number, mapId: message.mapId, points: message.points.map(point => ({ x: point.x, y: point.y })) };
    case "action":
      return Number.isSafeInteger(message.revision) && (message.revision as number) > 0
        && typeof message.tokenId === "string" && SHORT.test(message.tokenId)
        && typeof message.actionId === "string" && SHORT.test(message.actionId)
        ? { type: "action", revision: message.revision as number, tokenId: message.tokenId, actionId: message.actionId } : null;
    case "cancel":
      return { type: "cancel" };
    case "camera-state":
      return [message.x, message.y, message.zoom].every(value => typeof value === "number" && Number.isFinite(value)) && (message.zoom as number) >= 0.25 && (message.zoom as number) <= 8
        ? { type: "camera-state", x: message.x as number, y: message.y as number, zoom: message.zoom as number }
        : null;
    case "tile": {
      const x = int(message.x);
      const y = int(message.y);
      return x === null || y === null ? null : { type: "tile", x, y };
    }
    case "hover": {
      if (message.x === null || message.y === null) return { type: "hover", x: null, y: null };
      const x = int(message.x);
      const y = int(message.y);
      return x === null || y === null ? null : { type: "hover", x, y };
    }
    case "token":
      return typeof message.tokenId === "string" && SHORT.test(message.tokenId)
        && (message.menu === undefined || typeof message.menu === "boolean")
        ? { type: "token", tokenId: message.tokenId, ...(message.menu === undefined ? {} : { menu: message.menu }) } : null;
    case "file":
      return typeof message.requestId === "string" && SHORT.test(message.requestId) && typeof message.name === "string" && SHORT.test(message.name)
        ? { type: "file", requestId: message.requestId, name: message.name }
        : null;
    case "face":
      return typeof message.requestId === "string" && SHORT.test(message.requestId) && typeof message.tokenId === "string" && SHORT.test(message.tokenId)
        ? { type: "face", requestId: message.requestId, tokenId: message.tokenId }
        : null;
    case "anchors": {
      const tokens = readAnchors(message.tokens);
      return tokens ? { type: "anchors", tokens } : null;
    }
    case "error":
      return typeof message.message === "string" ? { type: "error", message: message.message.slice(0, 300) } : null;
    default:
      return null;
  }
}

// The stored file a "file" request names, or null: "backdrop" for the
// picture under the grid, else one of this addon's own view files.
export function fileForRequest(view: PlayerMapView, addonId: string, name: string): { path: string; type: string } | null {
  if (name === "backdrop") {
    return view.backdrop ? { path: view.backdrop.path, type: "" } : null;
  }
  if (!view.addonView || view.addonView.addonId !== addonId) return null;
  const file = view.addonView.files.find((entry) => entry.name === name);
  return file ? { path: file.path, type: file.type } : null;
}
