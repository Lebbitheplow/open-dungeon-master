"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Loader2, MoreVertical } from "lucide-react";
import { Fragment } from "react";
import type { ContextMenuItem } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";

// The visible door to a row's secondary actions (docs/visual-overhaul-plan.md
// 8c.7). It takes the very list the row hands its ContextMenu, so the kebab,
// the right-click and the long press can never drift apart, and it draws the
// rows the way that menu does.

const itemClass =
  "flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800 data-[highlighted]:text-amber-100 data-[disabled]:cursor-default data-[disabled]:opacity-40";

// A kebab row may carry the sentence its button used to hold as a tooltip;
// the context menu ignores it.
export type KebabItem = ContextMenuItem & { hint?: string };

export function KebabMenu({
  items,
  label,
  heading,
  className,
  busy = false,
}: {
  items: KebabItem[];
  // The accessible name of the button, e.g. "More actions for Rowan".
  label: string;
  // What the menu is about, shown at its top.
  heading?: string;
  className?: string;
  // Swaps the dots for a spinner while one of the actions is on the wire.
  busy?: boolean;
}) {
  if (!items.length) {
    return null;
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            "motion-nudge inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-stone-600/60 bg-stone-900/50 text-stone-300 hover:border-amber-500/40 hover:text-amber-100 data-[state=open]:border-amber-500/60 data-[state=open]:text-amber-100",
            className,
          )}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <MoreVertical className="size-4" aria-hidden="true" />}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} collisionPadding={12} className="panel ctx-menu z-50 min-w-52 max-w-[min(20rem,90vw)] p-1.5">
          {heading ? <DropdownMenu.Label className="ctx-menu-label gold-title">{heading}</DropdownMenu.Label> : null}
          {items.map((item) => (
            <Fragment key={item.id}>
              {item.separated ? <DropdownMenu.Separator className="my-1 h-px bg-stone-800" /> : null}
              <DropdownMenu.Item
                disabled={item.disabled}
                // Deferred a tick: an action that opens a dialog must not race
                // this menu's own teardown of the body's pointer lock.
                onSelect={() => setTimeout(item.onSelect, 0)}
                className={cn(itemClass, item.tone === "danger" && "ctx-item-danger")}
              >
                <GameIcon icon={{ kind: "glyph", key: item.glyph }} size="size-6" />
                <span className="min-w-0">
                  <span className="block">{item.label}</span>
                  {item.hint ? <span className="block max-w-60 text-[11px] leading-4 text-stone-500">{item.hint}</span> : null}
                </span>
              </DropdownMenu.Item>
            </Fragment>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
