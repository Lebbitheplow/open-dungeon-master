"use client";

import { ChevronRight, Hexagon, Map as MapIcon, MapPin, MousePointer2, Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { KitButton } from "@/app/campaigns/[campaignId]/PanelKit";
import { LoreImageField } from "@/app/workshop/lore/LoreFields";
import { newId, type AtlasMap, type Pin, type Region, type XY } from "@/lib/worldforge/model";
import { mapBreadcrumbs, mapTree, nextRegionColor, polygonCentroid } from "@/lib/worldforge/tree";
import type { WorldApi, WorldState } from "./useWorld";
import { AtlasCard } from "./AtlasCard";

// The atlas, after WorldForge's map tab: pictures of the world with pins on
// them, each pin bound to an entry, and maps inside maps (a pin opens the
// city map, the city map's pin opens the tavern's). Regions are named
// shapes drawn over a map: a kingdom's border, a forest's edge.

type Mode = "look" | "pin" | "region";

export function AtlasView({ api, world, onOpen }: { api: WorldApi; world: WorldState; onOpen: (ref: string) => void }) {
  const { doc } = world;
  const [mapId, setMapId] = useState(doc.maps[0]?.id ?? "");
  const [mode, setMode] = useState<Mode>("look");
  const [selected, setSelected] = useState<{ kind: "pin" | "region"; id: string } | null>(null);
  const [drawing, setDrawing] = useState<XY[]>([]);
  const [drag, setDrag] = useState<{ id: string; at: XY } | null>(null);
  const [making, setMaking] = useState<{ name: string; image: string } | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const atlas = doc.maps.find((entry) => entry.id === mapId) ?? doc.maps[0] ?? null;
  const pins = atlas ? doc.pins.filter((pin) => pin.mapId === atlas.id) : [];

  const pointAt = (event: { clientX: number; clientY: number }): XY => {
    const box = surface.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) };
  };

  async function makeMap(parentPin?: Pin) {
    if (!making?.name.trim()) return;
    const made: AtlasMap = { id: newId("map"), name: making.name.trim(), image: making.image, parentPinId: parentPin?.id ?? "", regions: [] };
    await api.patch({
      maps: [...doc.maps, made],
      ...(parentPin ? { pins: doc.pins.map((pin) => (pin.id === parentPin.id ? { ...pin, linkedMapId: made.id } : pin)) } : {}),
    });
    setMaking(null);
    setMapId(made.id);
  }

  async function savePins(next: Pin[]) {
    await api.patch({ pins: next });
  }
  async function saveRegions(regions: Region[]) {
    if (!atlas) return;
    await api.patch({ maps: doc.maps.map((entry) => (entry.id === atlas.id ? { ...entry, regions } : entry)) });
  }

  function click(event: React.MouseEvent) {
    if (!atlas || !surface.current) return;
    const at = pointAt(event);
    if (mode === "pin") {
      const pin: Pin = { id: newId("pin"), mapId: atlas.id, x: at.x, y: at.y, name: "", ref: "", linkedMapId: "", notes: "" };
      void savePins([...doc.pins, pin]);
      setSelected({ kind: "pin", id: pin.id });
      setMode("look");
    } else if (mode === "region") {
      setDrawing((points) => [...points, at]);
    } else {
      setSelected(null);
    }
  }

  async function finishRegion() {
    if (!atlas || drawing.length < 3) return;
    const region: Region = { id: newId("rg"), name: "A region", points: drawing, color: nextRegionColor(atlas.regions), ref: "", notes: "" };
    await saveRegions([...atlas.regions, region]);
    setDrawing([]);
    setMode("look");
    setSelected({ kind: "region", id: region.id });
  }

  const newMapForm = (parentPin?: Pin) =>
    making ? (
      <form className="panel motion-pop flex flex-col gap-2 rounded-lg p-3" onSubmit={(event) => { event.preventDefault(); void makeMap(parentPin); }}>
        <input className={ui.input} placeholder={parentPin ? `Inside ${parentPin.name || "this pin"}` : "The Saltmarch"} aria-label="Map name" maxLength={80} value={making.name} onChange={(event) => setMaking({ ...making, name: event.target.value })} autoFocus />
        <LoreImageField imagePath={making.image} onChange={(image) => setMaking({ ...making, image })} />
        <div className="flex justify-end gap-1.5">
          <KitButton tone="small" onClick={() => setMaking(null)}><X className="size-3.5" /> Cancel</KitButton>
          <KitButton tone="primary" type="submit" disabled={!making.name.trim()}>Make the map</KitButton>
        </div>
      </form>
    ) : null;

  if (!atlas) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center animate-fade-up" data-tour="world-atlas">
        <MapIcon className="size-8 text-amber-400/70" />
        <p className="max-w-md text-sm text-stone-400">The atlas holds pictures of the world, with a pin on each place that matters and maps inside maps. Start with the widest one.</p>
        {making ? <div className="w-full max-w-md text-left">{newMapForm()}</div> : <KitButton tone="primary" onClick={() => setMaking({ name: "", image: "" })}><Plus className="size-3.5" /> First map</KitButton>}
      </div>
    );
  }

  const trail = mapBreadcrumbs(doc.maps, doc.pins, atlas.id);
  const selectedPin = selected?.kind === "pin" ? doc.pins.find((pin) => pin.id === selected.id) ?? null : null;
  const selectedRegion = selected?.kind === "region" ? atlas.regions.find((region) => region.id === selected.id) ?? null : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-1" aria-label="Maps">
        <span className="eyebrow text-[10px] text-stone-500">Maps</span>
        {mapTree(doc.maps, doc.pins).map(({ map: entry, depth }) => (
          <button key={entry.id} type="button" onClick={() => { setMapId(entry.id); setSelected(null); setDrawing([]); }} className={cn("flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs motion-press", entry.id === atlas.id ? "bg-amber-400/10 text-amber-100" : "text-stone-400 hover:text-stone-200")} style={{ paddingLeft: `${0.375 + depth * 0.75}rem` }}>
            <MapIcon className="size-3.5 shrink-0" /> {entry.name}
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
            <KitButton tone="iconDanger" always aria-label={`Delete the map ${atlas.name}`} onClick={() => api.patch({ maps: doc.maps.filter((entry) => entry.id !== atlas.id), pins: doc.pins.filter((pin) => pin.mapId !== atlas.id).map((pin) => (pin.linkedMapId === atlas.id ? { ...pin, linkedMapId: "" } : pin)) }).then(() => setMapId(""))}>
              <Trash2 className="size-4" />
            </KitButton>
          </div>
        </div>
        {mode === "region" ? (
          <p className="motion-pop text-xs text-stone-400">
            Click the map to set each corner. {drawing.length >= 3 ? <button type="button" onClick={finishRegion} className="text-amber-200 underline underline-offset-2">Close the shape ({drawing.length} corners)</button> : `${3 - drawing.length} more to make a shape.`}
          </p>
        ) : mode === "pin" ? (
          <p className="motion-pop text-xs text-stone-400">Click where the pin goes.</p>
        ) : null}

        <div
          key={atlas.id}
          ref={surface}
          onClick={click}
          onPointerMove={(event) => drag && setDrag({ id: drag.id, at: pointAt(event) })}
          onPointerUp={() => {
            // A press that did not move is a click, not a move to save.
            const from = drag ? doc.pins.find((pin) => pin.id === drag.id) : null;
            if (drag && from && Math.hypot(from.x - drag.at.x, from.y - drag.at.y) > 0.004) {
              void savePins(doc.pins.map((pin) => (pin.id === drag.id ? { ...pin, x: drag.at.x, y: drag.at.y } : pin)));
            }
            setDrag(null);
          }}
          className={cn("panel animate-fade-up relative aspect-[16/10] w-full select-none overflow-hidden rounded-xl", mode !== "look" && "cursor-crosshair")}
          data-tour="world-atlas"
        >
          {atlas.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={atlas.image} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
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
            return (
              <button
                key={pin.id}
                type="button"
                className={cn("wf-pin absolute flex flex-col items-center", selectedPin?.id === pin.id && "z-10")}
                style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%`, "--i": index } as React.CSSProperties}
                onClick={(event) => { event.stopPropagation(); setSelected({ kind: "pin", id: pin.id }); }}
                onPointerDown={(event) => { if (mode === "look") { event.currentTarget.setPointerCapture(event.pointerId); setDrag({ id: pin.id, at: { x: pin.x, y: pin.y } }); } }}
                aria-label={pin.name || entity?.name || "A pin"}
              >
                <span className={cn("rounded px-1 text-[11px] text-amber-50 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]", selectedPin?.id === pin.id && "bg-stone-950/80")}>{pin.name || entity?.name}</span>
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
            onMakeSubMap={() => setMaking({ name: "", image: "" })}
            onOpenMap={(id) => { setMapId(id); setSelected(null); }}
            onOpenEntry={onOpen}
            onSavePin={(pin) => savePins(doc.pins.map((entry) => (entry.id === pin.id ? pin : entry)))}
            onDeletePin={(pin) => { setSelected(null); void savePins(doc.pins.filter((entry) => entry.id !== pin.id)); }}
            onSaveRegion={(region) => saveRegions(atlas.regions.map((entry) => (entry.id === region.id ? region : entry)))}
            onDeleteRegion={(region) => { setSelected(null); void saveRegions(atlas.regions.filter((entry) => entry.id !== region.id)); }}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
