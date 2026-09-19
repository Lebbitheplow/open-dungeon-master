"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { overlayRoot } from "@/lib/overlay-root";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/effects-mode";

// The menu a card answers with: right-click on a desktop, a long press on a
// phone, the menu key on a keyboard (docs/visual-overhaul-plan.md 8c.7).
//
//   <ContextMenu label={campaign.title} items={[
//     { id: "open", label: "Open", glyph: "tab-campaigns", onSelect: open },
//     { id: "delete", label: "Delete", glyph: "quest-failed", tone: "danger", onSelect: remove },
//   ]}>
//     <CampaignTile ... />
//   </ContextMenu>
//
// It is a second door, never the only one: every action a host lists here
// stays on the card as the button it always was.
//
// Built on the dropdown menu (the context-menu package is not installed): the
// menu is controlled, and its trigger is an invisible one-pixel anchor moved
// to the pointer. The anchor is portalled to the body because the cards tilt
// on a transform, and a fixed element inside a transformed parent is placed
// against that parent, not the screen.

export type ContextMenuItem = {
  id: string;
  label: string;
  // A file name under public/assets/icons/glyph, without the extension.
  glyph: string;
  tone?: "danger";
  disabled?: boolean;
  // A thin rule above this item, to set a group apart.
  separated?: boolean;
  onSelect: () => void;
};

const LONG_PRESS_MS = 480;
// A finger drifts a little while it waits; further than this is a scroll.
const MOVE_CANCEL_PX = 10;

const itemClass =
  "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800 data-[highlighted]:text-amber-100 data-[disabled]:cursor-default data-[disabled]:opacity-40";

// Text fields keep the browser's own menu: paste and spellcheck live there.
function isTextTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  return Boolean(element?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}

export function ContextMenu({
  items,
  label,
  as: Tag = "div",
  className,
  children,
}: {
  items: ContextMenuItem[];
  // What the menu is about, shown as its heading.
  label?: string;
  as?: "div" | "li";
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const hostRef = useRef<HTMLElement | null>(null);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  // A long press ends in a click on some browsers; that click is the press
  // being lifted, not a wish to open the card.
  const swallowClick = useRef(false);

  function clearPress() {
    if (press.current) {
      window.clearTimeout(press.current.timer);
      press.current = null;
    }
    hostRef.current?.removeAttribute("data-pressing");
  }

  useEffect(() => clearPress, []);

  // While the menu is up the browser's own never joins it (Android raises a
  // link menu on the same long press).
  useEffect(() => {
    if (!open) return;
    const block = (event: Event) => event.preventDefault();
    document.addEventListener("contextmenu", block, true);
    return () => document.removeEventListener("contextmenu", block, true);
  }, [open]);

  function openAt(x: number, y: number) {
    setPoint({ x, y });
    setOpen(true);
  }

  // React events bubble through portals, so a press inside a menu this card
  // opened (its export menu, this menu) arrives here too. Only the card's own
  // DOM counts.
  function fromHost(event: { target: EventTarget; currentTarget: EventTarget }): boolean {
    return event.currentTarget instanceof Node && event.target instanceof Node && event.currentTarget.contains(event.target);
  }

  function onContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (!items.length || event.shiftKey || !fromHost(event) || isTextTarget(event.target)) {
      return;
    }
    event.preventDefault();
    if (press.current) {
      // Android's long press arrives as this event, ahead of the timer.
      swallowClick.current = true;
      clearPress();
    }
    if (open) return;
    let { clientX: x, clientY: y } = event;
    if (x === 0 && y === 0 && event.target instanceof Element) {
      // The menu key has no pointer; hang the menu off the focused element.
      const rect = event.target.getBoundingClientRect();
      x = rect.left + Math.min(rect.width / 2, 32);
      y = rect.top + Math.min(rect.height / 2, 32);
    }
    openAt(x, y);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    swallowClick.current = false;
    if (event.pointerType === "mouse" || !items.length || !fromHost(event) || isTextTarget(event.target)) {
      return;
    }
    clearPress();
    const { clientX: x, clientY: y } = event;
    hostRef.current?.setAttribute("data-pressing", "");
    press.current = {
      x,
      y,
      timer: window.setTimeout(() => {
        press.current = null;
        hostRef.current?.removeAttribute("data-pressing");
        swallowClick.current = true;
        haptic("tap");
        openAt(x, y);
      }, LONG_PRESS_MS),
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const held = press.current;
    if (held && Math.hypot(event.clientX - held.x, event.clientY - held.y) > MOVE_CANCEL_PX) {
      clearPress();
    }
  }

  function onClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (swallowClick.current) {
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <Tag
      ref={(node: HTMLElement | null) => {
        hostRef.current = node;
      }}
      className={cn("ctx-host", className)}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onPointerLeave={clearPress}
      onClickCapture={onClickCapture}
    >
      {children}
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        {open && typeof document !== "undefined"
          ? createPortal(
              <DropdownMenu.Trigger asChild>
                <span aria-hidden="true" tabIndex={-1} className="ctx-anchor" style={{ left: point.x, top: point.y }} />
              </DropdownMenu.Trigger>,
              overlayRoot(),
            )
          : null}
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="bottom"
            align="start"
            sideOffset={2}
            collisionPadding={12}
            // Focus would go back to the invisible anchor; leave it be.
            onCloseAutoFocus={(event) => event.preventDefault()}
            className="panel ctx-menu z-50 min-w-52 p-1.5"
          >
            {label ? <DropdownMenu.Label className="ctx-menu-label gold-title">{label}</DropdownMenu.Label> : null}
            {items.map((item) => (
              <Fragment key={item.id}>
                {item.separated ? <DropdownMenu.Separator className="my-1 h-px bg-stone-800" /> : null}
                <DropdownMenu.Item
                  disabled={item.disabled}
                  onSelect={item.onSelect}
                  className={cn(itemClass, item.tone === "danger" && "ctx-item-danger")}
                >
                  <GameIcon icon={{ kind: "glyph", key: item.glyph }} size="size-6" />
                  {item.label}
                </DropdownMenu.Item>
              </Fragment>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </Tag>
  );
}
