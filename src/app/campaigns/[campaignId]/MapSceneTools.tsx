"use client";

import { useRef, useState } from "react";
import { Image as ImageIcon, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { cueOptions } from "@/lib/ambience/catalog";
import { SCENE_LIMITS, type SceneAmbience } from "@/lib/battlemap/scene";
import type { AmbientLight } from "@/lib/battlemap/types";

// The dials for the scene tools (docs/workshop-parity-audit.md phase 13):
// what the next label says, what the next prop is called, which light a
// zone casts, the sound a map makes, and the DM's overlay picture. None of
// them touch a map; the toolbox holds the values and the canvas reports the
// tap that uses them.

const input =
  "rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 focus:border-amber-500/50 focus:outline-none";

export function LabelDial({
  value,
  onChange,
  count,
  onClear,
}: {
  value: { text: string; dmOnly: boolean };
  onChange: (next: { text: string; dmOnly: boolean }) => void;
  count: number;
  onClear?: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={value.text}
          maxLength={SCENE_LIMITS.labelText}
          placeholder="1. Entry hall"
          aria-label="Label text"
          onChange={(event) => onChange({ ...value, text: event.target.value })}
          className={cn(input, "min-w-40 flex-1")}
        />
        <label className="flex items-center gap-1 text-[11px] text-stone-400">
          <input
            type="checkbox"
            checked={value.dmOnly}
            onChange={(event) => onChange({ ...value, dmOnly: event.target.checked })}
            className="accent-amber-500"
          />
          Only I see it
        </label>
        {count && onClear ? (
          <button type="button" onClick={onClear} className="rounded-md border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:text-red-300">
            Clear all {count}
          </button>
        ) : null}
      </div>
      <p className="text-[10px] text-stone-600">
        Tap a tile to put the label there; tap a labelled tile to take it away. Players see the ones
        not marked for you, and only where they have been.
      </p>
    </div>
  );
}

export function PropDial({
  value,
  onChange,
  count,
}: {
  value: { name: string; kind: "prop" | "npc" };
  onChange: (next: { name: string; kind: "prop" | "npc" }) => void;
  count: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={value.name}
          maxLength={SCENE_LIMITS.propName}
          placeholder={value.kind === "npc" ? "Innkeeper" : "Barrel"}
          aria-label="Prop name"
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          className={cn(input, "min-w-40 flex-1")}
        />
        <span className="flex gap-1">
          {(["prop", "npc"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={value.kind === kind}
              onClick={() => onChange({ ...value, kind })}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px]",
                value.kind === kind ? "border-amber-700 bg-amber-950/50 text-amber-100" : "border-stone-700 text-stone-400",
              )}
            >
              {kind === "prop" ? "A thing" : "A bystander"}
            </button>
          ))}
        </span>
      </div>
      <p className="text-[10px] text-stone-600">
        Furniture and bystanders go on the table with the map as the DM&apos;s own tokens; nothing in the
        rules can target them. {count ? `${count} placed.` : ""} Up to {SCENE_LIMITS.props}.
      </p>
    </div>
  );
}

export function ZoneDial({
  value,
  onChange,
  count,
  onClear,
}: {
  value: AmbientLight;
  onChange: (next: AmbientLight) => void;
  count: number;
  onClear?: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        {(
          [
            ["bright", "Lit"],
            ["dim", "Dim"],
            ["dark", "Dark"],
          ] as const
        ).map(([ambient, label]) => (
          <button
            key={ambient}
            type="button"
            aria-pressed={value === ambient}
            onClick={() => onChange(ambient)}
            className={cn(
              "rounded-md border px-2 py-0.5 text-[11px]",
              value === ambient ? "border-amber-700 bg-amber-950/50 text-amber-100" : "border-stone-700 text-stone-400",
            )}
          >
            {label}
          </button>
        ))}
        {count && onClear ? (
          <button type="button" onClick={onClear} className="ml-2 rounded-md border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:text-red-300">
            Clear all {count}
          </button>
        ) : null}
      </div>
      <p className="text-[10px] text-stone-600">
        Drag a box. The light inside it overrides the map&apos;s: a lit shrine in a dark crypt, a dark alcove
        in a bright hall. Later boxes win where they overlap. Up to {SCENE_LIMITS.zones}.
      </p>
    </div>
  );
}

export function DoorHint() {
  return (
    <p className="text-[10px] text-stone-600">
      Tap a door to lock it, again to make it secret, again to open it. A locked or secret door is a
      wall to everything that walks or looks until you open it; only you see which is which.
    </p>
  );
}

export function AmbienceControls({
  value,
  onChange,
}: {
  value: SceneAmbience;
  onChange: (next: SceneAmbience) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-wide text-stone-500">What it sounds like</p>
      <div className="flex flex-wrap gap-1.5">
        <select
          value={value.bed}
          aria-label="Ambient bed"
          onChange={(event) => onChange({ ...value, bed: event.target.value })}
          className={input}
        >
          <option value="">Leave the place sound alone</option>
          {cueOptions("bed").map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={value.music}
          aria-label="Music"
          onChange={(event) => onChange({ ...value, music: event.target.value })}
          className={input}
        >
          <option value="">Leave the music alone</option>
          {cueOptions("music").map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <p className="text-[10px] text-stone-600">Played when this map goes on the table.</p>
    </div>
  );
}

// The DM's overlay: the annotated version of the same picture, drawn in the
// same register as the backdrop and never sent to a player.
export function OverlayControls({
  overlayPath,
  busy,
  onChange,
}: {
  overlayPath: string;
  busy?: boolean;
  onChange: (path: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, name: file.name, type: file.type }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "That image would not upload.");
        return;
      }
      onChange(payload.url);
    } catch {
      setError("That image would not upload.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-stone-500">
        <ImageIcon className="size-3.5" /> Your own overlay
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void upload(file);
            }
            event.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={uploading || busy}
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="size-3 animate-spin" /> : <ImageIcon className="size-3" />}
          {overlayPath ? "Replace it" : "Add the annotated picture"}
        </button>
        {overlayPath ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChange("")}
            className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:bg-stone-900 disabled:opacity-50"
          >
            <Trash2 className="size-3" /> Take it away
          </button>
        ) : null}
      </div>
      <p className="text-[10px] text-stone-600">
        Drawn over the map in the same register as the picture under it, for your eyes only: the
        version with the trap markings and the room numbers.
      </p>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </div>
  );
}
