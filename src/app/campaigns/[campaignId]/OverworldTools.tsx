"use client";

import {
  Brush,
  Download,
  Eraser,
  FileUp,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Move,
  PenLine,
  RefreshCw,
  Trash2,
  Type,
  Users,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { OverworldTile, TileSkin } from "@/lib/overworld/logic";
import {
  MAX_BRUSH_RADIUS,
  OVERWORLD_BRUSHES,
  OVERWORLD_BRUSH_LABELS,
  OVERWORLD_BRUSH_TILES,
  type OverworldBrush,
} from "@/lib/overworld/paint";
import {
  FEATURE_LIMITS,
  OVERWORLD_SIZES,
  PATH_KINDS,
  PATH_KIND_LABELS,
  type LabelSize,
  type OverworldSize,
  type PathKind,
} from "@/lib/overworld/features";

// The region map's toolbars (docs/workshop-parity-audit.md phase 15). Each
// is a small stateless strip; OverworldPanel holds the state and decides
// what a tap on the canvas means under the mode chosen here.

// What the panel's own dialog asks for, by what a tap meant.
export type OverworldAsk =
  | { kind: "pin"; at: { x: number; y: number } }
  | { kind: "rename"; locationId: string }
  | { kind: "label"; at: { x: number; y: number } };

export function askCopy(
  ask: OverworldAsk | null,
  labelSize: LabelSize,
  heldName: string,
): { title: string; label: string; defaultValue: string; maxLength: number; allowEmpty: boolean; submitLabel: string } {
  if (ask?.kind === "rename") {
    return {
      title: "Rename this place",
      label: "What is this place called?",
      defaultValue: heldName,
      maxLength: 80,
      allowEmpty: false,
      submitLabel: "Rename",
    };
  }
  if (ask?.kind === "label") {
    return {
      title: labelSize === "large" ? "Name the region" : "Name the place",
      label: "The words written on the map here.",
      defaultValue: "",
      maxLength: FEATURE_LIMITS.labelLength,
      allowEmpty: false,
      submitLabel: "Write it",
    };
  }
  return {
    title: "Label the pin",
    label: "Leave it empty for a plain marker.",
    defaultValue: "",
    maxLength: 60,
    allowEmpty: true,
    submitLabel: "Place the pin",
  };
}

type ImportSummary = { cells: number; places: number; rivers: number; routes: number };

// Sends the GeoJSON texts to the import route and says what it read.
export async function importAzgaarFiles<Data extends { map: { width: number; height: number } }>(
  campaignId: string,
  files: string[],
  size: OverworldSize,
): Promise<{ data: Data; note: string } | { error: string }> {
  const response = await fetch(`/api/campaigns/${campaignId}/overworld/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files, ...size }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { error: (payload as { error?: string }).error ?? "That map could not be read." };
  }
  const { summary, ...data } = payload as Data & { summary: ImportSummary };
  return {
    data: data as unknown as Data,
    note: `Read ${summary.cells} cells into a ${data.map.width} by ${data.map.height} map, with ${summary.places} places, ${summary.routes} roads and ${summary.rivers} rivers.`,
  };
}

export type OverworldMode =
  | "look"
  | "pin"
  | "party"
  | "place"
  | "paint"
  | "line"
  | "label"
  | "erase";

const chip = "flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]";
const idle = "border-stone-700 text-stone-400 hover:bg-stone-900";
const active = "border-amber-700 bg-amber-950/50 text-amber-200";

const MODES = [
  ["pin", "Add pin", MapPin],
  ["party", "Place the party", Users],
  ["place", "Move a place", Move],
  ["paint", "Paint terrain", Brush],
  ["line", "Draw a line", PenLine],
  ["label", "Write a label", Type],
  ["erase", "Erase", Eraser],
] as const;

export function ModeBar({
  mode,
  onMode,
  partyPlaced,
  onPartyTransit,
  pinsCount,
  onClearPins,
  regenBusy,
  onRegenerate,
}: {
  mode: OverworldMode;
  onMode: (mode: OverworldMode) => void;
  partyPlaced: boolean;
  onPartyTransit: () => void;
  pinsCount: number;
  onClearPins: () => void;
  regenBusy: boolean;
  onRegenerate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {MODES.map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => onMode(mode === value ? "look" : value)}
          className={cn(chip, mode === value ? active : idle)}
        >
          <Icon className="size-3" /> {mode === value ? "Tap the map..." : label}
        </button>
      ))}
      {partyPlaced ? (
        <button type="button" onClick={onPartyTransit} className={cn(chip, idle)}>
          Party is in transit
        </button>
      ) : null}
      {pinsCount ? (
        <button type="button" onClick={onClearPins} className={cn(chip, idle)}>
          <X className="size-3" /> Clear pins
        </button>
      ) : null}
      <button
        type="button"
        onClick={onRegenerate}
        disabled={regenBusy}
        title="Reroll the terrain. Locations keep their spots where the new ground allows."
        className={cn(chip, idle, "disabled:opacity-50")}
      >
        {regenBusy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
        Regenerate
      </button>
    </div>
  );
}

export function TileLegend({ skin }: { skin: Record<OverworldTile, TileSkin> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {(Object.keys(skin) as OverworldTile[]).map((tile) => (
        <span key={tile} className="flex items-center gap-1 text-[10px] text-stone-500">
          <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: skin[tile].fill }} />
          {skin[tile].label}
        </span>
      ))}
    </div>
  );
}

export function PaintTools({
  skin,
  brush,
  onBrush,
  radius,
  onRadius,
  stranded,
}: {
  skin: Record<OverworldTile, TileSkin>;
  brush: OverworldBrush;
  onBrush: (brush: OverworldBrush) => void;
  radius: number;
  onRadius: (radius: number) => void;
  stranded: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="space-y-1.5 rounded border border-stone-800 bg-stone-950/50 p-2">
      <div className="flex flex-wrap items-center gap-1">
        {OVERWORLD_BRUSHES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onBrush(value)}
            className={cn(chip, brush === value ? active : idle)}
          >
            <span
              className="size-2.5 rounded-sm"
              style={{ backgroundColor: skin[OVERWORLD_BRUSH_TILES[value]].fill }}
            />
            {OVERWORLD_BRUSH_LABELS[value]}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[11px] text-stone-400">
        Brush size
        <input
          type="range"
          min={0}
          max={MAX_BRUSH_RADIUS}
          value={radius}
          onChange={(event) => onRadius(Number(event.target.value))}
          className="w-28 accent-amber-400"
        />
        <span className="text-stone-500">{radius === 0 ? "one tile" : `${radius * 2 + 1} across`}</span>
      </label>
      {stranded.length ? (
        <p className="text-[11px] text-amber-300/90">
          {stranded.map((place) => place.name).filter(Boolean).join(", ")}{" "}
          {stranded.length === 1 ? "is" : "are"} now standing in sea or on a peak. The marker
          stays where you put it; move it with Move a place if that was not the idea.
        </p>
      ) : null}
    </div>
  );
}

// A road, river or border is drawn one tap at a time and finished on
// purpose, so a mis-tap is an undo rather than a stray line on the map.
export function LineTools({
  kind,
  onKind,
  pendingCount,
  label,
  onLabel,
  onFinish,
  onUndo,
  onCancel,
}: {
  kind: PathKind;
  onKind: (kind: PathKind) => void;
  pendingCount: number;
  label: string;
  onLabel: (label: string) => void;
  onFinish: () => void;
  onUndo: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-1.5 rounded border border-stone-800 bg-stone-950/50 p-2">
      <div className="flex flex-wrap items-center gap-1">
        {PATH_KINDS.map((value) => (
          <button
            key={value}
            type="button"
            disabled={pendingCount > 0 && value !== kind}
            onClick={() => onKind(value)}
            className={cn(chip, kind === value ? active : idle, "disabled:opacity-40")}
          >
            {PATH_KIND_LABELS[value]}
          </button>
        ))}
        <input
          value={label}
          maxLength={FEATURE_LIMITS.labelLength}
          onChange={(event) => onLabel(event.target.value)}
          placeholder={`Name the ${kind} (optional)`}
          className="min-w-32 flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-0.5 text-[11px] text-stone-200"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
        <span>
          {pendingCount === 0
            ? "Tap where it starts, then along its course."
            : `${pendingCount} point${pendingCount === 1 ? "" : "s"} so far.`}
        </span>
        <button
          type="button"
          disabled={pendingCount < 2}
          onClick={onFinish}
          className={cn(chip, "border-amber-700 bg-amber-950/50 text-amber-100 disabled:opacity-40")}
        >
          Finish the {kind}
        </button>
        <button type="button" disabled={pendingCount === 0} onClick={onUndo} className={cn(chip, idle, "disabled:opacity-40")}>
          Undo a point
        </button>
        <button type="button" disabled={pendingCount === 0} onClick={onCancel} className={cn(chip, idle, "disabled:opacity-40")}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function LabelTools({ size, onSize }: { size: LabelSize; onSize: (size: LabelSize) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded border border-stone-800 bg-stone-950/50 p-2 text-[11px] text-stone-500">
      <span>Tap where the words go.</span>
      <button type="button" onClick={() => onSize("small")} className={cn(chip, size === "small" ? active : idle)}>
        Place name
      </button>
      <button type="button" onClick={() => onSize("large")} className={cn(chip, size === "large" ? active : idle)}>
        Region name
      </button>
    </div>
  );
}

async function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

// The map as a file, either way: a picture in place of the tiles, a map
// drawn in Fantasy Map Generator read into the grid, or the map saved out as
// a PNG to print or hand round.
export function FileTools({
  backdropPath,
  onBackdrop,
  onExport,
  exporting,
  onImport,
  importing,
  importNote,
  mapSize,
}: {
  backdropPath: string;
  onBackdrop: (path: string) => void;
  onExport: () => void;
  exporting: boolean;
  onImport: (files: string[], size: OverworldSize) => void;
  importing: boolean;
  importNote: string;
  mapSize: OverworldSize;
}) {
  const imageRef = useRef<HTMLInputElement>(null);
  const geoRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [sizeId, setSizeId] = useState("current");

  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      const dataUrl = await readAsDataUrl(file);
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
      onBackdrop(payload.url);
    } catch {
      setError("That image would not upload.");
    } finally {
      setUploading(false);
    }
  }

  async function pickGeo(files: FileList | null) {
    if (!files?.length) {
      return;
    }
    setError("");
    const texts = await Promise.all([...files].map((file) => file.text()));
    const preset = OVERWORLD_SIZES.find((entry) => entry.id === sizeId);
    onImport(texts, preset ? { width: preset.width, height: preset.height } : mapSize);
  }

  return (
    <div className="space-y-1.5 rounded border border-stone-800 bg-stone-950/50 p-2">
      <input
        ref={imageRef}
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
      <input
        ref={geoRef}
        type="file"
        multiple
        accept=".geojson,.json,application/geo+json,application/json"
        className="hidden"
        onChange={(event) => {
          void pickGeo(event.target.files);
          event.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={uploading}
          onClick={() => imageRef.current?.click()}
          className={cn(chip, idle, "disabled:opacity-50")}
        >
          {uploading ? <Loader2 className="size-3 animate-spin" /> : <ImageIcon className="size-3" />}
          {backdropPath ? "Replace the picture" : "Use a picture instead of tiles"}
        </button>
        {backdropPath ? (
          <button type="button" onClick={() => onBackdrop("")} className={cn(chip, idle)}>
            <Trash2 className="size-3" /> Back to the tiles
          </button>
        ) : null}
        <button
          type="button"
          disabled={exporting}
          onClick={onExport}
          className={cn(chip, idle, "disabled:opacity-50")}
        >
          {exporting ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
          Save as PNG
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={importing}
          onClick={() => geoRef.current?.click()}
          className={cn(chip, idle, "disabled:opacity-50")}
        >
          {importing ? <Loader2 className="size-3 animate-spin" /> : <FileUp className="size-3" />}
          Read an Azgaar map
        </button>
        <select
          value={sizeId}
          onChange={(event) => setSizeId(event.target.value)}
          aria-label="Grid size for the imported map"
          className="rounded-md border border-stone-700 bg-stone-950 px-1.5 py-0.5 text-[11px] text-stone-300"
        >
          <option value="current">
            At this size ({mapSize.width} by {mapSize.height})
          </option>
          {OVERWORLD_SIZES.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label} ({entry.width} by {entry.height})
            </option>
          ))}
        </select>
        <span className="text-[10px] text-stone-600">
          Fantasy Map Generator: export Cells as GeoJSON, plus Burgs, Rivers and Routes if you like.
        </span>
      </div>
      {importNote ? <p className="text-[11px] text-emerald-300/90">{importNote}</p> : null}
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </div>
  );
}
