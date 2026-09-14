"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Drag as a second way (docs/vtt-parity-implementation-plan.md section
// 10.2). Pointer events, an 8 px threshold before a press becomes a drag
// so a tap stays a tap, a ghost the caller renders at 70 percent, Escape
// cancels, and every drop lands through the same handler the tap path
// uses. Nothing here is drag-only: the phone keeps its tap alternative.

export const DRAG_THRESHOLD_PX = 8;

export type DragState<T> = {
  item: T;
  // Pointer position in client pixels, for the ghost.
  x: number;
  y: number;
  // Where the press began, so the ghost keeps its grip offset.
  startX: number;
  startY: number;
};

export function useDrag<T>(options: {
  // Called with the item and the pointer position where it was dropped.
  onDrop: (item: T, at: { x: number; y: number }) => void;
  onCancel?: () => void;
}) {
  const [dragging, setDragging] = useState<DragState<T> | null>(null);
  const pressRef = useRef<{ item: T; x: number; y: number; pointerId: number } | null>(null);
  const activeRef = useRef(false);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const cancel = useCallback(() => {
    pressRef.current = null;
    if (activeRef.current) {
      activeRef.current = false;
      setDragging(null);
      optionsRef.current.onCancel?.();
    }
  }, []);

  // Attach to the element that may be dragged. `item` is what the drop
  // handler receives.
  const handle = useCallback(
    (item: T) => ({
      onPointerDown: (event: React.PointerEvent) => {
        if (event.button !== 0 && event.pointerType === "mouse") {
          return;
        }
        pressRef.current = { item, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      },
      onPointerMove: (event: React.PointerEvent) => {
        const press = pressRef.current;
        if (!press || press.pointerId !== event.pointerId) {
          return;
        }
        if (!activeRef.current) {
          if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_THRESHOLD_PX) {
            return;
          }
          activeRef.current = true;
          (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        }
        setDragging({ item: press.item, x: event.clientX, y: event.clientY, startX: press.x, startY: press.y });
      },
      onPointerUp: (event: React.PointerEvent) => {
        const press = pressRef.current;
        pressRef.current = null;
        if (!press || !activeRef.current) {
          return;
        }
        activeRef.current = false;
        setDragging(null);
        optionsRef.current.onDrop(press.item, { x: event.clientX, y: event.clientY });
      },
      onPointerCancel: () => cancel(),
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === "Escape") {
          cancel();
        }
      },
    }),
    [cancel],
  );

  return { dragging, handle, cancel, active: dragging !== null };
}

// Which element under the pointer carries a drop target, by data attribute.
export function dropTargetAt(
  x: number,
  y: number,
  attribute: string,
): { element: HTMLElement; value: string } | null {
  if (typeof document === "undefined") {
    return null;
  }
  const hit = document.elementFromPoint(x, y) as HTMLElement | null;
  const target = hit?.closest?.(`[data-${attribute}]`) as HTMLElement | null;
  if (!target) {
    return null;
  }
  const value = target.dataset[attribute.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())];
  return value === undefined ? null : { element: target, value };
}
