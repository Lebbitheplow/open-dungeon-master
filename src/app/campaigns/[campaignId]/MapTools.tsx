"use client";

import { useRef, useState } from "react";
import { Brush, Image as ImageIcon, Loader2, Shapes, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { BRUSHES, BRUSH_EFFECTS, BRUSH_LABELS, type Brush as BrushName } from "@/lib/battlemap/paint";
import { STAMPS, STAMP_EFFECTS, STAMP_LABELS, STAMP_SIZE, type StampKind } from "@/lib/battlemap/stamp";
import {
  BACKDROP_LIMITS,
  DEFAULT_BACKDROP_TRANSFORM,
  type Backdrop,
  type BackdropTransform,
} from "@/lib/battlemap/backdrop";

// The three tool bars a map editor needs, shared by the studio (which edits
// the board on the table) and the library (which edits maps in a drawer).
// Neither of them decides anything: every change here becomes a request the
// server validates.

export function BrushPalette({
  brush,
  onPick,
}: {
  brush: BrushName | "";
  onPick: (brush: BrushName | "") => void;
}) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-stone-500">
        <Brush className="size-3.5" /> Paint the ground
      </p>
      <div className="flex flex-wrap gap-1">
        {BRUSHES.map((option) => (
          <button
            key={option}
            type="button"
            title={BRUSH_EFFECTS[option]}
            onClick={() => onPick(brush === option ? "" : option)}
            className={cn(
              "rounded-md border px-2 py-0.5 text-[11px]",
              brush === option
                ? "border-amber-700 bg-amber-950/50 text-amber-100"
                : "border-stone-700 text-stone-400 hover:text-stone-200",
            )}
          >
            {BRUSH_LABELS[option]}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-stone-600">
        {brush
          ? "Drag across the map above. Every stroke is checked before it lands."
          : "Pick a brush, then drag on the map."}
      </p>
    </div>
  );
}

export function StampPalette({
  stamp,
  size,
  onPick,
  onResize,
}: {
  stamp: StampKind | "";
  size: { width: number; height: number };
  onPick: (stamp: StampKind | "") => void;
  onResize: (size: { width: number; height: number }) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-stone-500">
        <Shapes className="size-3.5" /> Stamp a shape
      </p>
      <div className="flex flex-wrap gap-1">
        {STAMPS.map((option) => (
          <button
            key={option}
            type="button"
            title={STAMP_EFFECTS[option]}
            onClick={() => onPick(stamp === option ? "" : option)}
            className={cn(
              "rounded-md border px-2 py-0.5 text-[11px]",
              stamp === option
                ? "border-amber-700 bg-amber-950/50 text-amber-100"
                : "border-stone-700 text-stone-400 hover:text-stone-200",
            )}
          >
            {STAMP_LABELS[option]}
          </button>
        ))}
      </div>
      {stamp ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
            {(["width", "height"] as const).map((side) => (
              <label key={side} className="flex items-center gap-1">
                {side === "width" ? "Across" : "Down"}
                <input
                  type="range"
                  min={STAMP_SIZE.min}
                  max={STAMP_SIZE.max}
                  value={size[side]}
                  onChange={(event) =>
                    onResize({ ...size, [side]: Number(event.target.value) })
                  }
                  className="w-20 accent-amber-500"
                />
                <span className="w-10 tabular-nums text-stone-400">{size[side] * 5}ft</span>
              </label>
            ))}
          </div>
          <p className="text-[10px] text-stone-600">
            Click once on the map. The outline shows where it will land.
          </p>
        </>
      ) : (
        <p className="text-[10px] text-stone-600">
          Rooms and corridors in one click, drawn in the same five tiles the rules read.
        </p>
      )}
    </div>
  );
}

// Uploading the picture, then nudging it into register with the walls.
// The upload goes through /api/upload, which is the one place in this app
// that turns bytes into a file and the one place that decides what an image
// is; this component only ever handles the path that comes back.
export function BackdropControls({
  backdrop,
  onChange,
  busy,
}: {
  backdrop: Backdrop | null;
  onChange: (next: { path: string; transform: BackdropTransform }) => void;
  busy?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const transform = backdrop?.transform ?? DEFAULT_BACKDROP_TRANSFORM;

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
      onChange({ path: payload.url, transform });
    } catch {
      setError("That image would not upload.");
    } finally {
      setUploading(false);
    }
  }

  const set = (patch: Partial<BackdropTransform>) =>
    onChange({ path: backdrop?.path ?? "", transform: { ...transform, ...patch } });

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-stone-500">
        <ImageIcon className="size-3.5" /> Picture under the grid
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
          {backdrop ? "Replace it" : "Add a picture"}
        </button>
        {backdrop ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChange({ path: "", transform: DEFAULT_BACKDROP_TRANSFORM })}
            className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:bg-stone-900 disabled:opacity-50"
          >
            <Trash2 className="size-3" /> Take it away
          </button>
        ) : null}
      </div>

      {backdrop ? (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-stone-500">
            <label className="flex items-center gap-1">
              Across
              <input
                type="range"
                min={-BACKDROP_LIMITS.maxOffset}
                max={BACKDROP_LIMITS.maxOffset}
                step={0.25}
                value={transform.offsetX}
                onChange={(event) => set({ offsetX: Number(event.target.value) })}
                className="w-full accent-amber-500"
              />
            </label>
            <label className="flex items-center gap-1">
              Down
              <input
                type="range"
                min={-BACKDROP_LIMITS.maxOffset}
                max={BACKDROP_LIMITS.maxOffset}
                step={0.25}
                value={transform.offsetY}
                onChange={(event) => set({ offsetY: Number(event.target.value) })}
                className="w-full accent-amber-500"
              />
            </label>
            <label className="flex items-center gap-1">
              Size
              <input
                type="range"
                min={BACKDROP_LIMITS.minScale}
                max={BACKDROP_LIMITS.maxScale}
                step={0.01}
                value={transform.scale}
                onChange={(event) => set({ scale: Number(event.target.value) })}
                className="w-full accent-amber-500"
              />
            </label>
            <label className="flex items-center gap-1">
              Strength
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={transform.opacity}
                onChange={(event) => set({ opacity: Number(event.target.value) })}
                className="w-full accent-amber-500"
              />
            </label>
          </div>
          <p className="text-[10px] text-stone-600">
            The picture is scenery. The walls that stop a rogue are the ones painted into the
            terrain, so line the two up and check them before anyone plays on it.
          </p>
        </>
      ) : null}
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </div>
  );
}
