"use client";

import { Check, Minus, Plus, Settings2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { KitButton } from "@/app/campaigns/[campaignId]/PanelKit";
import { LoreImageField } from "@/app/workshop/lore/LoreFields";
import type { FramePlan, DeletePlan } from "@/lib/db/atlas-edit";
import type { AtlasTarget } from "@/lib/worldforge/atlas-edit";
import { frameOf } from "@/lib/worldforge/atlas-frame";
import { ATLAS_SURFACE, type AtlasMap, type MapFit, type XY } from "@/lib/worldforge/model";
import { isUploadedImagePath } from "@/lib/uploads";
import { PlacementList, type AtlasRegion } from "./AtlasRegion";
import type { WorldApi } from "./useWorld";

// Editing the Atlas after the first click (audit finding WF-20): a map's
// settings and how its picture sits in its box, positions typed as numbers
// so a keyboard can do what a pointer does, and deletes that say what they
// touch first and can be taken back. A save that fails keeps what was
// typed, with the reason and a way to try again.

// ---- positions as numbers ----

const percent = (value: number) => Math.round(value * 1000) / 10;

// A point on the map as two numbers: how far across and how far down, in
// percent of the box. Saved when a field is left or Enter is pressed.
export function PointFields({ at, label, onCommit }: { at: XY; label: string; onCommit: (to: XY) => void }) {
  const [draft, setDraft] = useState({ x: String(percent(at.x)), y: String(percent(at.y)) });
  const [shown, setShown] = useState(at);
  if (shown.x !== at.x || shown.y !== at.y) {
    // Moved elsewhere (a drag, an arrow key): the fields follow.
    setShown(at);
    setDraft({ x: String(percent(at.x)), y: String(percent(at.y)) });
  }
  const commit = () => {
    const x = Number(draft.x);
    const y = Number(draft.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const to = { x: Math.min(100, Math.max(0, x)) / 100, y: Math.min(100, Math.max(0, y)) / 100 };
    if (Math.abs(to.x - at.x) > 1e-4 || Math.abs(to.y - at.y) > 1e-4) onCommit(to);
  };
  const field = (axis: "x" | "y", name: string) => (
    <label className="flex items-center gap-1 text-[11px] text-stone-500">
      {name}
      <input
        className={cn(ui.input, "w-16 py-0.5 text-xs")}
        type="number"
        min={0}
        max={100}
        step={0.1}
        inputMode="decimal"
        aria-label={`${label}: ${axis === "x" ? "across" : "down"} (percent)`}
        value={draft[axis]}
        onChange={(event) => setDraft({ ...draft, [axis]: event.target.value })}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
      %
    </label>
  );
  return (
    <span className="flex flex-wrap items-center gap-2" data-testid="atlas-point">
      {field("x", "Across")}
      {field("y", "Down")}
    </span>
  );
}

// A region's corners, each as numbers, with corners to add and take away.
export function CornerEditor({ points, onSave }: { points: XY[]; onSave: (points: XY[]) => void }) {
  const add = () => {
    const last = points[points.length - 1];
    const first = points[0];
    onSave([...points, { x: (last.x + first.x) / 2, y: (last.y + first.y) / 2 }]);
  };
  return (
    <details className="text-xs text-stone-300" data-testid="region-corners">
      <summary className="cursor-pointer text-[11px] text-stone-500">Corners ({points.length}), as numbers</summary>
      <ol className="mt-1 flex flex-col gap-1">
        {points.map((point, index) => (
          <li key={index} className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 text-[11px] text-stone-500">Corner {index + 1}</span>
            <PointFields at={point} label={`Corner ${index + 1}`} onCommit={(to) => onSave(points.map((entry, at) => (at === index ? to : entry)))} />
            {points.length > 3 ? (
              <KitButton tone="icon" always aria-label={`Take away corner ${index + 1}`} onClick={() => onSave(points.filter((_, at) => at !== index))}>
                <Minus className="size-3.5" />
              </KitButton>
            ) : null}
          </li>
        ))}
      </ol>
      <KitButton tone="link" onClick={add}>
        <Plus className="size-3.5" /> Add a corner
      </KitButton>
    </details>
  );
}

// ---- a failed save ----

export function NotSaved({ onRetry, what = "Your changes" }: { onRetry: () => void; what?: string }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-[11px] text-ember-300" role="alert" data-testid="atlas-not-saved">
      Not saved. {what} are still here.
      <KitButton tone="small" onClick={onRetry}>
        Try again
      </KitButton>
    </p>
  );
}

// ---- a map's settings ----

type Shape = "wide" | "picture" | "custom";

export function MapSettings({ api, atlas, region, onClose }: { api: WorldApi; atlas: AtlasMap; region: AtlasRegion; onClose: () => void }) {
  const frame = frameOf(atlas);
  const [draft, setDraft] = useState({ name: atlas.name, image: atlas.image });
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fit, setFit] = useState<MapFit>(frame.fit);
  const startShape: Shape = Math.abs(frame.surface - ATLAS_SURFACE) < 1e-3 ? "wide" : frame.image && Math.abs(frame.surface - frame.image) < 1e-3 ? "picture" : "custom";
  const [shape, setShape] = useState<Shape>(startShape);
  const [ratio, setRatio] = useState({ w: String(Math.round(frame.surface * 100) / 100), h: "1" });
  const [carry, setCarry] = useState(true);
  const [plan, setPlan] = useState<FramePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const uploaded = isUploadedImagePath(atlas.image);
  const custom = Number(ratio.w) / Number(ratio.h);
  const surface = shape === "wide" ? ATLAS_SURFACE : shape === "picture" ? "picture" : custom;
  const surfaceOk = surface === "picture" || (Number.isFinite(surface) && surface >= 0.1 && surface <= 10);
  const changedText = draft.name.trim() !== atlas.name || draft.image !== atlas.image;

  async function saveText() {
    if (!draft.name.trim()) return;
    setSaving(true);
    const latest = api.world?.doc.maps ?? [];
    const ok = await api.patch({ maps: latest.map((entry) => (entry.id === atlas.id ? { ...entry, name: draft.name.trim(), image: draft.image } : entry)) });
    setSaving(false);
    setFailed(!ok);
    if (ok) region.setNotice({ text: `Saved ${draft.name.trim()}.` });
  }

  async function review(apply: boolean) {
    if (!surfaceOk) return;
    setBusy(true);
    try {
      const answer = (await api.atlasStep("frame", { mapId: atlas.id, fit, surface, carry, apply })) as FramePlan | null;
      if (!answer) return;
      if (!apply) setPlan(answer);
      else {
        setPlan(null);
        region.setNotice({ text: `${atlas.name} now sits in its new box.${answer.placements.length ? ` ${answer.placements.length === 1 ? "One place" : `${answer.placements.length} places`} moved with ${answer.placements.length === 1 ? "its pin" : "their pins"} on the Region.` : ""}` });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel motion-pop flex flex-col gap-3 rounded-lg p-3 text-xs text-stone-300" role="region" aria-label={`Settings for ${atlas.name}`} data-testid="atlas-settings">
      <div className="flex items-center gap-2">
        <Settings2 className="size-4 text-amber-400/80" />
        <span className="text-sm text-amber-100">Map settings</span>
        <KitButton tone="icon" always className="ml-auto" aria-label="Close the settings" onClick={onClose}>
          <X className="size-4" />
        </KitButton>
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void saveText();
        }}
      >
        <input className={ui.input} aria-label="Map name" maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <LoreImageField imagePath={draft.image} onChange={(image) => setDraft({ ...draft, image })} />
        {draft.image !== atlas.image && atlas.role === "region" ? (
          <p className="text-[11px] text-stone-400">The Region keeps showing the old picture until you use this map as the Region backdrop again.</p>
        ) : null}
        {failed ? <NotSaved onRetry={() => void saveText()} /> : null}
        <span className="flex justify-end">
          <KitButton tone="primary" type="submit" busy={saving} disabled={saving || !changedText || !draft.name.trim()} data-testid="atlas-settings-save">
            {saving ? null : <Check className="size-3.5" />} Save name and picture
          </KitButton>
        </span>
      </form>

      <fieldset className="flex flex-col gap-1.5 border-t border-stone-800 pt-2">
        <legend className="eyebrow text-[10px] text-stone-500">How the picture sits</legend>
        <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="How the picture fills the box">
          {(
            [
              ["cover", "Fill the box (crops the picture)"],
              ["contain", "Show the whole picture"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1.5">
              <input type="radio" name={`fit-${atlas.id}`} checked={fit === value} onChange={() => { setFit(value); setPlan(null); }} /> {label}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3" role="radiogroup" aria-label="The box's shape">
          <label className="flex items-center gap-1.5">
            <input type="radio" name={`shape-${atlas.id}`} checked={shape === "wide"} onChange={() => { setShape("wide"); setPlan(null); }} /> Wide, 16:10
          </label>
          {uploaded ? (
            <label className="flex items-center gap-1.5">
              <input type="radio" name={`shape-${atlas.id}`} checked={shape === "picture"} onChange={() => { setShape("picture"); setPlan(null); }} data-testid="atlas-shape-picture" /> The picture&apos;s own shape
            </label>
          ) : null}
          <label className="flex items-center gap-1.5">
            <input type="radio" name={`shape-${atlas.id}`} checked={shape === "custom"} onChange={() => { setShape("custom"); setPlan(null); }} /> Width to height
          </label>
          {shape === "custom" ? (
            <span className="flex items-center gap-1">
              <input className={cn(ui.input, "w-16 py-0.5 text-xs")} type="number" min={0.1} step={0.1} aria-label="Box width" value={ratio.w} onChange={(event) => { setRatio({ ...ratio, w: event.target.value }); setPlan(null); }} />
              :
              <input className={cn(ui.input, "w-16 py-0.5 text-xs")} type="number" min={0.1} step={0.1} aria-label="Box height" value={ratio.h} onChange={(event) => { setRatio({ ...ratio, h: event.target.value }); setPlan(null); }} />
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-1" role="radiogroup" aria-label="What the pins do">
          <label className="flex items-center gap-1.5">
            <input type="radio" name={`carry-${atlas.id}`} checked={carry} onChange={() => { setCarry(true); setPlan(null); }} /> Pins and regions stay on the same spots of the picture
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name={`carry-${atlas.id}`} checked={!carry} onChange={() => { setCarry(false); setPlan(null); }} /> They stay where they are in the box
          </label>
        </div>
        {plan ? (
          <div className="flex flex-col gap-1 rounded-md border border-stone-700/60 p-2" data-testid="atlas-frame-review">
            <p>
              {plan.moved ? `${plan.moved} ${plan.moved === 1 ? "pin or corner moves" : "pins and corners move"} in the box to stay on the picture.` : "No pin or corner moves in the box."}
              {plan.outside ? ` ${plan.outside} of them fall outside the new box and wait at its nearest edge.` : ""}
            </p>
            {plan.placements.length ? <PlacementList placements={plan.placements} /> : null}
            {plan.notes.map((note) => (
              <p key={note} className="text-stone-400">{note}</p>
            ))}
          </div>
        ) : null}
        <span className="flex justify-end gap-1.5">
          {plan ? (
            <>
              <KitButton tone="small" onClick={() => setPlan(null)}>Cancel</KitButton>
              <KitButton tone="primary" busy={busy} disabled={busy} onClick={() => void review(true)} data-testid="atlas-frame-apply">
                {busy ? null : <Check className="size-3.5" />} Change it
              </KitButton>
            </>
          ) : (
            <KitButton tone="small" busy={busy} disabled={busy || !surfaceOk} onClick={() => void review(false)} data-testid="atlas-frame-review-button">
              Review the change
            </KitButton>
          )}
        </span>
      </fieldset>
    </div>
  );
}

// ---- deleting, with a review first and an undo after ----

export type DeleteAsk = { target: AtlasTarget; plan: DeletePlan };

export function useAtlasDelete(api: WorldApi, region: AtlasRegion) {
  const [ask, setAsk] = useState<DeleteAsk | null>(null);
  const [busy, setBusy] = useState(false);

  const review = async (target: AtlasTarget) => {
    setBusy(true);
    try {
      const plan = (await api.atlasStep("delete", { target })) as DeletePlan | null;
      if (plan) setAsk({ target, plan });
    } finally {
      setBusy(false);
    }
  };

  // Resolves true once deleted.
  const confirm = async () => {
    if (!ask) return false;
    setBusy(true);
    try {
      const done = (await api.atlasStep("delete", { target: ask.target, apply: true })) as DeletePlan | null;
      if (!done?.applied) return false;
      const token = done.undo;
      region.setNotice({
        text: `Deleted ${done.impact.name}.`,
        undo: token
          ? async () => {
              const back = (await api.atlasStep("restore", { undo: token })) as { skipped?: string[] } | null;
              if (back?.skipped?.length) region.setNotice({ text: back.skipped.join(" ") });
            }
          : undefined,
      });
      setAsk(null);
      return true;
    } finally {
      setBusy(false);
    }
  };

  return { ask, busy, review, confirm, cancel: () => setAsk(null) };
}

export function DeleteReview({ remover, onDeleted }: { remover: ReturnType<typeof useAtlasDelete>; onDeleted: (target: AtlasTarget) => void }) {
  const { ask } = remover;
  if (!ask) return null;
  const { impact, notes } = ask.plan;
  const what = impact.kind === "map" ? "the map" : impact.kind === "pin" ? "the pin" : "the region";
  const lines: string[] = [];
  if (impact.kind === "map") lines.push(impact.pins ? `Its ${impact.pins === 1 ? "pin goes" : `${impact.pins} pins go`} with it.` : "It has no pins.");
  if (impact.openers.length) lines.push(`${impact.openers.length === 1 ? "A pin on another map opens" : `${impact.openers.length} pins on other maps open`} it and will open nothing: ${impact.openers.join(", ")}.`);
  if (impact.nested.length) lines.push(`Drawn inside ${impact.kind === "pin" ? "this pin" : "its pins"}, and moving to the top of the list: ${impact.nested.join(", ")}.`);
  if (impact.bound) lines.push(`${impact.bound === 1 ? "A pin that moves its place" : `${impact.bound} pins that move their places`} on the Region ${impact.bound === 1 ? "goes" : "go"}. The places stay where they are.`);
  if (impact.kind === "pin" && !lines.length) lines.push("Nothing else is touched.");
  return (
    <div className="panel motion-pop flex flex-col gap-2 rounded-lg border border-ember-700/40 p-3 text-xs text-stone-300" role="dialog" aria-label={`Delete ${what} ${impact.name}?`} data-testid="atlas-delete-review">
      <span className="text-sm text-amber-100">
        Delete {what} {impact.name}?
      </span>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {notes.map((note) => (
        <p key={note} className="text-stone-400">{note}</p>
      ))}
      <p className="text-stone-500">You can undo it straight after.</p>
      <span className="flex justify-end gap-1.5">
        <KitButton tone="small" onClick={remover.cancel}>Cancel</KitButton>
        <KitButton
          tone="danger"
          busy={remover.busy}
          disabled={remover.busy}
          data-testid="atlas-delete-confirm"
          onClick={async () => {
            const target = ask.target;
            if (await remover.confirm()) onDeleted(target);
          }}
        >
          {remover.busy ? null : <Trash2 className="size-3.5" />} Delete
        </KitButton>
      </span>
    </div>
  );
}
