"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { InfoButton, type ContentRef } from "@/components/ui/InfoDialog";
import { Ribbon } from "@/components/ui/Ribbon";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

// What a ⓘ next to a name needs: text to show, or a pack row to read it from.
export type InfoSource = { text?: string | null; reference?: ContentRef; meta?: string };

// Field styling shared by every wizard step and the sub-editors that take an
// inputClass prop (RacialChoicesSection, EquipmentSection).
export const inputClass = ui.input;

// One titled block inside a step: a Ribbon rule, an optional line of help,
// then the fields. Ornate gets the corner flourishes of the panel recipe,
// used for the block a step is really about.
export function StepPanel({
  title,
  help,
  ornate = false,
  children,
  className,
}: {
  title: ReactNode;
  help?: ReactNode;
  ornate?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(ui.card, ornate && "ornate", "p-4", className)}>
      <Ribbon className="mb-3">{title}</Ribbon>
      {help ? <p className="mb-3 text-xs text-stone-500">{help}</p> : null}
      {children}
    </section>
  );
}

// Small caps label over a field.
export function Field({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs text-stone-400">{label}</span>
      {children}
    </label>
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
  onRemove: () => void;
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
      <button
        type="button"
        onClick={onRemove}
        className="text-stone-500 hover:text-red-400"
        aria-label={`Remove ${label}`}
      >
        <X className="size-3" />
      </button>
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

// Why Continue is disabled on this step, shown under the step's content so
// the answer is right where the player is looking.
export function StepBlocker({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p className="mt-4 text-xs text-amber-300/90" role="status">
      {message}
    </p>
  );
}
