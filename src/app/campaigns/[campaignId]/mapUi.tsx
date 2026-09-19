"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Slider } from "@/components/ui/Slider";
import { TERRAIN } from "@/lib/battlemap/types";
import type { Brush as BrushName } from "@/lib/battlemap/paint";
import type { Skin } from "@/lib/battlemap/skins";
import type { Catalogue } from "@/app/campaigns/[campaignId]/useMapPaint";

// The small parts every map panel is built from, so the rail's options, the
// layers column and the forge read as one tool.

// A gold small-caps heading with a rule running off to the right.
export function PanelHead({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <h3 className="shrink-0 font-display text-[10px] uppercase tracking-[0.2em] text-amber-400/90">{children}</h3>
      <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-amber-500/30 to-transparent" />
      {aside ? <span className="shrink-0 font-mono text-[9px] text-stone-500">{aside}</span> : null}
    </div>
  );
}

export function Blurb({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("font-serif text-[12px] leading-snug text-stone-400", className)}>{children}</p>;
}

export function FinePrint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[10px] leading-snug text-stone-500", className)}>{children}</p>;
}

// A pressed-or-not choice. 32 px tall so a thumb can take it in a sheet.
export function Chip({
  active,
  onClick,
  children,
  title,
  disabled,
  className,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-8 items-center justify-center rounded-md border px-2 motion-press disabled:opacity-40",
        active
          ? "border-amber-500/60 bg-amber-400/10 text-amber-100 shadow-[0_0_12px_rgba(212,171,58,0.12)]"
          : "border-stone-700/80 bg-stone-950/40 text-stone-400 hover:border-stone-600 hover:text-stone-200",
        className,
      )}
    >
      {/* The app resets `font` on buttons outside any layer, so the size sits on a span. */}
      <span className="inline-flex items-center gap-1 text-[11px]">{children}</span>
    </button>
  );
}

export const mapInput =
  "w-full rounded-md border border-stone-700/80 bg-stone-950/80 px-2 py-1.5 text-xs text-stone-100 outline-none placeholder:text-stone-500 focus:border-amber-400/70 motion-input";

export const mapButton =
  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-stone-700/80 bg-stone-950/40 px-2.5 text-[11px] text-stone-300 hover:border-amber-500/40 hover:text-amber-100 disabled:opacity-40 motion-press";

export const mapDanger =
  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-stone-700/80 px-2.5 text-[11px] text-stone-400 hover:border-red-800/70 hover:text-red-300 disabled:opacity-40 motion-press";

// A slider with its name on the left and its reading on the right.
export function RangeRow({
  label,
  value,
  min,
  max,
  step = 1,
  readout,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  readout?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-stone-400">
      <span className="w-12 shrink-0">{label}</span>
      <Slider min={min} max={max} step={step} value={value} onChange={onChange} label={label} className="map-range min-w-0 flex-1" />
      {readout !== undefined ? <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-stone-300">{readout}</span> : null}
    </label>
  );
}

// The flat tone of each terrain character, for a swatch when no painted
// material is to hand (no painted sets on this host, or the Flat toggle).
export const FLAT_TONES: Record<string, string> = {
  [TERRAIN.floor]: "#3f3a33",
  [TERRAIN.wall]: "#1b1815",
  [TERRAIN.water]: "#26495e",
  [TERRAIN.difficult]: "#4a4126",
  [TERRAIN.door]: "#c99a3c",
  [TERRAIN.lowwall]: "#5a5147",
};

// The picture of the material a skin paints each terrain character with.
export function skinSwatches(skin: Skin | null, catalogue: Catalogue | null): Record<string, string> {
  if (!skin || !catalogue) {
    return {};
  }
  const byId = new Map(catalogue.tiles.map((tile) => [tile.id, tile.src]));
  const out: Record<string, string> = {};
  for (const [char, material] of Object.entries(skin.bind)) {
    const src = byId.get(material);
    if (src) {
      out[char] = src;
    }
  }
  return out;
}

export function Swatch({ char, src, className }: { char: string; src?: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-[18px] shrink-0 rounded-[4px] border border-black/40 bg-cover bg-center shadow-[0_0_0_1px_rgba(233,230,244,0.06)]", className)}
      style={src ? { backgroundImage: `url("${src}")`, backgroundColor: FLAT_TONES[char] } : { backgroundColor: FLAT_TONES[char] ?? "#2a2724" }}
    />
  );
}

export function brushChar(brush: BrushName): string {
  return TERRAIN[brush];
}
