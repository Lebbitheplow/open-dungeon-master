"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { EllipsisVertical, X } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { NumberStepper } from "@/components/ui/NumberStepper";
import type { ContextMenuItem } from "@/components/ui/ContextMenu";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

// The workshop's own small pieces over the app kit, shared by every system's
// editor and list so a field, a chip and a row menu read the same in all of
// them. Nothing here holds state a caller cannot see.

// A toggle chip (a skill, a habitat, a tag): ui.btnSmall trimmed to chip
// size, lit gold when on. Callers pass ui.btnSmall themselves so the class
// is visible where the button is.
// Every button in the app inherits its font (globals.css), so a text size on
// the button itself is ignored: the row that holds the chips sets it.
export const chipRow = "flex flex-wrap items-center gap-1.5 text-xs";
export const chip = "px-2 py-1.5 capitalize";
export const chipOn = "border-amber-500/60 bg-amber-400/10 text-amber-100";
// A quiet add button under a list ("+ Trait").
export const addChip = "px-2 py-1.5";
// A remove or clear button inside a dense row: the icon action, always
// shown, with a phone-sized target.
export const rowIcon = "grid size-9 shrink-0 place-items-center opacity-100 text-stone-500";

export function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("font-display text-[11px] tracking-[0.1em] text-amber-300/85", className)}>{children}</span>
  );
}

// One labelled field. `as="label"` is for a single text input, which takes
// its accessible name from the wrapping label. Kit controls (Select,
// NumberStepper, Switch) carry their own aria-label and hold several
// buttons, and a label around those would forward a tap on the caption to
// the first button inside, so they sit in a div.
export function Field({
  label,
  hint,
  aside,
  as: Tag = "div",
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  // Sits beside the caption: a glossary button, a count.
  aside?: ReactNode;
  as?: "div" | "label";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="flex items-center gap-1">
        <FieldLabel>{label}</FieldLabel>
        {aside}
      </span>
      {children}
      {hint ? <span className="text-[11px] leading-snug text-stone-500">{hint}</span> : null}
    </Tag>
  );
}

// A number that may be left unset. The kit stepper always holds a number, so
// an unset value shows as an empty figure; the first step or keystroke starts
// from `fallback`, and the small cross puts it back to unset, which is what
// clearing the old text box did.
export function OptionalStepper({
  value,
  onChange,
  fallback,
  min,
  max,
  step,
  label,
  size = "sm",
  suffix,
  disabled,
  className,
}: {
  value: number | undefined | null;
  onChange: (next: number | "") => void;
  fallback: number;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  size?: "sm" | "md";
  suffix?: string;
  disabled?: boolean;
  className?: string;
}) {
  const set = typeof value === "number" && Number.isFinite(value);
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      <NumberStepper
        value={set ? (value as number) : Number.NaN}
        onChange={(next) => onChange(Number.isFinite(next) ? next : fallback)}
        min={min}
        max={max}
        step={step}
        label={label}
        size={size}
        suffix={suffix}
        disabled={disabled}
      />
      {set && !disabled ? (
        <button type="button" aria-label={`Clear ${label}`} title="Leave unset" onClick={() => onChange("")} className={cn(ui.iconAction, "opacity-100")}>
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

// A bordered icon button in a page or system header (help, duplicate,
// delete): the icon action, always shown, at a phone-sized target.
export const headIcon = "grid size-10 shrink-0 place-items-center rounded-lg border border-stone-700/70 text-stone-400 opacity-100";

const menuItemClass =
  "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800 data-[highlighted]:text-amber-100 data-[disabled]:cursor-default data-[disabled]:opacity-40";

// The kebab on a row: the same items the row's ContextMenu lists, behind a
// button, so a phone and a keyboard reach them without a long press.
export function RowMenu({ items, label, className }: { items: ContextMenuItem[]; label: string; className?: string }) {
  if (!items.length) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`More for ${label}`}
          className={cn(ui.iconAction, "grid size-10 shrink-0 place-items-center text-stone-400 opacity-100", className)}
        >
          <EllipsisVertical className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} collisionPadding={12} className="panel ctx-menu z-50 min-w-52 p-1.5">
          <DropdownMenu.Label className="ctx-menu-label gold-title">{label}</DropdownMenu.Label>
          {items.map((item) => (
            <Fragment key={item.id}>
              {item.separated ? <DropdownMenu.Separator className="my-1 h-px bg-stone-800" /> : null}
              <DropdownMenu.Item
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={cn(menuItemClass, item.tone === "danger" && "ctx-item-danger")}
              >
                <GameIcon icon={{ kind: "glyph", key: item.glyph }} size="size-6" />
                {item.label}
              </DropdownMenu.Item>
            </Fragment>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// The painted plate that leads a list row when the thing has no art of its
// own: a glyph on the dark tile the monster tiles use.
export function GlyphPlate({ glyph, size = "size-12", className }: { glyph: string; size?: string; className?: string }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-lg border border-amber-500/25 bg-stone-950/70 shadow-[0_1px_0_rgba(233,230,244,0.06)_inset]",
        size,
        className,
      )}
    >
      <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-8" />
    </span>
  );
}
