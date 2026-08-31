"use client";

import { useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DEFAULT_OVERWORLD_PARAMS,
  OVERWORLD_PARAM_LABELS,
  type OverworldParams,
} from "@/lib/overworld/logic";
import type { OverworldData } from "@/app/campaigns/[campaignId]/overworldDraw";

// Authoring the region: describe it, roll seeds against it, name what you
// see, and write down what only you know.
//
// The order matters and is deliberate. Terrain is seeded value noise, so a
// description cannot become tiles; it becomes the five dials below, and then
// the DM rerolls seeds until the coastline falls somewhere they like. That
// is why "Roll another" sits next to the description rather than under it.

type Plan = {
  params: OverworldParams;
  places: Array<{ name: string; blurb: string }>;
  note: string;
};

export function OverworldAuthoring({
  campaignId,
  data,
  onData,
}: {
  campaignId: string;
  data: OverworldData;
  onData: (next: OverworldData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [params, setParams] = useState<OverworldParams>(
    (data.map.params as OverworldParams) ?? DEFAULT_OVERWORLD_PARAMS,
  );
  const [notes, setNotes] = useState(data.map.notes ?? "");
  const [placeName, setPlaceName] = useState("");
  const [placeBlurb, setPlaceBlurb] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Returns whether the change landed, so the add-a-place form below can
  // clear itself only on success. Existing callers ignore the result.
  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/overworld`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "That did not work.");
        return false;
      }
      onData(payload as OverworldData);
      return true;
    } finally {
      setBusy(false);
    }
  }

  // Manual place creation. The server has taken patch.places since the AI
  // describe flow shipped; only the UI never offered it outside that flow,
  // which left a DM unable to name a place without asking the model. A place
  // added here lands as a ghost marker and is anchored like any other.
  async function addPlace() {
    const name = placeName.trim();
    if (!name) {
      return;
    }
    if (await patch({ places: [{ name, blurb: placeBlurb.trim() }] })) {
      setPlaceName("");
      setPlaceBlurb("");
    }
  }

  async function describe() {
    setBusy(true);
    setError("");
    setPlan(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/overworld/describe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "The model had nothing for that.");
        return;
      }
      const described = (payload as { plan: Plan }).plan;
      setPlan(described);
      setParams(described.params);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-1.5 text-left text-xs font-medium uppercase tracking-wide text-stone-500 hover:text-stone-300"
      >
        <Wand2 className="size-3.5" />
        Shape the region
      </button>

      {open ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            placeholder="A chain of islands off a storm coast, pine forest inland."
            className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
          />
          <button
            type="button"
            disabled={busy || description.trim().length < 3}
            onClick={() => void describe()}
            className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
            Read it into the dials
          </button>
          {plan ? (
            <p className="text-[11px] text-stone-500">
              {plan.note || "Dials set."} Reroll below until the coastline falls where you want it.
            </p>
          ) : null}

          {(Object.keys(OVERWORLD_PARAM_LABELS) as Array<keyof OverworldParams>).map((key) => (
            <label key={key} className="flex items-center gap-2 text-[11px] text-stone-500">
              <span className="w-20 shrink-0">{OVERWORLD_PARAM_LABELS[key]}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(params[key] * 100)}
                onChange={(event) =>
                  setParams({ ...params, [key]: Number(event.target.value) / 100 })
                }
                className="flex-1 accent-amber-600"
              />
            </label>
          ))}

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void patch({ regenerate: true, params })}
              title="Reroll the terrain under these dials. Places, pins and notes stay."
              className="rounded-md border border-amber-700 bg-amber-950/50 px-2 py-1 text-xs text-amber-100 disabled:opacity-40"
            >
              Roll a world
            </button>
            {plan?.places.length ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void patch({ places: plan.places })}
                className={cn(
                  "rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300",
                  "hover:bg-stone-900 disabled:opacity-40",
                )}
              >
                Add {plan.places.length} place{plan.places.length === 1 ? "" : "s"}
              </button>
            ) : null}
          </div>
          {plan?.places.length ? (
            <ul className="space-y-0.5 text-[11px] text-stone-500">
              {plan.places.map((place) => (
                <li key={place.name}>
                  <span className="text-stone-300">{place.name}</span>
                  {place.blurb ? ` ${place.blurb}` : ""}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-stone-500">Add a place</span>
            <input
              value={placeName}
              maxLength={80}
              onChange={(event) => setPlaceName(event.target.value)}
              placeholder="The Salt Wharf"
              className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
            />
            <input
              value={placeBlurb}
              maxLength={300}
              onChange={(event) => setPlaceBlurb(event.target.value)}
              placeholder="What a traveller would say about it (optional)"
              className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
            />
            <button
              type="button"
              disabled={busy || !placeName.trim()}
              onClick={() => void addPlace()}
              className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40"
            >
              Put it on the map
            </button>
          </div>

          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-stone-500">
              Notes on the region
            </span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => {
                if (notes !== (data.map.notes ?? "")) {
                  void patch({ notes });
                }
              }}
              rows={2}
              placeholder="What lies past the edge. Which roads are watched."
              className="mt-0.5 w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
            />
            <span className="text-[10px] text-stone-600">Yours alone; players never see this.</span>
          </label>

          {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
