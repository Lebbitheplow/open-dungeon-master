"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_STROKES, type Brush as BrushName, type Stroke } from "@/lib/battlemap/paint";
import type { XY } from "@/lib/battlemap/types";

// What sits between a drawing surface and the paint route: a dragged brush
// coalesced into one request per drag, and an undo that remembers the
// terrain before each edit.
//
// Shared by the studio and the library, which send to different routes but
// paint the same way. The hook never decides what a legal map is; it only
// decides when to send and what to send back on undo.
//
// Undo is "return to this terrain", which the server compiles into the
// strokes that differ (src/lib/battlemap/tools.ts) and validates like any
// other paint. So an undo on a live board with someone standing where the
// wall was is refused with the same sentence a fresh wall would get, and the
// history entry is kept for when they move.

const HISTORY = 30;
// Long enough to bundle the tiles a finger crosses in one motion, short
// enough that the board follows the hand.
const FLUSH_MS = 90;

export function usePainter({
  key,
  terrain,
  send,
}: {
  // Which map the history belongs to; changing it starts fresh.
  key: string;
  terrain: string;
  // Sends one paint body; resolves true when the server took it.
  send: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const historyRef = useRef<{ key: string; past: string[]; future: string[] }>({
    key,
    past: [],
    future: [],
  });
  const [counts, setCounts] = useState({ past: 0, future: 0 });
  const pendingRef = useRef<Stroke[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef(false);
  const terrainRef = useRef(terrain);
  useEffect(() => {
    terrainRef.current = terrain;
  }, [terrain]);

  useEffect(() => {
    if (historyRef.current.key !== key) {
      historyRef.current = { key, past: [], future: [] };
      setCounts({ past: 0, future: 0 });
    }
  }, [key]);

  const sync = () =>
    setCounts({ past: historyRef.current.past.length, future: historyRef.current.future.length });

  const remember = useCallback(() => {
    const history = historyRef.current;
    history.past.push(terrainRef.current);
    if (history.past.length > HISTORY) {
      history.past.shift();
    }
    history.future = [];
    sync();
  }, []);

  // One edit that is not a drag: a stamp, a shape, a fill.
  const edit = useCallback(
    async (body: Record<string, unknown>) => {
      remember();
      const ok = await send(body);
      if (!ok) {
        historyRef.current.past.pop();
        sync();
      }
      return ok;
    },
    [remember, send],
  );

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const strokes = pendingRef.current;
    pendingRef.current = [];
    for (let at = 0; at < strokes.length; at += MAX_STROKES) {
      const ok = await send({ strokes: strokes.slice(at, at + MAX_STROKES) });
      if (!ok) {
        break;
      }
    }
  }, [send]);

  const stroke = useCallback(
    (x: number, y: number, brush: BrushName, radius: number) => {
      if (!dragRef.current) {
        dragRef.current = true;
        remember();
      }
      pendingRef.current.push({ x, y, brush, ...(radius ? { radius } : {}) });
      if (!timerRef.current) {
        timerRef.current = setTimeout(() => void flush(), FLUSH_MS);
      }
    },
    [flush, remember],
  );

  const strokeEnd = useCallback(() => {
    dragRef.current = false;
    void flush();
  }, [flush]);

  const undo = useCallback(async () => {
    const history = historyRef.current;
    const previous = history.past.pop();
    if (previous === undefined) {
      return;
    }
    const now = terrainRef.current;
    const ok = await send({ replaceTerrain: previous });
    if (ok) {
      history.future.push(now);
    } else {
      history.past.push(previous);
    }
    sync();
  }, [send]);

  const redo = useCallback(async () => {
    const history = historyRef.current;
    const next = history.future.pop();
    if (next === undefined) {
      return;
    }
    const now = terrainRef.current;
    const ok = await send({ replaceTerrain: next });
    if (ok) {
      history.past.push(now);
    } else {
      history.future.push(next);
    }
    sync();
  }, [send]);

  return {
    edit,
    stroke,
    strokeEnd,
    shape: (tool: string, brush: BrushName, from: XY, to: XY) =>
      edit({ shape: { tool, brush, from, to } }),
    undo,
    redo,
    canUndo: counts.past > 0,
    canRedo: counts.future > 0,
  };
}
