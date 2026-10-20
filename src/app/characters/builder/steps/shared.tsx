"use client";

import { X } from "lucide-react";
import { useId, type ReactNode } from "react";
import { InfoButton, type ContentRef } from "@/components/ui/InfoDialog";
import { Ribbon } from "@/components/ui/Ribbon";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { owedHeadline, type OwedPick } from "../owed";
import type { BlockerTarget } from "../submit";

// What a ⓘ next to a name needs: text to show, or a pack row to read it from.
export type InfoSource = { text?: string | null; reference?: ContentRef; meta?: string };

// Field styling shared by every wizard step and the sub-editors that take an
// inputClass prop (RacialChoicesSection, EquipmentSection).
export const inputClass = ui.input;

// "Two choices left on this step: Class skills · Fighting style", each name
// a way to its block. The footer's blocker says the first; this says how
// many there are and reaches each. Nothing shows once the step is done.
// `onFill` adds "Fill what's left" (quickBuild.ts): every open slot picked
// for the player at once, read back, with one Undo. Only on request; the
// line is the offer.
export function OwedLine({
  picks,
  onShow,
  onFill,
}: {
  picks: OwedPick[];
  onShow: (target: BlockerTarget) => void;
  onFill?: () => void;
}) {
  const headline = owedHeadline(picks.length);
  if (!headline) {
    return null;
  }
  return (
    <p key={picks.length} className="reveal flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-stone-400" data-owed={picks.length}>
      <span className="text-amber-200/90">{headline}:</span>
      {picks.map((pick, index) => (
        <span key={pick.target} className="inline-flex items-center">
          {index ? (
            <span aria-hidden="true" className="mr-1.5 text-stone-600">
              ·
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => onShow(pick.target)}
            title={pick.message}
            className="underline decoration-amber-500/40 underline-offset-2 transition-colors hover:text-amber-100"
          >
            {pick.label}
          </button>
        </span>
      ))}
      {onFill ? (
        <button
          type="button"
          onClick={onFill}
          data-quick-fill=""
          className="ml-1 rounded-md border border-sky-500/40 px-1.5 py-0.5 text-sky-200 transition-colors hover:bg-sky-500/10"
        >
          Fill what&apos;s left
        </button>
      ) : null}
    </p>
  );
}

// "Pick for me" on one card that the level brings (a subclass, an ability
// score improvement): the card stays blank until it is pressed.
export function PickForMe({ onPick, what }: { onPick: () => void; what: string }) {
  return (
    <button
      type="button"
      onClick={onPick}
      data-pick-for-me=""
      aria-label={`Pick ${what} for me`}
      className="shrink-0 rounded-md border border-sky-500/40 px-1.5 py-0.5 text-xs text-sky-200 transition-colors hover:bg-sky-500/10"
    >
      Pick for me
    </button>
  );
}

// One titled block inside a step: a Ribbon rule, an optional line of help,
// then the fields. Ornate gets the corner flourishes of the panel recipe,
// used for the block a step is really about.
export function StepPanel({
  title,
  help,
  ornate = false,
  anchor,
  children,
  className,
}: {
  title: ReactNode;
  help?: ReactNode;
  ornate?: boolean;
  // The pick this block collects, as the step blockers name it
  // (submit.ts BlockerTarget), so the footer can scroll to it.
  anchor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(ui.card, ornate && "ornate", "p-4", className)} data-builder-target={anchor}>
      <Ribbon className="mb-3">{title}</Ribbon>
      {help ? <p className="mb-3 text-xs text-stone-500">{help}</p> : null}
      {children}
    </section>
  );
}

// Small caps label over a field. A div, not a <label>: the pickers inside
// are lists of buttons, and a <label> forwards any click on its caption or
// its empty space to the first button it contains, which opened the info
// dialog from the word "Alignment" and closed the list from a group heading.
// The caption names the block as a group instead, so a screen reader hears
// "Alignment" on the way in while a picker's trigger keeps announcing the
// value it holds. A single native control can take the caption as its own
// name: pass `captionId` and point the control's aria-labelledby at it.
export function Field({
  label,
  anchor,
  captionId,
  children,
  className,
}: {
  label: ReactNode;
  anchor?: string;
  captionId?: string;
  children: ReactNode;
  className?: string;
}) {
  const ownId = useId();
  const id = captionId ?? ownId;
  return (
    <div role="group" aria-labelledby={id} className={cn("block", className)} data-builder-target={anchor}>
      <span id={id} className="mb-1 block text-xs text-stone-400">
        {label}
      </span>
      {children}
    </div>
  );
}

// Removable chip for a chosen spell, item or feat. Homebrew entries wear
// gold so a player can tell them from catalog rows at a glance. `info` adds
// the ⓘ, so a spell can be read from the chip it was added to and not only
// from the row it was picked in.
export function Chip({
  label,
  onRemove,
  homebrew = false,
  info,
}: {
  label: string;
  // Absent for chips the player cannot drop (granted subclass spells).
  onRemove?: () => void;
  homebrew?: boolean;
  info?: InfoSource;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
        homebrew
          ? "border-amber-500/40 bg-amber-400/10 text-amber-200"
          : "border-stone-600/60 bg-stone-900/60 text-stone-200",
      )}
    >
      {label}
      {info ? (
        <InfoButton label={label} text={info.text} meta={info.meta} reference={info.reference} />
      ) : null}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          // A 12 px cross with a 44 px reach: the ring past the edge takes
          // the tap without making the chip any taller.
          className="relative text-stone-500 after:absolute after:-inset-4 after:rounded-full after:content-[''] hover:text-red-400"
          aria-label={`Remove ${label}`}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

// Toggle pill for a pick-N list (class skills, expertise). Disabled pills
// are the ones another source already granted. With `info` the pill carries
// its own ⓘ, which is why the shell is a span: a button cannot hold one.
export function PickPill({
  selected,
  disabled = false,
  onClick,
  info,
  label,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  info?: InfoSource;
  // Names the thing for the ⓘ's dialog and its accessible label; defaults to
  // whatever the children render as.
  label?: string;
  children: ReactNode;
}) {
  const shell = cn(
    "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors duration-150",
    disabled
      ? "border-stone-800 bg-stone-900/60 text-stone-500"
      : selected
        ? "border-amber-500/60 bg-amber-400/15 text-amber-100 shadow-glow-gold"
        : "border-stone-600/60 text-stone-300 hover:border-amber-500/40 hover:bg-stone-900/70",
  );
  if (!info) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={selected}
        className={shell}
      >
        {children}
      </button>
    );
  }
  return (
    <span className={shell}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={selected}
        className="disabled:cursor-not-allowed"
      >
        {children}
      </button>
      <InfoButton
        label={label ?? String(children)}
        text={info.text}
        meta={info.meta}
        reference={info.reference}
      />
    </span>
  );
}
