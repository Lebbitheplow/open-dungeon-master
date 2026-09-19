"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapPinned, Play, Square, Upload } from "lucide-react";
import { HotkeyOverlay } from "@/components/ui/HotkeyOverlay";
import { useMapSelection } from "@/app/campaigns/[campaignId]/useMapSelection";
import { removeObjects, setDmOnly, type MapObjects } from "@/lib/battlemap/objects";
import type { MapTheme } from "@/lib/battlemap/generate";
import { BRUSH_LABELS, type Brush as BrushName } from "@/lib/battlemap/paint";
import { resolveSkin, type MapSkin } from "@/lib/battlemap/skins";
import { TERRAIN, tileAt, type AmbientLight, type MapLight } from "@/lib/battlemap/types";
import type { Backdrop, BackdropTransform } from "@/lib/battlemap/backdrop";
import { TerrainCanvas, type CanvasControls } from "@/app/campaigns/[campaignId]/TerrainCanvas";
import type { HiddenLayers, MapLayer } from "@/app/campaigns/[campaignId]/terrainDraw";
import { BackdropControls } from "@/app/campaigns/[campaignId]/MapTools";
import { OverlayControls } from "@/app/campaigns/[campaignId]/MapSceneTools";
import { MapEditorShell } from "@/app/campaigns/[campaignId]/MapEditorShell";
import { MapOptions } from "@/app/campaigns/[campaignId]/MapOptions";
import { MapLayersPanel } from "@/app/campaigns/[campaignId]/MapLayersPanel";
import { MapTilesetPanel } from "@/app/campaigns/[campaignId]/MapTilesetPanel";
import { MapInspector, MapStatusLine, createHoverStore } from "@/app/campaigns/[campaignId]/MapInspector";
import { useMapToasts } from "@/app/campaigns/[campaignId]/MapToasts";
import { FinePrint, mapButton, skinSwatches } from "@/app/campaigns/[campaignId]/mapUi";
import { useCatalogue, usePaintedGround, usePaintedPreference } from "@/app/campaigns/[campaignId]/useMapPaint";
import {
  BOARD_CAPS,
  DEFAULT_MAP_TOOLS,
  MODES,
  canvasToolFor,
  isPaintMode,
  mapHotkeyGroups,
  useMapHotkeys,
  type MapTools,
} from "@/app/campaigns/[campaignId]/MapToolbox";
import type { DoorStates, LightZone, MapLabel } from "@/lib/battlemap/scene";
import { usePainter } from "@/app/campaigns/[campaignId]/usePainter";
import { MapForge } from "@/app/workshop/maps/MapForge";
import type { ForgeMap } from "@/app/workshop/maps/ForgePreview";
import type { ForgeRoll } from "@/app/workshop/maps/forge";

// The map studio: build a tactical map on purpose, look at it privately,
// then put it on the table.
//
// Two halves since the visual overhaul. The forge on top rolls a preview that
// exists only in this response: nobody else sees it until it is applied. The
// editor under it is the live board, in the same rail, canvas and layers shape
// the workshop's editor has, holding what the live board can hold
// (BOARD_CAPS: no props, which are tokens there, and no placed lights). The
// server validates every stroke (src/lib/battlemap/paint.ts), so a wall
// through a combatant comes back as a sentence rather than a broken field.

// The characters a terrain string is written in, back to the brush that
// paints them, for the eyedropper.
const CHAR_TO_BRUSH = Object.fromEntries(
  Object.entries(TERRAIN).map(([brush, char]) => [char, brush]),
) as Record<string, BrushName>;

const EMPTY_SKIN: MapSkin = { id: "", bind: {} };
const LAYERS: MapLayer[] = ["labels", "lights", "zones", "doors", "terrain", "backdrop", "overlay"];

type StudioMap = {
  seed: number;
  width: number;
  height: number;
  theme: MapTheme;
  ambient: AmbientLight;
  terrain: string;
  backdrop?: Backdrop | null;
  lights?: MapLight[];
  doors?: DoorStates;
  labels?: MapLabel[];
  zones?: LightZone[];
  overlayPath?: string;
  skin?: MapSkin;
};

type StudioState = {
  board: "fight" | "scene" | null;
  enemyCount: number;
  genre?: string;
  map: StudioMap | null;
};

function settingsBody(roll: ForgeRoll | null): Record<string, unknown> {
  if (!roll) {
    return {};
  }
  const hint = roll.hint.trim();
  return {
    seed: roll.seed,
    width: roll.width,
    height: roll.height,
    ...(roll.theme ? { theme: roll.theme } : {}),
    ...(roll.ambient ? { ambient: roll.ambient } : {}),
    ...(hint ? { hint } : {}),
  };
}

export function DmMapStudioPanel({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<StudioState>({ board: null, enemyCount: 0, map: null });
  const [tools, setTools] = useState<MapTools>(DEFAULT_MAP_TOOLS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { toasts, push } = useMapToasts();
  const forgeRef = useRef<HTMLDivElement>(null);

  // The state lands in a .then callback rather than after an await, so the
  // refetch reads as "subscribe to an external system" to React and to the
  // effect linter, which is what it is.
  const load = useCallback(
    () =>
      fetch(`/api/campaigns/${campaignId}/dm/map-studio`)
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: StudioState | null) => {
          if (payload) {
            setState(payload);
          }
        })
        .catch(() => {
          // transient; the next action reloads
        }),
    [campaignId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/map-studio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "That did not work.");
        return null;
      }
      return payload as Record<string, unknown>;
    } finally {
      setBusy(false);
    }
  }

  // A roll is private: the server generates it for the table as it stands
  // (how many are in the party, how many foes) and writes nothing.
  async function preview(roll: ForgeRoll): Promise<ForgeMap | null> {
    const payload = await post({ do: "preview", ...settingsBody(roll) });
    if (!payload) {
      return null;
    }
    setTools((current) => ({ ...current, mode: "" }));
    return (payload as unknown as { map: ForgeMap }).map;
  }

  async function apply(roll: ForgeRoll | null, clear: () => void) {
    const payload = await post({ do: "apply", ...settingsBody(roll) });
    if (payload) {
      clear();
      await load();
    }
  }

  async function scene(open: boolean, roll: ForgeRoll | null, clear: () => void) {
    const payload = await post({ do: open ? "open-scene" : "close-scene", ...(open ? settingsBody(roll) : {}) });
    if (payload) {
      clear();
      await load();
    }
  }

  // One request shape for a stroke and for a stamp: the server compiles the
  // shape and both go through the same painter (src/lib/battlemap/paint.ts).
  // A refusal is the server's own sentence, shown over the canvas.
  const mark = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/map-studio/paint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        push((payload as { error?: string }).error ?? "That was refused.");
        return false;
      }
      await load();
      return true;
    },
    [campaignId, load, push],
  );

  const board = state.map;
  const painter = usePainter({
    key: board ? `${board.seed}:${board.width}x${board.height}` : "",
    terrain: board?.terrain ?? "",
    send: mark,
  });
  const undo = {
    canUndo: painter.canUndo,
    canRedo: painter.canRedo,
    onUndo: () => void painter.undo(),
    onRedo: () => void painter.redo(),
  };
  const [keysOpen, setKeysOpen] = useState(false);
  const [grid, setGrid] = useState(true);
  const [dmView, setDmView] = useState(true);
  const [hidden, setHidden] = useState<HiddenLayers>({});
  const [zoom, setZoom] = useState(1);
  const controls = useRef<CanvasControls>(null);
  const [hoverStore] = useState(createHoverStore);
  // The selection model over the live board's scene layer (labels, light
  // zones, door states). Lights are left out of it, as they always were: a
  // tap on a lit tile must still find the zone under it.
  const objects = useMemo<MapObjects>(
    () => ({
      labels: board?.labels ?? [],
      props: [],
      lights: [],
      doors: board?.doors ?? {},
      zones: board?.zones ?? [],
      drawings: [],
    }),
    [board],
  );
  // The layers panel lists the lights too, to be read and hidden, not edited.
  const listed = useMemo<MapObjects>(() => ({ ...objects, lights: board?.lights ?? [] }), [objects, board]);
  const selection = useMapSelection({
    objects,
    width: board?.width ?? 1,
    height: board?.height ?? 1,
    save: (patch) => mark(patch as Record<string, unknown>),
    kinds: ["labels", "zones", "doors"],
  });
  const openKeys = useCallback(() => setKeysOpen(true), []);
  useMapHotkeys({
    enabled: Boolean(board),
    tools,
    onTools: setTools,
    caps: BOARD_CAPS,
    undo,
    onHelp: openKeys,
    onDelete: tools.mode === "select" ? selection.remove : undefined,
  });

  const skin = board?.skin ?? EMPTY_SKIN;
  const catalogue = useCatalogue();
  const [painted, setPainted] = usePaintedPreference();
  const categories = useMemo(
    () => (catalogue ? new Map(catalogue.tiles.map((tile) => [tile.id, tile.category ?? ""])) : null),
    [catalogue],
  );
  const resolved = useMemo(() => resolveSkin(state.genre, board?.theme, skin, categories), [state.genre, board?.theme, skin, categories]);
  const swatches = useMemo(() => (painted ? skinSwatches(resolved, catalogue) : {}), [painted, resolved, catalogue]);
  const ground = usePaintedGround(
    board
      ? {
          width: board.width,
          height: board.height,
          terrain: board.terrain,
          theme: board.theme,
          genre: state.genre,
          seedKey: `${board.seed}:${board.width}x${board.height}`,
          skin,
        }
      : null,
  );
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const char of board?.terrain ?? "") {
      out[char] = (out[char] ?? 0) + 1;
    }
    return out;
  }, [board?.terrain]);

  // A tap on a labelled tile takes the label away; anywhere else puts the
  // dial's text there.
  function label(x: number, y: number) {
    const labels = board?.labels ?? [];
    const existing = labels.find((entry) => entry.x === x && entry.y === y);
    const rest = labels.filter((entry) => !(entry.x === x && entry.y === y));
    if (existing) {
      void mark({ labels: rest });
      return;
    }
    if (tools.label.text.trim()) {
      void mark({ labels: [...rest, { x, y, text: tools.label.text.trim(), dmOnly: tools.label.dmOnly }] });
    }
  }

  async function setBackdrop(next: { path: string; transform: BackdropTransform }) {
    const payload = await post({ do: "backdrop", backdropPath: next.path, backdropTransform: next.transform });
    if (payload) {
      await load();
    }
  }

  const held = MODES.find((entry) => entry.mode === tools.mode);
  const holding = held ? (isPaintMode(tools.mode) ? `${held.label} · ${BRUSH_LABELS[tools.brush]}` : held.label) : "Nothing";
  const backdropPanel = <BackdropControls backdrop={board?.backdrop ?? null} onChange={(next) => void setBackdrop(next)} busy={busy} />;

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
          <MapPinned className="size-3.5" />
          The board
        </p>
        <p className="text-xs text-stone-400">
          {state.board === "fight"
            ? `A fight is on the table, with ${state.enemyCount} ${state.enemyCount === 1 ? "enemy" : "enemies"}.`
            : state.board === "scene"
              ? "An exploration scene is on the table. The party can walk it freely."
              : "Nothing is on the table. Open a scene to put the party on a map without a fight."}
        </p>
      </section>

      <div ref={forgeRef}>
        <MapForge
          surface="studio"
          genre={state.genre}
          busy={busy}
          size={board ? { width: board.width, height: board.height } : undefined}
          generate={preview}
          actions={(roll, clear) => (
            <div className="space-y-1.5 text-[12px]">
              <div className="flex flex-wrap gap-1.5">
                {roll ? (
                  <>
                    <button
                      type="button"
                      disabled={busy || !state.board}
                      title={state.board ? "Replace the board's ground with this map" : "Nothing is on the table yet"}
                      onClick={() => void apply(roll, clear)}
                      className="flex min-h-9 items-center gap-1.5 rounded-lg border border-amber-500/60 bg-amber-400/10 px-3 text-amber-100 disabled:opacity-40 motion-press"
                    >
                      <Upload className="size-3.5" /> Put it on the table
                    </button>
                    <button
                      type="button"
                      disabled={busy || state.board !== null}
                      title={state.board ? "Something is already on the table" : "Put the party on this map with nobody to fight"}
                      onClick={() => void scene(true, roll, clear)}
                      className={mapButton}
                    >
                      <Play className="size-3" /> Open it as a scene
                    </button>
                  </>
                ) : null}
                {state.board === "scene" ? (
                  <button type="button" disabled={busy} onClick={() => void scene(false, null, clear)} className={mapButton}>
                    <Square className="size-3" /> Close the scene
                  </button>
                ) : null}
              </div>
              {roll ? <FinePrint>Seed {roll.seed}. Nobody else can see this yet.</FinePrint> : null}
            </div>
          )}
        />
      </div>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      {board ? (
        <div className="h-[min(86dvh,48rem)]">
          <MapEditorShell
            title={
              <h3 className="min-w-0 truncate font-display text-[15px] uppercase tracking-[0.08em] text-amber-100">
                {state.board === "scene" ? "The scene on the table" : "The board on the table"}
              </h3>
            }
            undo={undo}
            grid={grid}
            onGrid={setGrid}
            dmView={dmView}
            onDmView={setDmView}
            zoom={zoom}
            controls={controls}
            tools={tools}
            onTools={setTools}
            caps={BOARD_CAPS}
            onHelp={openKeys}
            toasts={toasts}
            options={
              <MapOptions
                tools={tools}
                onTools={setTools}
                caps={BOARD_CAPS}
                counts={{ labels: board.labels?.length ?? 0, zones: board.zones?.length ?? 0 }}
                onClearLabels={() => void mark({ labels: [] })}
                onClearZones={() => void mark({ zones: [] })}
                swatches={swatches}
                backdropPanel={backdropPanel}
                rollPanel={
                  <div className="space-y-2">
                    <FinePrint>
                      The forge above rolls a new board where nobody else can see it. Put it on the table when you like it;
                      everyone is stood somewhere legal on the new ground.
                    </FinePrint>
                    <button type="button" className={mapButton} onClick={() => forgeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                      Go to the forge
                    </button>
                  </div>
                }
              />
            }
            canvas={
              <TerrainCanvas
                terrain={board.terrain}
                width={board.width}
                height={board.height}
                backdrop={board.backdrop}
                lights={board.lights}
                labels={board.labels}
                doors={board.doors}
                zones={board.zones}
                overlayPath={board.overlayPath}
                tool={canvasToolFor(tools, BOARD_CAPS)}
                zoomable
                contain
                guard
                ground={ground}
                hidden={hidden}
                showGrid={grid}
                dmView={dmView}
                controls={controls}
                onZoom={setZoom}
                onHover={hoverStore.set}
                onStroke={(x, y) => painter.stroke(x, y, tools.brush, tools.radius)}
                onStrokeEnd={painter.strokeEnd}
                onLabel={label}
                onDoor={(x, y) => void mark({ door: { x, y } })}
                onZone={(from, to) =>
                  void mark({
                    zones: [
                      ...(board.zones ?? []),
                      { x0: from.x, y0: from.y, x1: to.x, y1: to.y, ambient: tools.zone, kind: tools.zoneKind },
                    ],
                  })
                }
                onShape={(from, to) => void painter.shape(tools.mode, tools.brush, from, to)}
                onStamp={(x, y) => void painter.edit({ stamp: { kind: tools.stamp, x, y, ...tools.stampSize } })}
                onPick={(x, y) => {
                  const brush = CHAR_TO_BRUSH[tileAt(board.terrain, board.width, x, y)];
                  if (brush) {
                    setTools({ ...tools, brush, mode: "brush" });
                  }
                }}
                onSelect={selection.onSelect}
                selected={tools.mode === "select" ? selection.boxes : undefined}
                refused={toasts.filter((toast) => toast.tone === "refused").at(-1)?.id}
                onBackdrop={(transform) => void setBackdrop({ path: board.backdrop?.path ?? "", transform })}
              />
            }
            status={
              <MapStatusLine
                store={hoverStore}
                terrain={board.terrain}
                width={board.width}
                height={board.height}
                holding={holding}
                extra={
                  board.seed ? (
                    <span className="flex shrink-0 items-baseline gap-1.5">
                      <span className="font-display text-[8px] uppercase tracking-[0.16em] text-stone-600">Seed</span>
                      <span className="font-mono text-[10px] text-stone-300">{board.seed}</span>
                    </span>
                  ) : null
                }
              />
            }
            side={
              <>
                <MapLayersPanel
                  objects={listed}
                  refs={selection.refs}
                  hidden={hidden}
                  onHidden={setHidden}
                  layers={LAYERS}
                  editable={["labels", "zones", "doors"]}
                  counts={{ terrain: board.terrain.length, backdrop: board.backdrop ? 1 : 0, overlay: board.overlayPath ? 1 : 0 }}
                  onSelect={(refs) => {
                    selection.setRefs(refs);
                    setTools({ ...tools, mode: "select" });
                  }}
                  onDelete={(refs) => void mark(removeObjects(objects, refs) as unknown as Record<string, unknown>)}
                  onDmOnly={(refs, dmOnly) => void mark({ labels: setDmOnly(objects, refs, dmOnly).labels })}
                  extras={{
                    backdrop: backdropPanel,
                    overlay: (
                      <OverlayControls overlayPath={board.overlayPath ?? ""} busy={busy} onChange={(overlayPath) => void mark({ overlayPath })} />
                    ),
                  }}
                />
                <MapTilesetPanel
                  skin={skin}
                  resolved={resolved}
                  genre={state.genre}
                  theme={board.theme}
                  catalogue={catalogue}
                  counts={counts}
                  painted={painted}
                  onPainted={setPainted}
                />
                <MapInspector
                  store={hoverStore}
                  terrain={board.terrain}
                  width={board.width}
                  height={board.height}
                  objects={objects}
                  refs={tools.mode === "select" ? selection.refs : []}
                  selectionTitle={selection.title}
                  selectionBar={selection.bar}
                />
              </>
            }
          />
        </div>
      ) : null}
      {selection.dialog}
      <HotkeyOverlay open={keysOpen} onOpenChange={setKeysOpen} groups={mapHotkeyGroups(BOARD_CAPS)} />
    </div>
  );
}
