"use client";

import { useState, type FocusEvent, type KeyboardEvent } from "react";

// One tab stop per group of choices (backlog F16), the roving tabindex of the
// WAI-ARIA authoring practices: Tab enters a group on one button and leaves
// it on the next press, and the arrow keys move between the buttons inside.
// Moving only moves focus; Enter or Space chooses, as the buttons always
// did, so arrowing across the standard array never trades a score away.
//
// The buttons keep their own roles and names (toggle buttons with
// aria-pressed); a group marks each one with ROVING_ITEM, and the hook below
// works out which one holds the tab stop.

export const ROVING_ITEM = "data-roving-item";

export type Rect = { left: number; top: number; width: number; height: number };

// Where an arrow key goes along a row: Left and Up back, Right and Down on,
// wrapping at either end; Home and End to the ends. Null for any other key.
export function linearMove(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

// Where an arrow key goes in a card grid, read from where the cards sit on
// screen, so it follows the CSS grid at any width and across the grid's
// group headings. Left and Right run through the cards in reading order and
// wrap; Up and Down go to the nearest card in the row above or below and
// stop at the first and last rows; Home and End go to the first and last
// cards.
export function gridMove(key: string, index: number, rects: Rect[]): number | null {
  const count = rects.length;
  if (key !== "ArrowUp" && key !== "ArrowDown") return linearMove(key, index, count);
  const here = rects[index];
  if (!here) return null;
  const middle = (rect: Rect) => rect.left + rect.width / 2;
  // Half a card's height of slack, so a card nudged by its entrance or a
  // badge still counts as in its row.
  const slack = here.height / 2;
  const down = key === "ArrowDown";
  const beyond = rects
    .map((rect, at) => ({ rect, at }))
    .filter(({ rect }) => (down ? rect.top > here.top + slack : rect.top < here.top - slack));
  if (!beyond.length) return index;
  const rowTop = down ? Math.min(...beyond.map(({ rect }) => rect.top)) : Math.max(...beyond.map(({ rect }) => rect.top));
  const row = beyond.filter(({ rect }) => Math.abs(rect.top - rowTop) <= slack);
  const target = middle(here);
  row.sort((a, b) => Math.abs(middle(a.rect) - target) - Math.abs(middle(b.rect) - target) || a.at - b.at);
  return row[0].at;
}

// Which key holds the group's tab stop: the one last focused while it is
// still shown, else the chosen one, else the first.
export function tabStop(keys: string[], focused: string | null, chosen: string | null | undefined): string | null {
  if (focused !== null && keys.includes(focused)) return focused;
  if (chosen !== null && chosen !== undefined && keys.includes(chosen)) return chosen;
  return keys[0] ?? null;
}

// What a key press inside a group does: moves focus to another item and
// returns its key, or returns null and leaves the press alone (Enter and
// Space reach the button and choose; Tab leaves the group). A modifier
// means another shortcut, a screen reader's or the browser's, so it is left
// alone too.
export function rovingKeyDown(
  event: Pick<KeyboardEvent<HTMLElement>, "key" | "altKey" | "ctrlKey" | "metaKey" | "preventDefault"> & {
    target: EventTarget | null;
    currentTarget: Pick<HTMLElement, "querySelectorAll">;
  },
  layout: "row" | "grid",
): string | null {
  const target = event.target as HTMLElement | null;
  if (event.altKey || event.ctrlKey || event.metaKey || !target?.hasAttribute?.(ROVING_ITEM)) return null;
  const list = [...event.currentTarget.querySelectorAll<HTMLElement>(`[${ROVING_ITEM}]`)];
  const index = list.indexOf(target);
  if (index < 0) return null;
  const next =
    layout === "grid"
      ? gridMove(
          event.key,
          index,
          list.map((item) => item.getBoundingClientRect()),
        )
      : linearMove(event.key, index, list.length);
  if (next === null) return null;
  event.preventDefault();
  const destination = list[next];
  destination.focus();
  return destination.getAttribute(ROVING_ITEM);
}

// The group's state and handlers: `tabIndex(key)` for each item, and the
// two handlers for the element that holds the items. `layout` is "row" for
// a single line of buttons, "grid" for cards in rows and columns.
export function useRovingGroup({
  keys,
  chosen,
  layout = "row",
}: {
  keys: string[];
  chosen?: string | null;
  layout?: "row" | "grid";
}) {
  const [focused, setFocused] = useState<string | null>(null);
  const stop = tabStop(keys, focused, chosen);
  return {
    tabIndex: (key: string) => (key === stop ? 0 : -1),
    // Focus by a click, a "Show me" or the arrows moves the stop with it.
    onFocus: (event: FocusEvent<HTMLElement>) => {
      const key = (event.target as HTMLElement).getAttribute?.(ROVING_ITEM);
      if (key !== null && key !== undefined && key !== focused) setFocused(key);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const key = rovingKeyDown(event, layout);
      if (key !== null) setFocused(key);
    },
  };
}
