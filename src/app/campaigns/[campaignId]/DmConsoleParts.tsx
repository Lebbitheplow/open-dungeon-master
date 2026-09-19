"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SectionHead } from "@/components/ui/SectionHead";

// The furniture every card on the DM's desk shares. The console grew panel by
// panel and each one drew its own box, heading and button; these are the one
// card, the one field label and the one action plate they all use now, so the
// desk reads as a single instrument rather than fourteen forms.

// Rests, death and levelling have glyphs of their own; everything else wears
// the glyph its caller falls back to (its console tab's, or the DM's own).
export function adjudicationGlyph(name: string, fallback: string): string {
  if (name.includes("long_rest")) return "rest-long";
  if (name.includes("rest")) return "rest-short";
  if (name.includes("death")) return "rest-death-save";
  if (name.includes("level")) return "rest-level-up";
  if (name.includes("xp")) return "rest-xp";
  if (name.includes("inspiration")) return "rest-inspiration";
  if (name.includes("exhaustion")) return "rest-exhaustion";
  if (name.includes("heal") || name.includes("damage") || name.includes("hp")) return "rest-hp";
  if (name.includes("quest")) return "quest-active";
  if (name.includes("gold") || name.includes("coin") || name.includes("purse")) return "coin-purse";
  // After the rules above, which the command palette already relied on: the
  // rest of the desk, so a category of thirty plates is not thirty of one face.
  if (name.includes("initiative")) return "rest-initiative";
  if (name.includes("concentration")) return "rest-concentration-break";
  if (name.includes("spell") || name.includes("cast")) return "rest-spell-slot";
  if (name.includes("check") || name.includes("roll") || name.includes("save")) return "die-d20";
  if (name.includes("loot") || name.includes("item") || name.includes("treasure")) return "tab-loot";
  if (name.includes("shop") || name.includes("merchant")) return "tab-shop";
  if (name.includes("handout") || name.includes("image")) return "tab-handout";
  if (name.includes("ambience") || name.includes("music") || name.includes("sound")) return "tab-ambience";
  if (name.includes("npc")) return "system-cast";
  if (name.includes("faction")) return "tab-factions";
  if (name.includes("lore")) return "system-lore";
  if (name.includes("time") || name.includes("calendar")) return "tab-timeline";
  if (name.includes("floor") || name.includes("spotlight")) return "tab-lead";
  return fallback;
}

// A status or tool card: a kit panel under a painted glyph heading.
export function DeskCard({
  title,
  glyph,
  aside,
  level = "h3",
  className,
  children,
}: {
  title: ReactNode;
  glyph: string;
  aside?: ReactNode;
  level?: "h2" | "h3" | "h4";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn(ui.card, "dm-card p-3", className)}>
      <SectionHead title={title} glyph={glyph} aside={aside} level={level} />
      {children}
    </section>
  );
}

// The caption over a field. Gold small caps like the section heads, one size
// down, so a form reads as part of its card rather than as grey boilerplate.
export function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("dm-label mb-1 block font-display text-[11px] tracking-[0.12em] text-amber-200/80", className)}>
      {children}
    </span>
  );
}

// One adjudication on the desk: a plate with its glyph, its name and what it
// does, pressed to open the form. `badge` carries the assist rail's
// "filled in" mark.
export function ActionPlate({
  glyph,
  label,
  summary,
  badge,
  onClick,
}: {
  glyph: string;
  label: string;
  summary: string;
  badge?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(ui.card, ui.tileHover, "dm-plate flex min-h-11 w-full items-center gap-2.5 px-2.5 py-2 text-left")}
    >
      <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-7" className="shrink-0" />
      <span className="min-w-0 grow">
        <span className="block text-sm text-stone-100">
          {label}
          {badge}
        </span>
        <span className="block text-xs leading-snug text-stone-400">{summary}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-amber-400/60" aria-hidden="true" />
    </button>
  );
}

// A number that may be left unset. The kit stepper always holds a figure, and
// several console fields mean something different when empty ("as it is", or
// an optional argument the engine defaults), so this keeps the empty state:
// the first press starts from `start`, and the clear button returns it to "".
export function OptionalNumber({
  value,
  onChange,
  min,
  max,
  start,
  label,
  emptyHint,
  size = "md",
}: {
  value: number | "";
  onChange: (next: number | "") => void;
  min?: number;
  max?: number;
  // Where the first press lands when the field is empty.
  start?: number;
  label: string;
  // What an empty field means, shown beside it ("as it is", "Not set").
  emptyHint: string;
  size?: "sm" | "md";
}) {
  const floor = min ?? Number.NEGATIVE_INFINITY;
  const ceiling = max ?? Number.POSITIVE_INFINITY;
  const first = Math.min(ceiling, Math.max(floor, start ?? min ?? 0));
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <NumberStepper
        value={value === "" ? Number.NaN : value}
        // An empty field stepped either way has no figure to step from.
        onChange={(next) => onChange(Number.isFinite(next) ? next : first)}
        min={min}
        max={max}
        label={label}
        size={size}
      />
      {value === "" ? (
        <span className="text-[11px] text-stone-500">{emptyHint}</span>
      ) : (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={`Clear ${label}`}
          title={`Clear: ${emptyHint}`}
          className={cn(ui.iconAction, "!opacity-100")}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

// The quiet "Close" under an open form.
export function CloseForm({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn(ui.btnSmall, "px-2 py-1 text-[11px]")}>
      <X className="size-3" aria-hidden="true" />
      Close
    </button>
  );
}

// A card's row that opens it: the kit's small button with its plate taken
// off, so it presses and lights like one but reads as the card's own line.
export const quietRow =
  "min-h-10 min-w-0 justify-start border-transparent bg-transparent px-1 text-left shadow-none hover:bg-stone-800/40";

// The heading of a card that folds: glyph, gold title, an optional mark at
// the far end (an unread count), and the chevron that says which way it is.
export function DisclosureHead({
  open,
  onToggle,
  glyph,
  title,
  aside,
  tour,
}: {
  open: boolean;
  onToggle: () => void;
  glyph: string;
  title: string;
  aside?: ReactNode;
  // The guided tour's anchor, where a tour opens this card.
  tour?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      data-tour={tour}
      className={cn(ui.btnSmall, quietRow, "w-full gap-2 font-display text-sm tracking-wide text-amber-100")}
    >
      <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-6" className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {aside}
      {open ? (
        <ChevronDown className="size-4 shrink-0 text-amber-400/70" aria-hidden="true" />
      ) : (
        <ChevronRight className="size-4 shrink-0 text-amber-400/70" aria-hidden="true" />
      )}
    </button>
  );
}
