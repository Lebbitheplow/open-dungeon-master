"use client";

import { useCallback, useEffect, useState } from "react";
import { Dices, Loader2, MapPinned, Play, Square } from "lucide-react";
import { MAP_SIZE, MAP_THEMES, type MapTheme } from "@/lib/battlemap/generate";
import type { Brush as BrushName } from "@/lib/battlemap/paint";
import { TERRAIN, tileAt, type AmbientLight, type MapLight } from "@/lib/battlemap/types";
import type { Backdrop, BackdropTransform } from "@/lib/battlemap/backdrop";
import { TerrainCanvas } from "@/app/campaigns/[campaignId]/TerrainCanvas";
import { BackdropControls } from "@/app/campaigns/[campaignId]/MapTools";
import { OverlayControls } from "@/app/campaigns/[campaignId]/MapSceneTools";
import {
  BOARD_CAPS,
  DEFAULT_MAP_TOOLS,
  MapToolbox,
  canvasToolFor,
  useMapHotkeys,
  type MapTools,
} from "@/app/campaigns/[campaignId]/MapToolbox";
import type { DoorStates, LightZone, MapLabel } from "@/lib/battlemap/scene";
import { usePainter } from "@/app/campaigns/[campaignId]/usePainter";

// The map studio: build a tactical map on purpose, look at it privately,
// then put it on the table.
//
// The canvas below is both the preview and the drawing surface. While a
// preview is up it shows a map that exists only in this response; once it is
// applied (or when there is no preview) it shows the live board, and a
// selected brush paints on it. The server validates every stroke
// (src/lib/battlemap/paint.ts), so a wall through a combatant comes back as
// a sentence rather than a broken field.

const AMBIENTS: AmbientLight[] = ["bright", "dim", "dark"];

// The characters a terrain string is written in, back to the brush that
// paints them, for the eyedropper.
const CHAR_TO_BRUSH = Object.fromEntries(
  Object.entries(TERRAIN).map(([brush, char]) => [char, brush]),
) as Record<string, BrushName>;

const THEME_LABELS: Record<MapTheme, string> = {
  cave: "Cave",
  forest: "Forest",
  swamp: "Swamp",
  riverside: "Water",
  interior: "Indoors",
  field: "Open ground",
};

type StudioMap = {
  seed: number;
  width: number;
  height: number;
  theme: MapTheme;
  ambient: AmbientLight;
  terrain: string;
  // Absent on a preview, which is a map that does not exist yet and so has
  // no picture stored under it, no lights the DM placed and no scene layer.
  backdrop?: Backdrop | null;
  lights?: MapLight[];
  doors?: DoorStates;
  labels?: MapLabel[];
  zones?: LightZone[];
  overlayPath?: string;
};

type StudioState = {
  board: "fight" | "scene" | null;
  enemyCount: number;
  map: StudioMap | null;
};

type Settings = {
  seed: number | null;
  width: number;
  height: number;
  theme: MapTheme | "";
  ambient: AmbientLight | "";
  hint: string;
};

const START: Settings = { seed: null, width: 20, height: 15, theme: "", ambient: "", hint: "" };

export function DmMapStudioPanel({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<StudioState>({ board: null, enemyCount: 0, map: null });
  const [settings, setSettings] = useState<Settings>(START);
  const [preview, setPreview] = useState<{ seed: number; map: StudioMap } | null>(null);
  const [tools, setTools] = useState<MapTools>(DEFAULT_MAP_TOOLS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The state lands in a .then callback rather than after an await, so the
  // refetch reads as "subscribe to an external system" to React and to the
  // effect linter, which is what it is.
  const load = useCallback(
    () =>
      fetch(`/api/campaigns/${campaignId}/dm/map-studio`)
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: StudioState | null) => {
          if (!payload) {
            return;
          }
          setState(payload);
          const board = payload.map;
          if (board) {
            setSettings((current) => ({ ...current, width: board.width, height: board.height }));
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

  const body = (extra: Record<string, unknown>) => ({
    ...(settings.seed === null ? {} : { seed: settings.seed }),
    width: settings.width,
    height: settings.height,
    ...(settings.theme ? { theme: settings.theme } : {}),
    ...(settings.ambient ? { ambient: settings.ambient } : {}),
    ...(settings.hint.trim() ? { hint: settings.hint.trim() } : {}),
    ...extra,
  });

  async function post(extra: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/map-studio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body(extra)),
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

  async function rollPreview(fresh: boolean) {
    const seed = fresh ? (Math.floor(Math.random() * 0xffffffff) >>> 0) : settings.seed;
    if (fresh) {
      setSettings((current) => ({ ...current, seed }));
    }
    const payload = await post({ do: "preview", ...(seed === null ? {} : { seed }) });
    if (payload) {
      setPreview(payload as unknown as { seed: number; map: StudioMap });
      setTools((current) => ({ ...current, mode: "" }));
    }
  }

  async function apply() {
    const payload = await post({ do: "apply", ...(preview ? { seed: preview.seed } : {}) });
    if (payload) {
      setPreview(null);
      await load();
    }
  }

  async function scene(open: boolean) {
    const payload = await post({
      do: open ? "open-scene" : "close-scene",
      ...(open && preview ? { seed: preview.seed } : {}),
    });
    if (payload) {
      setPreview(null);
      await load();
    }
  }

  // One request shape for a stroke and for a stamp: the server compiles the
  // shape and both go through the same painter (src/lib/battlemap/paint.ts).
  const mark = useCallback(
    async (body: Record<string, unknown>) => {
      setError("");
      const response = await fetch(`/api/campaigns/${campaignId}/dm/map-studio/paint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError((payload as { error?: string }).error ?? "That was refused.");
        return false;
      }
      await load();
      return true;
    },
    [campaignId, load],
  );

  const shown = preview?.map ?? state.map;
  const editable = !preview && Boolean(state.map);
  const painter = usePainter({
    key: state.map ? `${state.map.seed}:${state.map.width}x${state.map.height}` : "",
    terrain: state.map?.terrain ?? "",
    send: mark,
  });
  const undo = {
    canUndo: painter.canUndo,
    canRedo: painter.canRedo,
    onUndo: () => void painter.undo(),
    onRedo: () => void painter.redo(),
  };
  useMapHotkeys({ enabled: editable, tools, onTools: setTools, caps: BOARD_CAPS, undo });

  // A tap on a labelled tile takes the label away; anywhere else puts the
  // dial's text there.
  function label(x: number, y: number) {
    const labels = state.map?.labels ?? [];
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
    const payload = await post({
      do: "backdrop",
      backdropPath: next.path,
      backdropTransform: next.transform,
    });
    if (payload) {
      await load();
    }
  }

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

      <section className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-stone-500">The place</span>
          <input
            value={settings.hint}
            onChange={(event) => setSettings({ ...settings, hint: event.target.value })}
            placeholder="a flooded crypt, torchlit"
            className="mt-0.5 w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
          />
          <span className="text-[10px] text-stone-600">
            The generator reads this for terrain and light. The two pickers below overrule it.
          </span>
        </label>

        <div className="flex flex-wrap gap-1.5">
          <select
            value={settings.theme}
            onChange={(event) =>
              setSettings({ ...settings, theme: event.target.value as MapTheme | "" })
            }
            className="rounded-md border border-stone-700 bg-stone-950 px-1.5 py-1 text-xs text-stone-300"
          >
            <option value="">Terrain from the words</option>
            {MAP_THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {THEME_LABELS[theme]}
              </option>
            ))}
          </select>
          <select
            value={settings.ambient}
            onChange={(event) =>
              setSettings({ ...settings, ambient: event.target.value as AmbientLight | "" })
            }
            className="rounded-md border border-stone-700 bg-stone-950 px-1.5 py-1 text-xs text-stone-300"
          >
            <option value="">Light from the words</option>
            {AMBIENTS.map((ambient) => (
              <option key={ambient} value={ambient}>
                {ambient === "bright" ? "Daylight" : ambient === "dim" ? "Dim" : "Dark"}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-[11px] text-stone-500">
            Size
            <input
              type="number"
              min={MAP_SIZE.minWidth}
              max={MAP_SIZE.maxWidth}
              value={settings.width}
              onChange={(event) =>
                setSettings({ ...settings, width: Number(event.target.value) || settings.width })
              }
              className="w-12 rounded-md border border-stone-700 bg-stone-950 px-1 py-1 text-xs text-stone-300"
            />
            x
            <input
              type="number"
              min={MAP_SIZE.minHeight}
              max={MAP_SIZE.maxHeight}
              value={settings.height}
              onChange={(event) =>
                setSettings({ ...settings, height: Number(event.target.value) || settings.height })
              }
              className="w-12 rounded-md border border-stone-700 bg-stone-950 px-1 py-1 text-xs text-stone-300"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void rollPreview(true)}
            className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Dices className="size-3" />}
            {preview ? "Roll another" : "Roll a map"}
          </button>
          {preview ? (
            <>
              <button
                type="button"
                disabled={busy || !state.board}
                title={
                  state.board
                    ? "Replace the board's ground with this map"
                    : "Nothing is on the table yet"
                }
                onClick={() => void apply()}
                className="rounded-md border border-amber-700 bg-amber-950/50 px-2 py-1 text-xs text-amber-100 disabled:opacity-40"
              >
                Put it on the table
              </button>
              <button
                type="button"
                disabled={busy || state.board !== null}
                title={
                  state.board
                    ? "Something is already on the table"
                    : "Put the party on this map with nobody to fight"
                }
                onClick={() => void scene(true)}
                className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40"
              >
                <Play className="size-3" /> Open it as a scene
              </button>
            </>
          ) : null}
          {state.board === "scene" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void scene(false)}
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:bg-stone-900 disabled:opacity-50"
            >
              <Square className="size-3" /> Close the scene
            </button>
          ) : null}
        </div>
        {preview ? (
          <p className="text-[10px] text-stone-600">
            Seed {preview.seed}. Nobody else can see this yet.
          </p>
        ) : null}
      </section>

      {shown ? (
        <section className="space-y-2">
          <TerrainCanvas
            terrain={shown.terrain}
            width={shown.width}
            height={shown.height}
            backdrop={preview ? null : shown.backdrop}
            lights={preview ? undefined : shown.lights}
            labels={preview ? undefined : shown.labels}
            doors={preview ? undefined : shown.doors}
            zones={preview ? undefined : shown.zones}
            overlayPath={preview ? undefined : shown.overlayPath}
            tool={editable ? canvasToolFor(tools, BOARD_CAPS) : null}
            zoomable
            onStroke={(x, y) => painter.stroke(x, y, tools.brush, tools.radius)}
            onStrokeEnd={painter.strokeEnd}
            onLabel={label}
            onDoor={(x, y) => void mark({ door: { x, y } })}
            onZone={(from, to) =>
              void mark({
                zones: [...(state.map?.zones ?? []), { x0: from.x, y0: from.y, x1: to.x, y1: to.y, ambient: tools.zone }],
              })
            }
            onShape={(from, to) => void painter.shape(tools.mode, tools.brush, from, to)}
            onStamp={(x, y) => void painter.edit({ stamp: { kind: tools.stamp, x, y, ...tools.stampSize } })}
            onPick={(x, y) => {
              const brush = CHAR_TO_BRUSH[tileAt(shown.terrain, shown.width, x, y)];
              if (brush) {
                setTools({ ...tools, brush, mode: "brush" });
              }
            }}
          />
          {editable ? (
            <div className="space-y-2.5">
              <MapToolbox
                tools={tools}
                onTools={setTools}
                caps={BOARD_CAPS}
                counts={{ labels: shown.labels?.length ?? 0, zones: shown.zones?.length ?? 0 }}
                onClearLabels={() => void mark({ labels: [] })}
                onClearZones={() => void mark({ zones: [] })}
                undo={undo}
              />
              <OverlayControls
                overlayPath={shown.overlayPath ?? ""}
                busy={busy}
                onChange={(overlayPath) => void mark({ overlayPath })}
              />
              <BackdropControls
                backdrop={shown.backdrop ?? null}
                onChange={(next) => void setBackdrop(next)}
                busy={busy}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </div>
  );
}
