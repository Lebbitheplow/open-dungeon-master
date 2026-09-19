"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Loader2, MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import type { ContextMenuItem } from "@/components/ui/ContextMenu";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

// Everything that can be done to one message, described once and offered
// three ways: icon actions beside the heading (the mouse's way), a kebab
// menu whose rows say in full what each does (the phone's way, where a row
// of nine icons does not fit), and the right-click or long-press menu.
export type MessageAction = {
  id: string;
  // Short name, for menu rows.
  name: string;
  // The accessible name of the icon action.
  label: string;
  // The full explanation: the icon's tooltip and the kebab row's second line.
  hint: string;
  // A file name under public/assets/icons/glyph.
  glyph: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  busy?: boolean;
  // Stays a visible icon on a phone; the rest fold into the kebab there.
  primary?: boolean;
  tone?: "danger";
};

export function toContextItems(actions: MessageAction[]): ContextMenuItem[] {
  return actions.map((action) => ({
    id: action.id,
    label: action.name,
    glyph: action.glyph,
    tone: action.tone,
    disabled: action.disabled || action.busy,
    separated: action.tone === "danger",
    onSelect: action.onSelect,
  }));
}

export function MessageActions({
  actions,
  menuActions = actions,
  menuLabel,
  // Player bubbles keep the old behaviour: the actions only show on hover.
  quiet = false,
}: {
  actions: MessageAction[];
  // The same actions as the kebab's rows run them, when the caller needs to
  // do something first (the DM passage puts the reader's selection back).
  menuActions?: MessageAction[];
  menuLabel: string;
  quiet?: boolean;
}) {
  if (!actions.length) {
    return null;
  }
  return (
    <span className="session-actions">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={action.onSelect}
          disabled={action.disabled || action.busy}
          aria-label={action.label}
          title={action.hint}
          className={cn(ui.iconAction, "-my-1.5", !action.primary && "hidden sm:inline-flex")}
        >
          {action.busy ? <Loader2 className="size-3.5 animate-spin" /> : action.icon}
        </button>
      ))}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={menuLabel}
            title={menuLabel}
            className={cn(ui.iconAction, "-my-1.5", !quiet && "session-actions-more")}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            collisionPadding={12}
            className="panel z-50 max-h-[70vh] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg p-1.5"
          >
            <DropdownMenu.Label className="ctx-menu-label gold-title">{menuLabel}</DropdownMenu.Label>
            {menuActions.map((action) => (
              <DropdownMenu.Item
                key={action.id}
                disabled={action.disabled || action.busy}
                onSelect={action.onSelect}
                className={cn("session-menu-row", action.tone === "danger" && "ctx-item-danger")}
              >
                <GameIcon icon={{ kind: "glyph", key: action.glyph }} size="size-7" />
                <span className="min-w-0">
                  {action.name}
                  {action.hint !== action.name ? <span className="session-menu-hint">{action.hint}</span> : null}
                </span>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </span>
  );
}
