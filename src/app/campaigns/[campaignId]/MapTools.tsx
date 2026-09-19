"use client";

import { useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  BRUSHES,
  BRUSH_EFFECTS,
  BRUSH_LABELS,
  MAX_BRUSH_RADIUS,
  type Brush as BrushName,
} from "@/lib/battlemap/paint";
import {
  STAMPS,
  STAMP_EFFECTS,
  STAMP_LABELS,
  STAMP_SIZE,
  stampFootprint,
  stampStrokes,
  type StampKind,
} from "@/lib/battlemap/stamp";
import {
  BACKDROP_LIMITS,
  DEFAULT_BACKDROP_TRANSFORM,
  type Backdrop,
  type BackdropTransform,
} from "@/lib/battlemap/backdrop";
import { TERRAIN, TILE_FEET } from "@/lib/battlemap/types";
import { FLAT_TONES, FinePrint, RangeRow, Swatch, brushChar, mapButton, mapDanger } from "@/app/campaigns/[campaignId]/mapUi";

// The three paint dials a map editor needs, shared by the studio (which edits
// the board on the table) and the library (which edits maps in a drawer).
// Neither of them decides anything: every change here becomes a request the
// server validates.

const NIBS = [0, 1, 2, 3].filter((radius) => radius <= MAX_BRUSH_RADIUS);

// Six brushes as a list: the material the skin paints it with, its name, and
// what it costs a walker. A second press on the held brush lets it go.
export function BrushPalette({
  brush,
  onPick,
  radius,
  onRadius,
  swatches,
}: {
  brush: BrushName | "";
  onPick: (brush: BrushName | "") => void;
  // The square brush's reach in tiles either side of the centre, shown when
  // the caller can use one (a freehand brush can; a line cannot).
  radius?: number;
  onRadius?: (radius: number) => void;
  // Terrain character to the picture of the material the map's skin uses.
  swatches?: Record<string, string>;
}) {
  return (
    <div className="space-y-2">
      <ul data-pill-group="" className="space-y-1">
        {BRUSHES.map((option, index) => {
          const active = brush === option;
          return (
            <li key={option}>
              <button
                type="button"
                aria-pressed={active}
                data-on={active ? "" : undefined}
                title={`${BRUSH_EFFECTS[option]} (${index + 1})`}
                onClick={() => onPick(active ? "" : option)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left motion-press",
                  active
                    ? "border-amber-500/60 bg-amber-400/10 shadow-[0_0_14px_rgba(212,171,58,0.12)]"
                    : "border-stone-800 bg-stone-950/40 hover:border-stone-600",
                )}
              >
                <Swatch char={brushChar(option)} src={swatches?.[brushChar(option)]} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className={cn("flex items-center justify-between text-[12px]", active ? "text-amber-100" : "text-stone-200")}>
                    {BRUSH_LABELS[option]}
                    <span className="font-mono text-[8px] text-stone-600">{index + 1}</span>
                  </span>
                  <span className="block font-mono text-[9px] leading-tight text-stone-500">{BRUSH_EFFECTS[option]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {radius !== undefined && onRadius ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between font-display text-[9px] uppercase tracking-[0.18em] text-stone-500">
            Nib
            <span className="font-mono normal-case tracking-normal text-amber-200">
              {radius * 2 + 1} × {radius * 2 + 1} tiles
            </span>
          </div>
          <div data-pill-group="" className="grid grid-cols-4 gap-1">
            {NIBS.map((nib) => (
              <button data-on={radius === nib ? "" : undefined}
                key={nib}
                type="button"
                aria-pressed={radius === nib}
                aria-label={`${nib * 2 + 1} by ${nib * 2 + 1} tiles`}
                onClick={() => onRadius(nib)}
                className={cn(
                  "flex h-8 items-center justify-center rounded-md border motion-press",
                  radius === nib ? "border-amber-500/60 bg-amber-400/10" : "border-stone-800 bg-stone-950/40 hover:border-stone-600",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn("rounded-[2px]", radius === nib ? "bg-amber-300" : "bg-stone-500")}
                  style={{ width: 4 + nib * 4, height: 4 + nib * 4 }}
                />
              </button>
            ))}
          </div>
          {/* The slider stays for the keyboard: arrow keys walk the same four sizes. */}
          <RangeRow label="Size" min={0} max={MAX_BRUSH_RADIUS} value={radius} readout={`${radius * 2 + 1}x${radius * 2 + 1}`} onChange={onRadius} />
        </div>
      ) : null}
      <FinePrint>
        {brush ? "Drag across the map. Every stroke is checked before it lands." : "Pick a brush, then drag on the map."}
      </FinePrint>
    </div>
  );
}

// What a stamp lays down, drawn small: the same strokes the server compiles.
function StampPreview({ kind, swatches }: { kind: StampKind; swatches?: Record<string, string> }) {
  const cells = useMemo(() => {
    const stamp = { kind, x: 4, y: 3, width: 5, height: 4 };
    const box = stampFootprint(stamp);
    const across = box.x1 - box.x0 + 1;
    const down = box.y1 - box.y0 + 1;
    const grid: string[] = new Array(across * down).fill("");
    for (const stroke of stampStrokes(stamp)) {
      const x = stroke.x - box.x0;
      const y = stroke.y - box.y0;
      if (x >= 0 && y >= 0 && x < across && y < down) {
        grid[y * across + x] = TERRAIN[stroke.brush];
      }
    }
    return { grid, across };
  }, [kind]);
  return (
    <span
      aria-hidden="true"
      className="grid w-full gap-px overflow-hidden rounded-[3px] bg-black/40"
      style={{ gridTemplateColumns: `repeat(${cells.across}, 1fr)` }}
    >
      {cells.grid.map((char, index) => (
        <span
          key={index}
          className="aspect-square bg-cover"
          style={
            char
              ? { backgroundColor: FLAT_TONES[char], backgroundImage: swatches?.[char] ? `url("${swatches[char]}")` : undefined }
              : { backgroundColor: "transparent" }
          }
        />
      ))}
    </span>
  );
}

export function StampPalette({
  stamp,
  size,
  onPick,
  onResize,
  swatches,
}: {
  stamp: StampKind | "";
  size: { width: number; height: number };
  onPick: (stamp: StampKind | "") => void;
  onResize: (size: { width: number; height: number }) => void;
  swatches?: Record<string, string>;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1">
        {STAMPS.map((option) => {
          const active = stamp === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              title={STAMP_EFFECTS[option]}
              onClick={() => onPick(active ? "" : option)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border p-1.5 motion-press",
                active ? "border-amber-500/60 bg-amber-400/10" : "border-stone-800 bg-stone-950/40 hover:border-stone-600",
              )}
            >
              <StampPreview kind={option} swatches={swatches} />
              <span className={cn("text-[10px] leading-tight", active ? "text-amber-100" : "text-stone-300")}>{STAMP_LABELS[option]}</span>
            </button>
          );
        })}
      </div>
      {stamp ? (
        <>
          <FinePrint>{STAMP_EFFECTS[stamp]}</FinePrint>
          {(["width", "height"] as const).map((side) => (
            <RangeRow
              key={side}
              label={side === "width" ? "Across" : "Down"}
              min={STAMP_SIZE.min}
              max={STAMP_SIZE.max}
              value={size[side]}
              readout={`${size[side] * TILE_FEET}ft`}
              onChange={(value) => onResize({ ...size, [side]: value })}
            />
          ))}
          <FinePrint>Click once on the map. The outline shows where it will land.</FinePrint>
        </>
      ) : (
        <FinePrint>Rooms and corridors in one click, drawn in the same five tiles the rules read.</FinePrint>
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
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 font-display text-[9px] uppercase tracking-[0.18em] text-stone-500">
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
        <button type="button" disabled={uploading || busy} onClick={() => fileRef.current?.click()} className={mapButton}>
          {uploading ? <Loader2 className="size-3 animate-spin" /> : <ImageIcon className="size-3" />}
          {backdrop ? "Replace it" : "Add a picture"}
        </button>
        {backdrop ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChange({ path: "", transform: DEFAULT_BACKDROP_TRANSFORM })}
            className={mapDanger}
          >
            <Trash2 className="size-3" /> Take it away
          </button>
        ) : null}
      </div>

      {backdrop ? (
        <>
          <div className="space-y-1">
            <RangeRow
              label="Across"
              min={-BACKDROP_LIMITS.maxOffset}
              max={BACKDROP_LIMITS.maxOffset}
              step={0.25}
              value={transform.offsetX}
              readout={String(transform.offsetX)}
              onChange={(offsetX) => set({ offsetX })}
            />
            <RangeRow
              label="Down"
              min={-BACKDROP_LIMITS.maxOffset}
              max={BACKDROP_LIMITS.maxOffset}
              step={0.25}
              value={transform.offsetY}
              readout={String(transform.offsetY)}
              onChange={(offsetY) => set({ offsetY })}
            />
            <RangeRow
              label="Size"
              min={BACKDROP_LIMITS.minScale}
              max={BACKDROP_LIMITS.maxScale}
              step={0.01}
              value={transform.scale}
              readout={`${Math.round(transform.scale * 100)}%`}
              onChange={(scale) => set({ scale })}
            />
            <RangeRow
              label="Strength"
              min={0}
              max={1}
              step={0.05}
              value={transform.opacity}
              readout={`${Math.round(transform.opacity * 100)}%`}
              onChange={(opacity) => set({ opacity })}
            />
          </div>
          <FinePrint>
            The picture is scenery. The walls that stop a rogue are the ones painted into the
            terrain, so line the two up and check them before anyone plays on it.
          </FinePrint>
        </>
      ) : null}
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </div>
  );
}
