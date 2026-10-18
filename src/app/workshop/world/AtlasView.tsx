"use client";

import { BookOpenText, ChevronRight, Globe2, Grid3x3, Hexagon, Link2, Map as MapIcon, MapPin, MousePointer2, Plus, Settings2, Swords, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { KitButton } from "@/app/campaigns/[campaignId]/PanelKit";
import { LoreImageField } from "@/app/workshop/lore/LoreFields";
import { newId, type AtlasMap, type Pin, type Region, type XY } from "@/lib/worldforge/model";
import { mapBreadcrumbs, mapTree, nextRegionColor, polygonCentroid } from "@/lib/worldforge/tree";
import { frameOf } from "@/lib/worldforge/atlas-frame";
import type { Placement } from "@/lib/db/atlas-region";
import type { WorldApi, WorldState } from "./useWorld";
import { AtlasCard } from "./AtlasCard";
import { isBound, movedText, OutOfStep, PinRegionActions, RegionBar, RegionNoticeLine, RegionReview, useAtlasRegion } from "./AtlasRegion";
import { PlaceBattleMaps, type OpenPrep } from "./PlaceBattleMaps";
import { CornerEditor, DeleteReview, MapSettings, NotSaved, PointFields, useAtlasDelete } from "./AtlasEdit";
import { PartyBar } from "./AtlasParty";
import type { WorldEntity } from "@/lib/db/world-forge";

// The atlas, after WorldForge's map tab: pictures of the world with pins on
// them, each pin bound to an entry, and maps inside maps (a pin opens the
// city map, the city map's pin opens the tavern's). Regions are named
// shapes drawn over a map: a kingdom's border, a forest's edge.
//
// One map may stand over the campaign's playable Region map (AtlasRegion,
// audit WF-09): its pins can place their places there, and a bound pin and
// its place then move together. Each map is drawn in the box its pins were
// placed in (its frame), so a picture that is not 16:10 keeps its pins and
// regions where they were put.
//
// A pin that stands for a place offers the place's battle maps and
// encounters (PlaceBattleMaps), and a map nested in such a pin (the
// tavern's map inside the city's) opens them from its own view. An Atlas
// picture is never a battle map: it supplies no walls, doors or light.
//
// Everything a pointer does has a keyboard way too (AtlasEdit, audit
// WF-20): a pin can be added in the middle and moved with the arrow keys or
// by numbers, a region's corners can be typed, and a map has settings. A
// save that fails keeps what was typed, and every delete says what it
// touches first and can be undone.

type Mode = "look" | "pin" | "region";

export function AtlasView({
  campaignId,
  api,
  world,
  onOpen,
  onOpenPrep,
}: {
  campaignId: string;
  api: WorldApi;
  world: WorldState;
  onOpen: (ref: string) => void;
  // Opens a place's battle map or encounter; absent where neither can be.
  onOpenPrep?: OpenPrep;
}) {
  const { doc } = world;
  const [mapId, setMapId] = useState(doc.maps[0]?.id ?? "");
  const [mode, setMode] = useState<Mode>("look");
  const [selected, setSelected] = useState<{ kind: "pin" | "region"; id: string } | null>(null);
  const [drawing, setDrawing] = useState<XY[]>([]);
  const [drag, setDrag] = useState<{ id: string; at: XY } | null>(null);
  const [making, setMaking] = useState<{ name: string; image: string } | null>(null);
  const [makeFailed, setMakeFailed] = useState(false);
  const [settings, setSettings] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const atlas = doc.maps.find((entry) => entry.id === mapId) ?? doc.maps[0] ?? null;
  const pins = atlas ? doc.pins.filter((pin) => pin.mapId === atlas.id) : [];
  const region = useAtlasRegion(api, world);
  const remover = useAtlasDelete(api, region);
  // An Undo offered after a save runs later, against the world as it is
  // then: a save computed from an older copy would put back other rows too.
  const latest = useRef({ api, doc });
  useEffect(() => {
    latest.current = { api, doc };
  });

  const pointAt = (event: { clientX: number; clientY: number }): XY => {
    const box = surface.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) };
  };

  async function makeMap(parentPin?: Pin) {
    if (!making?.name.trim()) return;
    const made: AtlasMap = { id: newId("map"), name: making.name.trim(), image: making.image, parentPinId: parentPin?.id ?? "", regions: [] };
    const ok = await api.patch({
      maps: [...doc.maps, made],
      ...(parentPin ? { pins: doc.pins.map((pin) => (pin.id === parentPin.id ? { ...pin, linkedMapId: made.id } : pin)) } : {}),
    });
    // A refused map keeps its form, name and picture as typed.
    setMakeFailed(!ok);
    if (!ok) return;
    setMaking(null);
    setMapId(made.id);
  }

  async function savePins(next: Pin[], onRegion?: (moves: Placement[]) => void) {
    return api.patch({ pins: next }, onRegion ? { onRegion } : undefined);
  }

  // A bound pin moved by hand took its place's Region marker along: say so,
  // and offer to put the pin back (its place follows it back).
  function movePin(id: string, to: { x: number; y: number }) {
    const from = doc.pins.find((pin) => pin.id === id);
    if (!from) return;
    void savePins(
      doc.pins.map((pin) => (pin.id === id ? { ...pin, x: to.x, y: to.y } : pin)),
      (moves) =>
        region.setNotice({
          text: movedText(moves),
          undo: () => {
            const now = latest.current;
            return now.api.patch({ pins: now.doc.pins.map((pin) => (pin.id === id ? { ...pin, x: from.x, y: from.y } : pin)) });
          },
        }),
    );
  }
  async function saveRegions(regions: Region[]) {
    if (!atlas) return false;
    return api.patch({ maps: doc.maps.map((entry) => (entry.id === atlas.id ? { ...entry, regions } : entry)) });
  }

  function addPin(at: XY) {
    if (!atlas) return;
    const pin: Pin = { id: newId("pin"), mapId: atlas.id, x: at.x, y: at.y, name: "", ref: "", linkedMapId: "", notes: "" };
    void savePins([...doc.pins, pin]);
    setSelected({ kind: "pin", id: pin.id });
    setMode("look");
  }

  // Arrow keys move a focused pin a step, Shift a bigger one.
  function nudge(event: React.KeyboardEvent, pin: Pin) {
    const step = event.shiftKey ? 0.05 : 0.01;
    const by: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = by[event.key];
    if (!move) return;
    event.preventDefault();
    const fit = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;
    movePin(pin.id, { x: fit(pin.x + move[0]), y: fit(pin.y + move[1]) });
  }

  function click(event: React.MouseEvent) {
    if (!atlas || !surface.current) return;
    const at = pointAt(event);
    if (mode === "pin") {
      addPin(at);
    } else if (mode === "region") {
      setDrawing((points) => [...points, at]);
    } else {
      setSelected(null);
    }
  }

  async function finishRegion(points: XY[] = drawing) {
    if (!atlas || points.length < 3) return;
    const region: Region = { id: newId("rg"), name: "A region", points, color: nextRegionColor(atlas.regions), ref: "", notes: "" };
    // A refused shape keeps its corners, to close again.
    if (!(await saveRegions([...atlas.regions, region]))) return;
    setDrawing([]);
    setMode("look");
    setSelected({ kind: "region", id: region.id });
  }

  const newMapForm = (parentPin?: Pin) =>
    making ? (
      <form className="panel motion-pop flex flex-col gap-2 rounded-lg p-3" onSubmit={(event) => { event.preventDefault(); void makeMap(parentPin); }}>
        <input className={ui.input} placeholder={parentPin ? `Inside ${parentPin.name || "this pin"}` : "The Saltmarch"} aria-label="Map name" maxLength={80} value={making.name} onChange={(event) => setMaking({ ...making, name: event.target.value })} autoFocus />
        <LoreImageField imagePath={making.image} onChange={(image) => setMaking({ ...making, image })} />
        {makeFailed ? <NotSaved onRetry={() => void makeMap(parentPin)} what="The name and picture" /> : null}
        <div className="flex justify-end gap-1.5">
          <KitButton tone="small" onClick={() => { setMaking(null); setMakeFailed(false); }}><X className="size-3.5" /> Cancel</KitButton>
          <KitButton tone="primary" type="submit" disabled={!making.name.trim()}>Make the map</KitButton>
        </div>
      </form>
    ) : null;

  if (!atlas) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center animate-fade-up" data-tour="world-atlas">
        {/* The last map deleted: its Undo is still offered here. */}
        <div className="w-full max-w-md text-left">
          <RegionNoticeLine region={region} />
        </div>
        <MapIcon className="size-8 text-amber-400/70" />
        <p className="max-w-md text-sm text-stone-400">The atlas holds pictures of the world, with a pin on each place that matters and maps inside maps. Start with the widest one.</p>
        {making ? <div className="w-full max-w-md text-left">{newMapForm()}</div> : <KitButton tone="primary" onClick={() => setMaking({ name: "", image: "" })}><Plus className="size-3.5" /> First map</KitButton>}
      </div>
    );
  }

  const trail = mapBreadcrumbs(doc.maps, doc.pins, atlas.id);
  const frame = frameOf(atlas);
  const selectedPin = selected?.kind === "pin" ? doc.pins.find((pin) => pin.id === selected.id) ?? null : null;
  const selectedRegion = selected?.kind === "region" ? atlas.regions.find((region) => region.id === selected.id) ?? null : null;
  const pinEntity = selectedPin ? world.entities.find((entry) => entry.ref === selectedPin.ref) : undefined;
  // The place this map is drawn inside: the place its parent pin stands for.
  const parentPin = atlas.parentPinId ? doc.pins.find((pin) => pin.id === atlas.parentPinId) : undefined;
  const insidePlace = parentPin ? world.entities.find((entry) => entry.ref === parentPin.ref && entry.shelf === "location") : undefined;

  return (
    <div className="grid gap-4 @4xl:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-1" aria-label="Maps">
        <span className="eyebrow text-[10px] text-stone-500">Maps</span>
        {mapTree(doc.maps, doc.pins).map(({ map: entry, depth }) => (
          <button key={entry.id} type="button" onClick={() => { setMapId(entry.id); setSelected(null); setDrawing([]); }} className={cn("flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs motion-press", entry.id === atlas.id ? "bg-amber-400/10 text-amber-100" : "text-stone-400 hover:text-stone-200")} style={{ paddingLeft: `${0.375 + depth * 0.75}rem` }}>
            <MapIcon className="size-3.5 shrink-0" /> {entry.name}
            {entry.role === "region" ? <Globe2 className="ml-auto size-3 shrink-0 text-emerald-300" aria-label="Over the Region" /> : null}
          </button>
        ))}
        {making && !selectedPin ? newMapForm() : <KitButton tone="link" onClick={() => setMaking({ name: "", image: "" })}><Plus className="size-3.5" /> New map</KitButton>}
      </aside>

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex items-center gap-1 text-sm" aria-label="Where in the atlas">
            {trail.map((entry, index) => (
              <span key={entry.id} className="flex items-center gap-1">
                {index ? <ChevronRight className="size-3.5 text-stone-600" /> : null}
                <button type="button" onClick={() => setMapId(entry.id)} className={cn("motion-press", entry.id === atlas.id ? "text-amber-100" : "text-stone-400 hover:text-stone-200")}>{entry.name}</button>
              </span>
            ))}
          </nav>
          <div className="ml-auto flex gap-1" role="radiogroup" aria-label="What a click does">
            {([["look", MousePointer2, "Look"], ["pin", MapPin, "Place a pin"], ["region", Hexagon, "Draw a region"]] as const).map(([value, Icon, label]) => (
              <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => { setMode(value); setDrawing([]); }} className={cn(ui.btnSmall, "px-2 py-1 text-xs", mode === value && "border-amber-500/60 bg-amber-400/10 text-amber-100")}>
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
            <KitButton tone="icon" always aria-label={`Settings for the map ${atlas.name}`} aria-expanded={settings} onClick={() => setSettings((open) => !open)} data-testid="atlas-settings-button">
              <Settings2 className="size-4" />
            </KitButton>
            <KitButton tone="iconDanger" always aria-label={`Delete the map ${atlas.name}`} disabled={remover.busy} onClick={() => void remover.review({ kind: "map", mapId: atlas.id })} data-testid="atlas-delete-map">
              <Trash2 className="size-4" />
            </KitButton>
          </div>
        </div>
        {mode === "region" ? (
          <p className="motion-pop text-xs text-stone-400">
            Click the map to set each corner. {drawing.length >= 3 ? <button type="button" onClick={() => void finishRegion()} className="text-amber-200 underline underline-offset-2">Close the shape ({drawing.length} corners)</button> : `${3 - drawing.length} more to make a shape.`}{" "}
            Or{" "}
            <button type="button" onClick={() => void finishRegion([{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.5, y: 0.6 }])} className="text-amber-200 underline underline-offset-2" data-testid="atlas-region-by-numbers">
              start with three corners in the middle
            </button>{" "}
            and type where each goes.
          </p>
        ) : mode === "pin" ? (
          <p className="motion-pop text-xs text-stone-400">
            Click where the pin goes. Or{" "}
            <button type="button" onClick={() => addPin({ x: 0.5, y: 0.5 })} className="text-amber-200 underline underline-offset-2" data-testid="atlas-pin-in-middle">
              add one in the middle
            </button>{" "}
            and move it with the arrow keys or by numbers.
          </p>
        ) : null}
        <RegionBar region={region} atlas={atlas} pins={pins} />
        <PartyBar key={`party-${atlas.id}`} api={api} atlas={atlas} region={region} />
        {settings ? <MapSettings key={`settings-${atlas.id}`} api={api} atlas={atlas} region={region} onClose={() => setSettings(false)} /> : null}
        <RegionReview key={region.step ? region.step.kind : "none"} region={region} />
        <DeleteReview
          remover={remover}
          onDeleted={(target) => {
            if (target.kind === "map") {
              setMapId("");
              setSettings(false);
            }
            setSelected(null);
          }}
        />
        <RegionNoticeLine region={region} />
        <OutOfStep region={region} atlas={atlas} />
        {insidePlace && onOpenPrep ? <InsidePlace place={insidePlace} onOpen={onOpen} onOpenPrep={onOpenPrep} /> : null}

        <div
          key={atlas.id}
          ref={surface}
          onClick={click}
          onPointerMove={(event) => drag && setDrag({ id: drag.id, at: pointAt(event) })}
          onPointerUp={() => {
            // A press that did not move is a click, not a move to save.
            const from = drag ? doc.pins.find((pin) => pin.id === drag.id) : null;
            if (drag && from && Math.hypot(from.x - drag.at.x, from.y - drag.at.y) > 0.004) movePin(drag.id, drag.at);
            setDrag(null);
          }}
          className={cn("panel animate-fade-up relative w-full select-none overflow-hidden rounded-xl", mode !== "look" && "cursor-crosshair")}
          // The box the pins were placed in, and the picture fitted to it
          // the same way (src/lib/worldforge/atlas-frame.ts).
          style={{ aspectRatio: String(frame.surface) }}
          data-tour="world-atlas"
          data-testid="atlas-surface"
        >
          {atlas.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={atlas.image} alt="" className={cn("absolute inset-0 size-full", frame.fit === "contain" ? "object-contain" : "object-cover")} draggable={false} />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_center,rgba(212,171,58,0.08),transparent_70%)] text-xs text-stone-600">No picture yet: pins still work.</div>
          )}
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 size-full">
            {atlas.regions.map((region, index) => (
              <polygon
                key={region.id}
                points={region.points.map((point) => `${point.x},${point.y}`).join(" ")}
                fill={region.color}
                fillOpacity={selectedRegion?.id === region.id ? 0.32 : 0.18}
                stroke={region.color}
                strokeWidth={selectedRegion?.id === region.id ? 0.004 : 0.0025}
                className="wf-region cursor-pointer"
                style={{ "--i": index } as React.CSSProperties}
                onClick={(event) => { if (mode === "look") { event.stopPropagation(); setSelected({ kind: "region", id: region.id }); } }}
              />
            ))}
            {drawing.length ? <polyline points={drawing.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#f4e0a6" strokeWidth={0.003} strokeDasharray="0.01 0.006" className="wf-edge-dashed" /> : null}
          </svg>
          {atlas.regions.map((region) => {
            const at = polygonCentroid(region.points);
            return <span key={region.id} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 font-display text-xs tracking-wide text-amber-50 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]" style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}>{region.name}</span>;
          })}
          {pins.map((pin, index) => {
            const at = drag?.id === pin.id ? drag.at : pin;
            const entity = world.entities.find((entry) => entry.ref === pin.ref);
            const bound = isBound(pin, atlas);
            return (
              <button
                key={pin.id}
                type="button"
                className={cn("wf-pin absolute flex flex-col items-center", selectedPin?.id === pin.id && "z-10", pin.hidden && atlas.party === "shown" && "opacity-50")}
                style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%`, "--i": index } as React.CSSProperties}
                onClick={(event) => { event.stopPropagation(); setSelected({ kind: "pin", id: pin.id }); }}
                onPointerDown={(event) => { if (mode === "look") { event.currentTarget.setPointerCapture(event.pointerId); setDrag({ id: pin.id, at: { x: pin.x, y: pin.y } }); } }}
                onKeyDown={(event) => nudge(event, pin)}
                aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                aria-label={`${pin.name || entity?.name || "A pin"}${bound ? ", moves with its place on the Region" : ""}`}
                data-bound={bound || undefined}
                data-hidden={pin.hidden || undefined}
              >
                <span className={cn("flex items-center gap-0.5 rounded px-1 text-[11px] text-amber-50 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]", selectedPin?.id === pin.id && "bg-stone-950/80")}>
                  {bound ? <Link2 className="size-3 text-emerald-300" aria-hidden="true" /> : null}
                  {pin.name || entity?.name}
                </span>
                <MapPin className={cn("size-6 drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)]", pin.linkedMapId ? "fill-amber-400/80 text-amber-200" : "fill-red-500/80 text-red-200")} />
              </button>
            );
          })}
        </div>

        {selectedPin || selectedRegion ? (
          <AtlasCard
            key={selected!.id}
            world={world}
            pin={selectedPin}
            region={selectedRegion}
            making={making}
            subMapForm={selectedPin ? newMapForm(selectedPin) : null}
            regionActions={selectedPin ? <PinRegionActions region={region} pin={selectedPin} atlas={atlas} /> : null}
            position={
              selectedPin ? (
                <PointFields at={selectedPin} label="Pin" onCommit={(to) => movePin(selectedPin.id, to)} />
              ) : selectedRegion ? (
                <CornerEditor points={selectedRegion.points} onSave={(points) => void saveRegions(atlas.regions.map((entry) => (entry.id === selectedRegion.id ? { ...entry, points } : entry)))} />
              ) : null
            }
            battleMaps={
              selectedPin && onOpenPrep ? (
                pinEntity?.shelf === "location" ? (
                  <PlaceBattleMaps campaignId={campaignId} entity={pinEntity} api={api} onOpenPrep={onOpenPrep} compact />
                ) : (
                  <p className="text-[11px] text-stone-500" data-testid="pin-battle-maps-hint">
                    {pinEntity ? "Battle maps and encounters belong to places." : "Pick the place this pin stands for to make or link its battle map."}
                  </p>
                )
              ) : null
            }
            onMakeSubMap={() => setMaking({ name: "", image: "" })}
            onOpenMap={(id) => { setMapId(id); setSelected(null); }}
            onOpenEntry={onOpen}
            onSavePin={(pin) => savePins(doc.pins.map((entry) => (entry.id === pin.id ? pin : entry)))}
            onDeletePin={(pin) => void remover.review({ kind: "pin", pinId: pin.id })}
            onSaveRegion={(region) => saveRegions(atlas.regions.map((entry) => (entry.id === region.id ? region : entry)))}
            onDeleteRegion={(region) => void remover.review({ kind: "region", mapId: atlas.id, regionId: region.id })}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

// Over a map drawn inside a place's pin: that place's battle maps and
// encounters, one press away, and a plain word that this picture is not one.
function InsidePlace({ place, onOpen, onOpenPrep }: { place: WorldEntity; onOpen: (ref: string) => void; onOpenPrep: OpenPrep }) {
  const records = place.bound.filter((record) => (record.kind === "map" || record.kind === "encounter") && record.found);
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-stone-700/60 px-2 py-1.5 text-xs text-stone-300" data-testid="atlas-inside-place">
      <span>
        Inside{" "}
        <button type="button" onClick={() => onOpen(place.ref)} className="text-amber-200 underline underline-offset-2">
          {place.name}
        </button>
        .
      </span>
      {records.map((record) => (
        <KitButton key={`${record.kind}|${record.ref}`} tone="small" onClick={() => onOpenPrep(record.kind as "map" | "encounter", record.ownId, place.ref)}>
          {record.kind === "map" ? <Grid3x3 className="size-3.5" /> : <Swords className="size-3.5" />} {record.kind === "map" ? "Open battle map" : "Open encounter"}: {record.name}
        </KitButton>
      ))}
      {records.length ? null : (
        <KitButton tone="small" onClick={() => onOpen(place.ref)}>
          <BookOpenText className="size-3.5" /> Give {place.name} a battle map
        </KitButton>
      )}
      <span className="w-full text-[11px] text-stone-500">This picture is for finding your way. Walls, doors and light are drawn on a battle map, never read from a picture.</span>
    </div>
  );
}
