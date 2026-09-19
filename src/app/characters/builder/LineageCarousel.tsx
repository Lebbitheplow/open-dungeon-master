"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Star } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { InfoButton, renderRules, type ContentRef } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { asiChips, lineageChoices, parseTrait, srdRaceFor, traitLines, wrapIndex, type LineageEntry } from "./lineage";

// Everything the carousel shows for one lineage. `info` is exactly what the
// old picker's info button carried (the pack's blurb, else the bundled trait
// text, else the summary; plus the content-pack reference), so nothing that
// could be read before can no longer be read.
export type LineageSlide = LineageEntry & {
  speed: number;
  languages: string[];
  note: string;
  art: string;
  // Canonical SRD name behind a world pack's reskin.
  canonical?: string;
  packBlurb?: string;
  group: string | null;
  recommended: boolean;
  info: { text?: string | null; reference?: ContentRef };
};

const sectionLabel = "mb-1.5 block font-display text-[8.5px] font-semibold uppercase tracking-[0.2em] text-amber-500/80";

function Traits({ slide }: { slide: LineageSlide }) {
  const lines = traitLines(slide);
  // The first trait with something to say arrives open, so the panel never
  // opens onto a wall of closed rows.
  const [openTrait, setOpenTrait] = useState<number | null>(() => {
    const first = lines.findIndex((line) => parseTrait(line, slide).body);
    return first === -1 ? null : first;
  });
  if (!lines.length) {
    return slide.info.text ? (
      <div className="space-y-2 font-serif text-[13px] leading-normal text-stone-300">{renderRules(slide.info.text)}</div>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-[5px]">
      {lines.map((line, index) => {
        const parsed = parseTrait(line, slide);
        const open = openTrait === index && Boolean(parsed.body);
        return (
          <button
            key={`${index}-${line}`}
            type="button"
            onClick={() => setOpenTrait(open ? null : index)}
            aria-expanded={parsed.body ? open : undefined}
            disabled={!parsed.body}
            className="creator-trait creator-trait-rise"
            style={{ "--i": Math.min(index, 8) } as CSSProperties}
          >
            <span className="flex w-full items-center gap-2.5 px-3 py-2">
              <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full border border-amber-500/40 bg-amber-950/50 font-mono text-[9px] text-amber-300">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 font-display text-[12.5px] font-semibold text-amber-200">{parsed.head}</span>
              {parsed.body ? <ChevronDown className="creator-chevron size-3.5 shrink-0 text-stone-500" aria-hidden="true" /> : null}
            </span>
            {open ? (
              <span className="creator-trait-body pb-2.5 pl-[42px] pr-3 font-serif text-[12.5px] leading-normal text-stone-300">
                {parsed.body}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// The detail carousel over the lineage grid: walks the same ordered list the
// grid shows, wrapping at both ends, and names the neighbours so browsing is
// not blind. Choose picks the lineage and closes; nothing is chosen by
// looking.
export function LineageCarousel({
  slides,
  index,
  onIndexChange,
  chosenId,
  onChoose,
}: {
  slides: LineageSlide[];
  // Null while closed.
  index: number | null;
  onIndexChange: (index: number | null) => void;
  chosenId: string;
  onChoose: (id: string) => void;
}) {
  // Which way the last step went, so the incoming lineage slides in from
  // that side. Cleared on close: opening the dialog is not a step.
  const [dir, setDir] = useState<"next" | "prev" | null>(null);
  const slide = index === null ? null : slides[index];
  if (!slide || index === null) {
    return null;
  }
  const step = (delta: number) => {
    setDir(delta > 0 ? "next" : "prev");
    onIndexChange(wrapIndex(index, delta, slides.length));
  };
  const close = () => {
    setDir(null);
    onIndexChange(null);
  };
  const prev = slides[wrapIndex(index, -1, slides.length)];
  const next = slides[wrapIndex(index, 1, slides.length)];
  const srd = srdRaceFor(slide.id);
  const choices = lineageChoices(slide);
  const lines = traitLines(slide);
  const facts = [
    { key: "Speed", value: `${slide.speed} ft` },
    ...(srd?.size ? [{ key: "Size", value: srd.size }] : []),
    { key: "Traits", value: String(lines.length) },
  ];
  const chosen = slide.id === chosenId;
  const navButton = cn(ui.btnSmall, "min-w-0 max-w-[38%] px-2 py-1 text-xs");

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : close())}
      title={
        <span className="flex min-w-0 flex-col">
          <span className="truncate uppercase tracking-[0.14em]">{slide.name}</span>
          {slide.canonical ? (
            <span className="font-mono text-[10px] normal-case tracking-normal text-stone-500">
              {slide.canonical} in the rules
            </span>
          ) : null}
        </span>
      }
      width="w-[min(96vw,40rem)]"
    >
      <div
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") step(-1);
          if (event.key === "ArrowRight") step(1);
        }}
      >
        <div className="mb-3.5 flex items-center justify-between gap-2">
          <button type="button" onClick={() => step(-1)} className={navButton} aria-label={`Previous: ${prev.name}`}>
            <ChevronLeft className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{prev.name}</span>
          </button>
          <span className="flex min-w-0 flex-col items-center gap-0.5 text-center">
            <span className="font-mono text-[9.5px] text-stone-500" aria-live="polite">
              {index + 1} / {slides.length}
            </span>
            {slide.recommended ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-400/10 px-1.5 py-px font-display text-[8px] font-bold uppercase tracking-[0.12em] text-amber-300">
                <Star className="size-2.5 fill-current" aria-hidden="true" />
                Recommended
              </span>
            ) : null}
            {slide.group ? <span className="truncate font-mono text-[9px] text-stone-500">{slide.group}</span> : null}
          </span>
          <button type="button" onClick={() => step(1)} className={navButton} aria-label={`Next: ${next.name}`}>
            <span className="truncate">{next.name}</span>
            <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
          </button>
        </div>

        {/* Keyed by lineage so the accordion and the entrance start over on
            every step of the carousel. */}
        <div key={slide.id} className="creator-slide flex flex-wrap items-start gap-3.5" data-dir={dir ?? undefined}>
          <div className="flex w-full flex-row gap-3 sm:w-[172px] sm:flex-none sm:flex-col sm:gap-2.5">
            <span className="creator-plate rounded-[10px] border border-amber-500/30 shadow-glow-gold" data-detail="" role="img" aria-label={`${slide.name} portrait`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={slide.art} alt="" draggable={false} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <div className="flex flex-wrap gap-1">
                {asiChips(slide.asi).map((chip) => (
                  <span key={chip.label} className="creator-chip" data-size="md">
                    {chip.ability} <span className="font-display text-[11px] font-bold text-amber-100">{chip.bonus}</span>
                  </span>
                ))}
              </div>
              <dl className="flex flex-col gap-[3px]">
                {facts.map((fact) => (
                  <div key={fact.key} className="flex items-baseline justify-between gap-2 font-mono text-[10px] text-stone-500">
                    <dt>{fact.key}</dt>
                    <dd className="text-stone-200">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2.5">
            {slide.packBlurb ? (
              <p className="font-serif text-[13px] italic leading-normal text-stone-300">{slide.packBlurb}</p>
            ) : null}
            <div className="rounded-[10px] border border-stone-700/60 bg-stone-950/60 px-3 py-2.5">
              <span className={sectionLabel}>Tongues</span>
              <span className="font-serif text-[13px] leading-normal text-stone-300">{slide.languages.join(", ")}</span>
            </div>
            {choices.length ? (
              <div className="rounded-[10px] border border-amber-500/30 bg-amber-950/20 px-3 py-2.5">
                <span className={sectionLabel}>Leaves you to choose</span>
                <div className="flex flex-wrap gap-1">
                  {choices.map((choice) => (
                    <span key={choice} className="creator-chip" data-size="md">
                      {choice}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <div>
              <span className={cn(sectionLabel, "flex items-center gap-1.5")}>
                Lineage traits
                {/* The full write-up, as the old picker's info button gave it:
                    the pack's own entry when one is installed. */}
                <InfoButton label={slide.name} text={slide.info.text} reference={slide.info.reference} />
              </span>
              <Traits slide={slide} />
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={close} className={ui.btnSecondary}>
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              onChoose(slide.id);
              close();
            }}
            className={ui.btnPrimary}
          >
            {chosen ? `Keep ${slide.name}` : `Choose ${slide.name}`}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
