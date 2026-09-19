"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Copy, MoreVertical, Play, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { MAP_THEMES } from "@/lib/battlemap/generate";
import { removeObjects, setDmOnly, type MapObjects } from "@/lib/battlemap/objects";
import { resolveSkin, type MapSkin } from "@/lib/battlemap/skins";
import { HotkeyOverlay } from "@/components/ui/HotkeyOverlay";
import { Select } from "@/components/ui/Select";
import { SAVE_LABEL, type SaveState } from "@/lib/use-autosave";
import { useMapSelection } from "@/app/campaigns/[campaignId]/useMapSelection";
import { BRUSH_LABELS, type Brush as BrushName } from "@/lib/battlemap/paint";
import { TERRAIN, tileAt } from "@/lib/battlemap/types";
import { collectTags } from "@/lib/workshop/pickers";
import { MapDetailsPanel, MapNameField, useMapWords } from "@/app/workshop/maps/MapDetails";
import { MapRollPanel } from "@/app/workshop/maps/MapRollPanel";
import { TerrainCanvas, type CanvasControls } from "@/app/campaigns/[campaignId]/TerrainCanvas";
import type { HiddenLayers, MapLayer } from "@/app/campaigns/[campaignId]/terrainDraw";
import { BackdropControls } from "@/app/campaigns/[campaignId]/MapTools";
import { AmbienceControls, OverlayControls } from "@/app/campaigns/[campaignId]/MapSceneTools";
import { MapEditorShell } from "@/app/campaigns/[campaignId]/MapEditorShell";
import { MapOptions } from "@/app/campaigns/[campaignId]/MapOptions";
import { MapLayersPanel } from "@/app/campaigns/[campaignId]/MapLayersPanel";
import { MapTilesetPanel } from "@/app/campaigns/[campaignId]/MapTilesetPanel";
import { MapInspector, MapStatusLine, createHoverStore } from "@/app/campaigns/[campaignId]/MapInspector";
import type { MapToast } from "@/app/campaigns/[campaignId]/MapToasts";
import { skinSwatches } from "@/app/campaigns/[campaignId]/mapUi";
import { useCatalogue, usePaintedGround, usePaintedPreference } from "@/app/campaigns/[campaignId]/useMapPaint";
import {
  LIBRARY_CAPS,
  MODES,
  canvasToolFor,
  isPaintMode,
  mapHotkeyGroups,
  useMapHotkeys,
  type MapTools,
} from "@/app/campaigns/[campaignId]/MapToolbox";
import { usePainter } from "@/app/campaigns/[campaignId]/usePainter";
import { THEME_LABELS, type LibraryState, type PreparedMap } from "@/app/workshop/maps/types";

// One prepared map, open for editing, in the editor's shape (docs/visual-
// overhaul-plan.md 4.2): the name and the big actions along the top, the tool
// rail and the held tool's options on the left, the canvas in the middle with
// the renderer's picture under the editing overlays, and layers, tileset,
// inspector and details on the right. Mounted keyed by map id by its caller.
//
// The tool state stays with the caller on purpose: a DM who picks the water
// brush and then clicks through three maps expects to still be holding the
// water brush. The undo history is this map's own and starts fresh per map.

export type { MapTools } from "@/app/campaigns/[campaignId]/MapToolbox";

const CHAR_TO_BRUSH = Object.fromEntries(
  Object.entries(TERRAIN).map(([brush, char]) => [char, brush]),
) as Record<string, BrushName>;

const EMPTY_SKIN: MapSkin = { id: "", bind: {} };
const LAYERS: MapLayer[] = ["labels", "props", "lights", "zones", "doors", "terrain", "backdrop", "overlay", "drawings"];

function SaveDot({ state }: { state: SaveState }) {
  const tone = state === "error" ? "bg-red-400 text-red-300" : state === "saving" || state === "dirty" ? "bg-amber-400 text-stone-400" : "bg-emerald-400 text-emerald-300";
  const [dot, text] = tone.split(" ");
  return (
    <span aria-live="polite" className={cn("flex shrink-0 items-center gap-1.5 font-mono text-[10px]", text)}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", dot, state === "saving" && "map-save-pulse")} />
      {state === "idle" ? "saved" : SAVE_LABEL[state].toLowerCase()}
    </span>
  );
}

export function MapEditor({
  selected,
  state,
  busy,
  tools,
  onTools,
  patch,
  act,
  duplicate,
  remove,
  npcNames,
  toasts,
  inSheet = false,
}: {
  selected: PreparedMap;
  state: LibraryState;
  busy: boolean;
  tools: MapTools;
  onTools: (next: MapTools) => void;
  // Resolves true when the server took the edit.
  patch: (body: Record<string, unknown>) => Promise<boolean>;
  act: (action: "deploy" | "open-scene") => Promise<void>;
  duplicate: () => Promise<void>;
  remove: () => Promise<void>;
  // The cast, for the bystander token's name dropdown.
  npcNames?: readonly string[];
  // Refusals and confirmations, raised by the caller that made the request.
  toasts: MapToast[];
  // True inside the workshop's sheet, whose close button needs the corner.
  inSheet?: boolean;
}) {
  const canDeploy = state.board !== null;
  // Tags already used on the other maps, offered beside the tag field.
  const knownTags = collectTags(state.maps.filter((map) => map.id !== selected.id));
  const words = useMapWords(selected, patch);
  const painter = usePainter({ key: selected.id, terrain: selected.terrain, send: patch });
  const [back, setBack] = useState(0);
  const undo = {
    canUndo: painter.canUndo,
    canRedo: painter.canRedo,
    onUndo: () => {
      setBack((n) => Math.max(0, n - 1));
      void painter.undo();
    },
    onRedo: () => {
      setBack((n) => n + 1);
      void painter.redo();
    },
  };
  const [keysOpen, setKeysOpen] = useState(false);
  const [grid, setGrid] = useState(true);
  const [dmView, setDmView] = useState(true);
  const [hidden, setHidden] = useState<HiddenLayers>({});
  const [zoom, setZoom] = useState(1);
  const controls = useRef<CanvasControls>(null);
  const [hoverStore] = useState(createHoverStore);

  const skin = selected.skin ?? EMPTY_SKIN;
  const catalogue = useCatalogue();
  const [painted, setPainted] = usePaintedPreference();
  const categories = useMemo(
    () => (catalogue ? new Map(catalogue.tiles.map((tile) => [tile.id, tile.category ?? ""])) : null),
    [catalogue],
  );
  const resolved = useMemo(() => resolveSkin(state.genre, selected.theme, skin, categories), [state.genre, selected.theme, skin, categories]);
  const swatches = useMemo(() => (painted ? skinSwatches(resolved, catalogue) : {}), [painted, resolved, catalogue]);
  const ground = usePaintedGround({
    width: selected.width,
    height: selected.height,
    terrain: selected.terrain,
    theme: selected.theme,
    genre: state.genre,
    seedKey: selected.id,
    skin,
    props: hidden.props ? [] : selected.props,
  });

  const objects = useMemo<MapObjects>(
    () => ({
      labels: selected.labels,
      props: selected.props,
      lights: selected.lights,
      doors: selected.doors,
      zones: selected.zones,
      drawings: selected.drawings ?? [],
    }),
    [selected],
  );
  const selection = useMapSelection({
    objects,
    width: selected.width,
    height: selected.height,
    save: (next) => patch(next as Record<string, unknown>),
    kinds: ["labels", "props", "lights", "doors", "zones"],
  });
  const openKeys = useCallback(() => setKeysOpen(true), []);
  useMapHotkeys({
    enabled: true,
    tools,
    onTools,
    caps: LIBRARY_CAPS,
    undo,
    onHelp: openKeys,
    onDelete: tools.mode === "select" ? selection.remove : undefined,
  });

  const pick = useCallback(
    (x: number, y: number) => {
      const brush = CHAR_TO_BRUSH[tileAt(selected.terrain, selected.width, x, y)];
      if (brush) {
        onTools({ ...tools, brush, mode: "brush" });
      }
    },
    [selected, tools, onTools],
  );

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const char of selected.terrain) {
      out[char] = (out[char] ?? 0) + 1;
    }
    return out;
  }, [selected.terrain]);

  // Every edit of the ground the server took is one more step that can be
  // taken back, up to the painter's thirty.
  const bump = (ok: boolean | void) => {
    if (ok !== false) {
      setBack((n) => Math.min(30, n + 1));
    }
  };

  // A tap on a labelled tile takes the label away; anywhere else puts the
  // dial's text there. Props work the same way.
  function label(x: number, y: number) {
    const existing = selected.labels.find((entry) => entry.x === x && entry.y === y);
    const rest = selected.labels.filter((entry) => !(entry.x === x && entry.y === y));
    if (existing) {
      void patch({ labels: rest });
      return;
    }
    if (tools.label.text.trim()) {
      void patch({ labels: [...rest, { x, y, text: tools.label.text.trim(), dmOnly: tools.label.dmOnly }] });
    }
  }

  function prop(x: number, y: number) {
    const existing = selected.props.find((entry) => entry.x === x && entry.y === y);
    const rest = selected.props.filter((entry) => !(entry.x === x && entry.y === y));
    if (existing) {
      void patch({ props: rest });
      return;
    }
    if (tools.prop.name.trim()) {
      void patch({
        props: [
          ...rest,
          { x, y, name: tools.prop.name.trim(), kind: tools.prop.kind, ...(tools.prop.stamp ? { stamp: tools.prop.stamp } : {}) },
        ],
      });
    }
  }

  const held = MODES.find((entry) => entry.mode === tools.mode);
  const holding = held ? (isPaintMode(tools.mode) ? `${held.label} · ${BRUSH_LABELS[tools.brush]}` : held.label) : "Nothing";
  const backdropPanel = (
    <BackdropControls
      backdrop={selected.backdrop}
      busy={busy}
      onChange={(next) => void patch({ backdropPath: next.path, backdropTransform: next.transform })}
    />
  );

  const menuItem =
    "flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 text-sm text-stone-300 outline-none data-[disabled]:cursor-default data-[disabled]:opacity-40 data-[highlighted]:bg-stone-800 data-[highlighted]:text-amber-100";
  const primary = (
    <span className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        disabled={busy || !canDeploy}
        title={canDeploy ? "Replace the board's ground with this map" : "Nothing is on the table to replace"}
        onClick={() => void act("deploy")}
        className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-gradient-to-b from-amber-100 via-amber-200 to-amber-400 px-3 text-amber-950 shadow-[0_1px_0_rgba(253,247,231,0.6)_inset,0_2px_8px_rgba(4,2,12,0.5)] disabled:opacity-45 motion-magnet"
      >
        <Upload className="size-3.5" />
        <span className="font-display text-[11px] font-semibold uppercase tracking-[0.12em]">Put it on the table</span>
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" aria-label="More for this map" className="flex size-9 items-center justify-center rounded-lg border border-stone-700 text-stone-300 hover:text-amber-200">
            <MoreVertical className="size-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className="z-[70] min-w-52 rounded-lg border border-stone-600/60 bg-stone-950 p-1 shadow-elev-2">
            {state.workshop ? null : (
              <DropdownMenu.Item
                disabled={busy || !state.hasParty || state.board !== null}
                title={
                  !state.hasParty
                    ? "There is nobody to put on it yet"
                    : state.board
                      ? "Something is already on the table"
                      : "Put the party on this map with nobody to fight"
                }
                onSelect={() => void act("open-scene")}
                className={menuItem}
              >
                <Play className="size-4" /> Open it as a scene
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item disabled={busy} aria-label={`Duplicate ${selected.name}`} onSelect={() => void duplicate()} className={menuItem}>
              <Copy className="size-4" /> Duplicate
            </DropdownMenu.Item>
            <DropdownMenu.Item disabled={busy} onSelect={() => void remove()} className={cn(menuItem, "data-[highlighted]:text-red-300")}>
              <Trash2 className="size-4" /> Forget it
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </span>
  );

  return (
    <>
      <MapEditorShell
        title={<MapNameField words={words} />}
        save={<SaveDot state={words.state} />}
        undo={undo}
        back={painter.canUndo ? Math.max(1, back) : 0}
        grid={grid}
        onGrid={setGrid}
        dmView={dmView}
        onDmView={setDmView}
        zoom={zoom}
        controls={controls}
        primary={primary}
        tools={tools}
        onTools={onTools}
        caps={LIBRARY_CAPS}
        onHelp={openKeys}
        toasts={toasts}
        closeGap={inSheet}
        options={
          <MapOptions
            tools={tools}
            onTools={onTools}
            caps={LIBRARY_CAPS}
            counts={{
              lights: selected.lights.length,
              labels: selected.labels.length,
              props: selected.props.length,
              zones: selected.zones.length,
            }}
            onClearLights={() => void patch({ lights: [] })}
            onClearLabels={() => void patch({ labels: [] })}
            onClearZones={() => void patch({ zones: [] })}
            npcNames={npcNames}
            swatches={swatches}
            objects={catalogue?.objects}
            ownSets={resolved.sets}
            backdropPanel={backdropPanel}
            rollPanel={
              <MapRollPanel
                width={selected.width}
                height={selected.height}
                genre={state.genre}
                busy={busy}
                onRoll={async (generated) => {
                  const ok = await painter.edit({ replaceTerrain: generated.terrain });
                  if (ok) {
                    bump(true);
                    if (generated.theme !== selected.theme) {
                      await patch({ theme: generated.theme });
                    }
                  }
                }}
              />
            }
          />
        }
        canvas={
          <TerrainCanvas
            terrain={selected.terrain}
            width={selected.width}
            height={selected.height}
            backdrop={selected.backdrop}
            lights={selected.lights}
            labels={selected.labels}
            props={selected.props}
            doors={selected.doors}
            zones={selected.zones}
            overlayPath={selected.overlayPath}
            tool={canvasToolFor(tools, LIBRARY_CAPS)}
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
            onStrokeEnd={() => {
              painter.strokeEnd();
              bump();
            }}
            onShape={(from, to) => void painter.shape(tools.mode, tools.brush, from, to).then(bump)}
            onStamp={(x, y) => void painter.edit({ stamp: { kind: tools.stamp, x, y, ...tools.stampSize } }).then(bump)}
            onLight={(x, y) => void patch({ light: { x, y, ...tools.light } })}
            onLabel={label}
            onProp={prop}
            onDoor={(x, y) => void patch({ door: { x, y } })}
            onZone={(from, to) =>
              void patch({
                zones: [
                  ...selected.zones,
                  { x0: from.x, y0: from.y, x1: to.x, y1: to.y, ambient: tools.zone, kind: tools.zoneKind },
                ],
              })
            }
            onPick={pick}
            onSelect={selection.onSelect}
            selected={tools.mode === "select" ? selection.boxes : undefined}
            refused={toasts.filter((toast) => toast.tone === "refused").at(-1)?.id}
            onBackdrop={(transform) => void patch({ backdropPath: selected.backdrop?.path ?? "", backdropTransform: transform })}
          />
        }
        status={
          <MapStatusLine
            store={hoverStore}
            terrain={selected.terrain}
            width={selected.width}
            height={selected.height}
            holding={holding}
            extra={
              selected.seed ? (
                <span className="flex shrink-0 items-baseline gap-1.5">
                  <span className="font-display text-[8px] uppercase tracking-[0.16em] text-stone-600">Seed</span>
                  <span className="font-mono text-[10px] text-stone-300">{selected.seed}</span>
                </span>
              ) : null
            }
          />
        }
        side={
          <>
            <MapLayersPanel
              objects={objects}
              refs={selection.refs}
              hidden={hidden}
              onHidden={setHidden}
              layers={LAYERS}
              editable={["labels", "props", "lights", "doors", "zones"]}
              counts={{
                terrain: selected.terrain.length,
                backdrop: selected.backdrop ? 1 : 0,
                overlay: selected.overlayPath ? 1 : 0,
              }}
              onSelect={(refs) => {
                selection.setRefs(refs);
                onTools({ ...tools, mode: "select" });
              }}
              onDelete={(refs) => void patch(removeObjects(objects, refs) as unknown as Record<string, unknown>)}
              onDmOnly={(refs, dmOnly) => void patch({ labels: setDmOnly(objects, refs, dmOnly).labels })}
              extras={{
                backdrop: backdropPanel,
                overlay: (
                  <OverlayControls overlayPath={selected.overlayPath} busy={busy} onChange={(overlayPath) => void patch({ overlayPath })} />
                ),
              }}
            />
            <MapTilesetPanel
              skin={skin}
              resolved={resolved}
              genre={state.genre}
              theme={selected.theme}
              catalogue={catalogue}
              counts={counts}
              painted={painted}
              onPainted={setPainted}
              onSkin={(next) => void patch({ skin: next })}
            />
            <MapInspector
              store={hoverStore}
              terrain={selected.terrain}
              width={selected.width}
              height={selected.height}
              objects={objects}
              refs={tools.mode === "select" ? selection.refs : []}
              selectionTitle={selection.title}
              selectionBar={selection.bar}
            />
            <MapDetailsPanel words={words} knownTags={knownTags}>
              <div className="grid grid-cols-2 gap-1.5">
                <Select<string>
                  value={selected.theme}
                  label="Theme"
                  size="sm"
                  onChange={(theme) => void patch({ theme })}
                  className="w-full"
                  options={MAP_THEMES.map((theme) => ({ value: theme as string, label: THEME_LABELS[theme] }))}
                />
                <Select<string>
                  value={selected.ambient}
                  label="Ambient light"
                  size="sm"
                  onChange={(ambient) => void patch({ ambient })}
                  className="w-full"
                  options={[
                    { value: "bright", label: "Daylight" },
                    { value: "dim", label: "Dim" },
                    { value: "dark", label: "Dark" },
                  ]}
                />
              </div>
              <AmbienceControls value={selected.ambience} onChange={(ambience) => void patch({ ambience })} />
            </MapDetailsPanel>
          </>
        }
      />
      {selection.dialog}
      <HotkeyOverlay open={keysOpen} onOpenChange={setKeysOpen} groups={mapHotkeyGroups(LIBRARY_CAPS)} />
    </>
  );
}
