"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { GameIcon } from "@/components/ui/GameIcon";
import type { ListedModel } from "@/lib/setup/discovery-logic";
import type { ScanResult } from "@/lib/setup/discovery";
import { Select } from "@/components/ui/Select";

// The furniture every setup step shares: big pick-one cards, the status
// lamp, the found-on-this-machine rows and a model picker.

export type { ListedModel, ScanResult };

export type Tone = "ok" | "warn" | "bad" | "off" | "wait";

export function Lamp({ tone, className }: { tone: Tone; className?: string }) {
  // Keyed so lighting up replays the pop.
  return <span key={tone} className={cn("su-lamp", className)} data-tone={tone} aria-hidden="true" />;
}

// The scan's mark: a sweeping ring while it asks, then a lamp that says
// whether anything answered.
export function ScanMark({ scanning, found }: { scanning: boolean; found: boolean }) {
  return scanning ? (
    <span className="su-scan" aria-hidden="true" />
  ) : (
    <span className="inline-grid size-[1.75rem] place-items-center" aria-hidden="true">
      <Lamp tone={found ? "ok" : "off"} />
    </span>
  );
}

export function ChoiceCards({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label} className="su-choices stagger">
      {children}
    </div>
  );
}

export function ChoiceCard({
  picked,
  onPick,
  glyph,
  title,
  sub,
  badge,
  dim = false,
  suggested = false,
}: {
  picked: boolean;
  onPick: () => void;
  glyph: string;
  title: string;
  sub: ReactNode;
  badge?: { text: string; tone: "ready" | "warn" | "off" } | null;
  dim?: boolean;
  // The guided setup's suggestion (src/lib/setup/suggest.ts).
  suggested?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={picked}
      data-unavailable={dim || undefined}
      onClick={onPick}
      className="hx-card su-choice"
    >
      <span className="flex items-center gap-2.5">
        <span className="hx-mark" aria-hidden="true">
          <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-6" />
        </span>
        <span className="text-sm font-semibold text-stone-100">{title}</span>
      </span>
      {/* In flow under the title, so a long title never runs under it. */}
      {badge || suggested ? (
        <span className="flex flex-wrap gap-1.5 self-start">
          {suggested ? (
            <span className="hx-pill reveal-pop" data-tone="ready" data-suggested="">
              Suggested
            </span>
          ) : null}
          {badge ? (
            <span key={badge.text} className="hx-pill reveal-pop" data-tone={badge.tone}>
              {badge.text}
            </span>
          ) : null}
        </span>
      ) : null}
      <span className="text-xs leading-5 text-stone-400">{sub}</span>
    </button>
  );
}

// A pick-one row for something the scan found.
export function FoundRow({
  picked,
  onPick,
  title,
  detail,
  tone,
}: {
  picked: boolean;
  onPick: () => void;
  title: ReactNode;
  detail: ReactNode;
  tone: Tone;
}) {
  return (
    <button type="button" role="radio" aria-checked={picked} onClick={onPick} className="su-found">
      <Lamp tone={tone} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-stone-100">{title}</span>
        <span className="block truncate text-[11px] text-stone-500">{detail}</span>
      </span>
    </button>
  );
}

export function ModelPicker({
  label,
  models,
  value,
  recommended,
  onChange,
}: {
  label: string;
  models: ListedModel[];
  value: string;
  recommended: string;
  onChange: (model: string) => void;
}) {
  const options = [
    ...models.map((model) => ({
      value: model.id,
      label: `${model.label}${model.id === recommended ? " (recommended)" : ""}${model.context ? ` · ${Math.round(model.context / 1000)}K` : ""}`,
    })),
    ...(value && !models.some((model) => model.id === value) ? [{ value, label: value }] : []),
  ];
  return (
    <div role="group" aria-label={label} className="reveal block">
      <span className="mb-1 block text-xs font-medium text-stone-400">{label}</span>
      <Select value={value} onChange={onChange} options={options} label={label} className="w-full" />
    </div>
  );
}

export function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// The setup's suggestion for a step, said above its cards: why this one, and
// a button to take it when another card is picked.
export function SuggestionNote({
  reason,
  title,
  taken,
  onTake,
}: {
  reason: string;
  // The suggested card's name, for the button; none when the suggestion is
  // to leave the step for later.
  title?: string;
  taken: boolean;
  onTake?: () => void;
}) {
  return (
    <div className="su-suggest reveal" role="note">
      <GameIcon icon={{ kind: "glyph", key: "quest-active" }} size="size-6" className="shrink-0" />
      <span className="min-w-0 flex-1 text-xs leading-5 text-stone-300">{reason}</span>
      {title && onTake && !taken ? (
        <button type="button" onClick={onTake} className="motion-press shrink-0 rounded-md border border-amber-500/40 px-2 py-1 text-xs text-amber-200 hover:bg-amber-500/10">
          Use {title}
        </button>
      ) : null}
    </div>
  );
}
