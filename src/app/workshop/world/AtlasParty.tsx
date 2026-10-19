"use client";

import { ChevronLeft, Eye, EyeOff, Map as MapIcon, MapPin, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { KitButton } from "@/app/campaigns/[campaignId]/PanelKit";
import { SectionHead } from "@/components/ui/SectionHead";
import { polygonCentroid } from "@/lib/worldforge/tree";
import type { ShowPlan } from "@/lib/db/party-atlas";
import type { PartyAtlas, PartyMap } from "@/lib/worldforge/party-atlas";
import type { AtlasMap } from "@/lib/worldforge/model";
import type { AtlasRegion } from "./AtlasRegion";
import type { WorldApi } from "./useWorld";

// The party's Atlas (src/lib/worldforge/party-atlas.ts holds the policy):
// on the DM's side, showing a map to the party after seeing exactly what the
// players will see, and hiding it again; on everyone's Map tab, the maps
// shown, read-only.

// ---- the DM's side ----

export function PartyBar({ api, atlas, region }: { api: WorldApi; atlas: AtlasMap; region: AtlasRegion }) {
  const [plan, setPlan] = useState<ShowPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = atlas.party === "shown";
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };
  const review = () =>
    run(async () => {
      const answer = (await api.party("POST", { mapId: atlas.id })) as ShowPlan | null;
      if (answer) setPlan(answer);
    });
  const show = () =>
    run(async () => {
      const done = (await api.party("POST", { mapId: atlas.id, apply: true })) as ShowPlan | null;
      if (!done?.applied) return;
      setPlan(null);
      region.setNotice({ text: `${atlas.name} is on the party's Atlas now, in everyone's Map tab.` });
    });
  const hide = () =>
    run(async () => {
      const done = (await api.party("DELETE", { mapId: atlas.id })) as { hidden?: boolean } | null;
      if (done?.hidden) region.setNotice({ text: `${atlas.name} is off the party's Atlas.` });
    });

  return (
    <div className="flex flex-col gap-1.5" data-testid="atlas-party">
      <div className="flex flex-wrap items-center gap-1.5">
        {shown ? (
          <>
            <span className="pk-chip text-[11px] text-sky-200" data-testid="atlas-party-shown">
              <Eye className="size-3.5" /> Shown to the party
            </span>
            <KitButton tone="link" disabled={busy} onClick={() => void hide()} data-testid="atlas-party-hide">
              <EyeOff className="size-3.5" /> Hide from the party
            </KitButton>
          </>
        ) : plan ? null : (
          <KitButton tone="small" busy={busy} disabled={busy} onClick={() => void review()} data-testid="atlas-party-show">
            {busy ? null : <Eye className="size-3.5" />} Show to the party
          </KitButton>
        )}
      </div>
      {plan ? (
        <div className="panel motion-pop flex flex-col gap-2 rounded-lg p-3 text-xs text-stone-300" role="dialog" aria-label={`Show ${plan.map.name} to the party?`} data-testid="atlas-party-review">
          <div className="flex items-center gap-2">
            <span className="eyebrow text-[10px] text-amber-400/80">Review</span>
            <span className="text-sm text-amber-100">Show {plan.map.name} to the party?</span>
            <KitButton tone="icon" always className="ml-auto" aria-label="Cancel" onClick={() => setPlan(null)}>
              <X className="size-4" />
            </KitButton>
          </div>
          <p>
            Players will see {plan.seen.pins.length === 1 ? "one pin" : `${plan.seen.pins.length} pins`} and {plan.seen.regions.length === 1 ? "one region" : `${plan.seen.regions.length} regions`}:
          </p>
          {plan.seen.pins.length || plan.seen.regions.length ? (
            <ul className="flex flex-col gap-0.5" data-testid="atlas-party-seen">
              {plan.seen.pins.map((pin) => (
                <li key={pin.id}>
                  <MapPin className="mr-1 inline size-3 text-red-300" />
                  {pin.label || <span className="text-stone-500">a pin with no name</span>}
                </li>
              ))}
              {plan.seen.regions.map((entry) => (
                <li key={entry.id}>
                  <span className="mr-1 inline-block size-2.5 rounded-full" style={{ background: entry.color }} />
                  {entry.name}
                </li>
              ))}
            </ul>
          ) : null}
          {plan.hiddenPins || plan.hiddenRegions ? (
            <p>
              Staying hidden: {[plan.hiddenPins ? `${plan.hiddenPins} ${plan.hiddenPins === 1 ? "pin" : "pins"}` : "", plan.hiddenRegions ? `${plan.hiddenRegions} ${plan.hiddenRegions === 1 ? "region" : "regions"}` : ""].filter(Boolean).join(" and ")}.
            </p>
          ) : null}
          <p className="text-stone-400">To hide one first, cancel, open the pin or region, and tick Hidden from the party.</p>
          {plan.notes.map((note) => (
            <p key={note} className="text-stone-400">{note}</p>
          ))}
          <span className="flex justify-end gap-1.5">
            <KitButton tone="small" onClick={() => setPlan(null)}>Cancel</KitButton>
            <KitButton tone="primary" busy={busy} disabled={busy} onClick={() => void show()} data-testid="atlas-party-apply">
              {busy ? null : <Eye className="size-3.5" />} Show it
            </KitButton>
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ---- everyone's Map tab ----

// The maps the DM has shown, read-only. Draws nothing while there are none.
export function PartyAtlasPanel({ campaignId, refreshKey = 0 }: { campaignId: string; refreshKey?: number }) {
  const [atlas, setAtlas] = useState<PartyAtlas | null>(null);
  const [mapId, setMapId] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/world/atlas/party`)
      .then((response) => (response.ok ? (response.json() as Promise<PartyAtlas>) : null))
      .catch(() => null)
      .then((answer) => {
        if (!cancelled) setAtlas(answer);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, refreshKey]);
  if (!atlas?.maps.length) return null;
  const current = atlas.maps.find((entry) => entry.id === mapId) ?? atlas.maps.find((entry) => !entry.parentPinId) ?? atlas.maps[0];
  const parent = current.parentPinId ? atlas.maps.find((entry) => entry.pins.some((pin) => pin.id === current.parentPinId)) : undefined;
  return (
    <section className="panel flex flex-col gap-2 rounded-xl p-3" aria-label="The party's Atlas" data-testid="party-atlas">
      <SectionHead title="Atlas" />
      {atlas.maps.length > 1 ? (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Maps">
          {atlas.maps.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={entry.id === current.id} onClick={() => setMapId(entry.id)} className={cn("pk-chip text-[11px]", entry.id === current.id && "border-amber-500/60 text-amber-100")}>
              <MapIcon className="size-3" /> {entry.name}
            </button>
          ))}
        </div>
      ) : (
        <span className="text-xs text-stone-300">{current.name}</span>
      )}
      {parent ? (
        <KitButton tone="link" onClick={() => setMapId(parent.id)}>
          <ChevronLeft className="size-3.5" /> Back to {parent.name}
        </KitButton>
      ) : null}
      <PartySurface map={current} onOpen={setMapId} />
    </section>
  );
}

function PartySurface({ map, onOpen }: { map: PartyMap; onOpen: (id: string) => void }) {
  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-stone-800" style={{ aspectRatio: String(map.frame.surface) }} data-testid="party-atlas-surface">
      {map.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={map.image} alt="" className={cn("absolute inset-0 size-full", map.frame.fit === "contain" ? "object-contain" : "object-cover")} draggable={false} />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(212,171,58,0.08),transparent_70%)]" />
      )}
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
        {map.regions.map((region) => (
          <polygon key={region.id} points={region.points.map((point) => `${point.x},${point.y}`).join(" ")} fill={region.color} fillOpacity={0.18} stroke={region.color} strokeWidth={0.0025} />
        ))}
      </svg>
      {map.regions.map((region) => {
        const at = polygonCentroid(region.points);
        return (
          <span key={region.id} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 font-display text-xs tracking-wide text-amber-50 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]" style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}>
            {region.name}
          </span>
        );
      })}
      {map.pins.map((pin) => {
        const marker = (
          <>
            {pin.label ? <span className="rounded bg-stone-950/60 px-1 text-[11px] text-amber-50">{pin.label}</span> : null}
            <MapPin className={cn("size-5 drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)]", pin.opens ? "fill-amber-400/80 text-amber-200" : "fill-red-500/80 text-red-200")} aria-hidden="true" />
          </>
        );
        const style = { left: `${pin.x * 100}%`, top: `${pin.y * 100}%` };
        return pin.opens ? (
          <button key={pin.id} type="button" className="absolute flex -translate-x-1/2 -translate-y-full flex-col items-center" style={style} onClick={() => onOpen(pin.opens!)} aria-label={`${pin.label || "A pin"}: open its map`}>
            {marker}
          </button>
        ) : (
          <span key={pin.id} className="absolute flex -translate-x-1/2 -translate-y-full flex-col items-center" style={style} role="img" aria-label={pin.label || "A pin"}>
            {marker}
          </span>
        );
      })}
    </div>
  );
}
