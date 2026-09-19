"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Loader2, MoreVertical } from "lucide-react";
import { Children, Fragment, type ButtonHTMLAttributes, type LabelHTMLAttributes, type ReactNode } from "react";
import type { ContextMenuItem } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

// The side panels are 20rem wide, so they share one set of kit pieces sized
// for that column: the kit buttons a step smaller, the kebab that mirrors a
// row's right-click menu, the tick used by checklists, and the loading line.
// Everything here only composes src/lib/ui.tsx; nothing restyles the kit.

export type KitTone = "primary" | "secondary" | "small" | "danger" | "icon" | "iconDanger" | "link";

const TONE: Record<KitTone, string> = {
  primary: cn(ui.btnPrimary, "pk-tap pk-display h-9 px-3 text-[12px]"),
  secondary: cn(ui.btnSecondary, "pk-tap pk-display h-9 text-[12px]"),
  small: cn(ui.btnSmall, "pk-tap px-2.5 py-1 text-xs"),
  danger: cn(ui.btnSmall, "pk-tap px-2.5 py-1 text-xs hover:border-red-500/50 hover:text-red-200"),
  icon: cn(ui.iconAction, "pk-tap inline-flex items-center justify-center"),
  iconDanger: cn(ui.iconAction, "pk-tap inline-flex items-center justify-center hover:text-red-300 focus-visible:text-red-300"),
  // A quiet text action inside a sentence or under a list.
  link: "pk-tap pk-link inline-flex items-center gap-1 text-xs motion-press",
};

export function kitButtonClass(tone: KitTone = "small", className?: string): string {
  return cn(TONE[tone], className);
}

export function KitButton({
  tone = "small",
  busy = false,
  always = false,
  className,
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: KitTone;
  // Swaps the leading icon for a spinner; the caller still sets disabled.
  busy?: boolean;
  // Icon tones fade in on hover; `always` keeps one on show.
  always?: boolean;
}) {
  return (
    <button type={type} aria-busy={busy || undefined} className={cn(TONE[tone], always && "pk-always", className)} {...rest}>
      {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

const menuItem =
  "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800 data-[highlighted]:text-amber-100 data-[disabled]:cursor-default data-[disabled]:opacity-40";

// The visible door to the menu a row also answers a right-click or a long
// press with: both take the same item list, so neither can drift.
export function RowMenu({ items, label, className }: { items: ContextMenuItem[]; label: string; className?: string }) {
  if (!items.length) {
    return null;
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={`Actions for ${label}`} className={cn(TONE.icon, "pk-always shrink-0", className)}>
          <MoreVertical className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} collisionPadding={12} className="panel ctx-menu z-[75] min-w-52 p-1.5">
          <DropdownMenu.Label className="ctx-menu-label gold-title">{label}</DropdownMenu.Label>
          {items.map((item) => (
            <Fragment key={item.id}>
              {item.separated ? <DropdownMenu.Separator className="my-1 h-px bg-stone-800" /> : null}
              <DropdownMenu.Item disabled={item.disabled} onSelect={item.onSelect} className={cn(menuItem, item.tone === "danger" && "ctx-item-danger")}>
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

// An on/off setting: the kit switch with the words the table always read
// beside it ("Maps on", "Follows the scene"). The label element makes the
// words a press target too, and takes a Tooltip's props and ref so a setting
// keeps its explanation.
export function SettingToggle({
  on,
  onToggle,
  disabled = false,
  label,
  children,
  className,
  ...rest
}: Omit<LabelHTMLAttributes<HTMLLabelElement>, "onToggle"> & {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  // The accessible name; defaults to the visible words.
  label?: string;
}) {
  const name =
    label ??
    Children.toArray(children)
      .filter((child): child is string | number => typeof child === "string" || typeof child === "number")
      .join("")
      .trim();
  return (
    <label {...rest} data-on={on ? "" : undefined} className={cn("pk-setting pk-tap", className)}>
      <Switch on={on} onChange={() => onToggle()} label={name} disabled={disabled} />
      <span>{children}</span>
    </label>
  );
}

// A checklist tick (an objective done, a row chosen). A Switch is for a
// setting; this is for a line on a list, so it keeps the checkbox role.
export function Tick({
  checked,
  onChange,
  label,
  disabled = false,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("pk-tick motion-press", className)}
    >
      <Check className="size-3" aria-hidden="true" />
    </button>
  );
}

// The read-only twin of Tick, for players who only watch the list.
export function TickMark({ checked }: { checked: boolean }) {
  return (
    <span className="pk-tick" data-static="" data-checked={checked ? "" : undefined} aria-hidden="true">
      <Check className="size-3" />
    </span>
  );
}

// A loading line keeps the sentence the panel always showed, over the kit's
// skeleton bars so the column does not jump when the rows land.
export function PanelLoading({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs text-stone-500">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> {label}
      </p>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-block h-10 rounded-lg" />
      ))}
    </div>
  );
}

// An inline error or notice line under a control.
export function PanelError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn("motion-shake text-xs text-red-400", className)}>
      {children}
    </p>
  );
}

// A small status chip with a painted glyph in front (quest status, attitude).
export function GlyphChip({ glyph, children, className }: { glyph: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn("pk-chip", className)}>
      <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-4" />
      {children}
    </span>
  );
}

export const panelRow = "panel group rounded-lg p-2.5";
export const panelField = cn(ui.input, "pk-field px-2.5 py-1.5 text-xs");
