"use client";

import { ExternalLink, Map as MapIcon, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Select } from "@/components/ui/Select";
import { KitButton } from "@/app/campaigns/[campaignId]/PanelKit";
import type { Pin, Region } from "@/lib/worldforge/model";
import { mapWouldLoop, REGION_COLORS } from "@/lib/worldforge/tree";
import type { WorldState } from "./useWorld";
import { EntityAvatar, EntityPicker, typeOf } from "./world-ui";

// What a pin or a region on the atlas is: its name, the entry it stands for,
// notes, and for a pin the map it opens (a map made inside it, or a jump to
// another map that keeps its own place in the tree).

export function AtlasCard({
  world,
  pin,
  region,
  making,
  subMapForm,
  onMakeSubMap,
  onOpenMap,
  onOpenEntry,
  onSavePin,
  onDeletePin,
  onSaveRegion,
  onDeleteRegion,
  onClose,
}: {
  world: WorldState;
  pin: Pin | null;
  region: Region | null;
  making: { name: string; image: string } | null;
  subMapForm: ReactNode;
  onMakeSubMap: () => void;
  onOpenMap: (id: string) => void;
  onOpenEntry: (ref: string) => void;
  onSavePin: (pin: Pin) => void;
  onDeletePin: (pin: Pin) => void;
  onSaveRegion: (region: Region) => void;
  onDeleteRegion: (region: Region) => void;
  onClose: () => void;
}) {
  const { doc, entities } = world;
  const [draft, setDraft] = useState({ name: pin?.name ?? region?.name ?? "", notes: pin?.notes ?? region?.notes ?? "" });
  const [picking, setPicking] = useState(false);
  const ref = pin?.ref ?? region?.ref ?? "";
  const entity = entities.find((entry) => entry.ref === ref);
  const save = (patch: Partial<Pin & Region>) => {
    if (pin) onSavePin({ ...pin, ...draft, ...patch } as Pin);
    if (region) onSaveRegion({ ...region, ...draft, ...patch } as Region);
  };
  const linked = pin?.linkedMapId ? doc.maps.find((atlas) => atlas.id === pin.linkedMapId) : null;
  const portals = pin ? doc.maps.filter((atlas) => atlas.id !== pin.mapId && !mapWouldLoop(doc.maps, doc.pins, pin, atlas.id)) : [];

  return (
    <div className="panel motion-pop flex flex-col gap-2 rounded-lg p-3" data-tour="world-atlas-card">
      <div className="flex items-center gap-2">
        <span className="eyebrow text-[10px] text-amber-400/80">{pin ? "Pin" : "Region"}</span>
        <input className={cn(ui.input, "py-1 text-sm")} aria-label="Name" maxLength={80} placeholder={entity?.name ?? "A name"} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} onBlur={() => save({})} />
        <KitButton tone="iconDanger" always aria-label="Delete" onClick={() => (pin ? onDeletePin(pin) : region && onDeleteRegion(region))}>
          <Trash2 className="size-4" />
        </KitButton>
        <KitButton tone="icon" always aria-label="Close" onClick={onClose}>
          <X className="size-4" />
        </KitButton>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-stone-500">Stands for</span>
        {entity ? (
          <>
            <button type="button" onClick={() => onOpenEntry(entity.ref)} className="pk-chip motion-pop text-[11px]">
              <EntityAvatar entity={entity} type={typeOf(doc, entity)} size="size-4" /> {entity.name} <ExternalLink className="size-3" />
            </button>
            <button type="button" onClick={() => save({ ref: "" })} className="text-[11px] text-stone-500 hover:text-red-300">unbind</button>
          </>
        ) : null}
        <KitButton tone="link" onClick={() => setPicking((value) => !value)}>{entity ? "Change" : "Pick an entry"}</KitButton>
      </div>
      {picking ? (
        <EntityPicker doc={doc} entities={entities} chosen={[ref]} label="the entry it stands for" onPick={(picked) => { save({ ref: picked.ref, name: draft.name || picked.name }); setDraft({ ...draft, name: draft.name || picked.name }); setPicking(false); }} />
      ) : null}
      {region ? (
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Colour">
          {REGION_COLORS.map((color) => (
            <button key={color} type="button" role="radio" aria-checked={region.color === color} aria-label={color} onClick={() => save({ color })} className={cn("size-5 rounded-full border-2 motion-press", region.color === color ? "border-amber-100" : "border-transparent")} style={{ background: color }} />
          ))}
        </div>
      ) : null}
      <textarea className={cn(ui.input, "min-h-14 text-xs")} aria-label="Notes" placeholder="Notes" maxLength={400} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} onBlur={() => save({})} />
      {pin ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-stone-500">Opens</span>
          {linked ? (
            <>
              <KitButton tone="small" onClick={() => onOpenMap(linked.id)}><MapIcon className="size-3.5" /> {linked.name}</KitButton>
              <button type="button" onClick={() => save({ linkedMapId: "" })} className="text-[11px] text-stone-500 hover:text-red-300">unlink</button>
            </>
          ) : (
            <>
              {making ? null : <KitButton tone="small" onClick={onMakeSubMap}>A new map inside it</KitButton>}
              {portals.length ? (
                <Select label="Or jump to a map" size="sm" value="" placeholder="or jump to..." onChange={(id) => save({ linkedMapId: id })} options={portals.map((atlas) => ({ value: atlas.id, label: atlas.name }))} />
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {pin && making ? subMapForm : null}
    </div>
  );
}
