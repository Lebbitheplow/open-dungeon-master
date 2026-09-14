"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TILE } from "@/app/campaigns/[campaignId]/battleMapCells";
import { prefersReducedMotion } from "@/lib/effects-mode";
import type { CameraEvent } from "@/lib/scene/state";

// Zoom and pan for the live board (docs/vtt-parity-implementation-plan.md
// section 1.2, "Camera"): wheel at the cursor, pinch on touch, corner
// buttons, a "follow the turn" pan that eases over --dur-scene, and the
// DM's pull and lock through the `camera` event. The board itself is not
// touched; the camera is a transform on the frame around it.

export type Camera = { zoom: number; x: number; y: number };

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3;
const IDENTITY: Camera = { zoom: 1, x: 0, y: 0 };

function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function useBoardCamera(
  boardWidth: number,
  boardHeight: number,
  options: {
    followTurn: boolean;
    turnTile: { x: number; y: number } | null;
    remote: CameraEvent | null;
    onRemoteHandled: () => void;
    // The DM steering everyone else's view is not steered themselves.
    isDirector: boolean;
  },
) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [camera, setCamera] = useState<Camera>(IDENTITY);
  // A mirror for effects that need the camera without depending on it.
  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);
  // Whether a transition should ease (a pull, a follow) or snap (a wheel).
  const [eased, setEased] = useState(false);
  const [locked, setLocked] = useState(false);
  // The escape hatch opens ten seconds into a lock.
  const [canRelease, setCanRelease] = useState(false);
  useEffect(() => {
    if (!locked) {
      return;
    }
    const timer = window.setTimeout(() => setCanRelease(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [locked]);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  // Frame size in CSS pixels, and the scale from SVG units to pixels.
  const metrics = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) {
      return null;
    }
    const width = frame.clientWidth;
    const height = frame.clientHeight || (width * boardHeight) / boardWidth;
    return { width, height, unit: width / (boardWidth * TILE) };
  }, [boardWidth, boardHeight]);

  const zoomAt = useCallback(
    (nextZoom: number, px: number, py: number) => {
      setEased(false);
      setCamera((current) => {
        const zoom = clampZoom(nextZoom);
        // Keep the point under the cursor fixed.
        const ratio = zoom / current.zoom;
        return {
          zoom,
          x: px - (px - current.x) * ratio,
          y: py - (py - current.y) * ratio,
        };
      });
    },
    [],
  );

  const reset = useCallback(() => {
    setEased(true);
    setCamera(IDENTITY);
  }, []);

  // Centre a tile in the frame at a zoom, easing over --dur-scene.
  const centreOn = useCallback(
    (tile: { x: number; y: number }, zoom?: number) => {
      const m = metrics();
      if (!m) {
        return;
      }
      setEased(!prefersReducedMotion());
      setCamera((current) => {
        const z = clampZoom(zoom ?? current.zoom);
        const tx = (tile.x + 0.5) * TILE * m.unit * z;
        const ty = (tile.y + 0.5) * TILE * m.unit * z;
        return { zoom: z, x: m.width / 2 - tx, y: m.height / 2 - ty };
      });
    },
    [metrics],
  );

  const isOffScreen = useCallback(
    (tile: { x: number; y: number }, cam: Camera) => {
      const m = metrics();
      if (!m) {
        return false;
      }
      const px = (tile.x + 0.5) * TILE * m.unit * cam.zoom + cam.x;
      const py = (tile.y + 0.5) * TILE * m.unit * cam.zoom + cam.y;
      const margin = TILE * m.unit * cam.zoom;
      return px < margin || py < margin || px > m.width - margin || py > m.height - margin;
    },
    [metrics],
  );

  // Follow the turn: pan to the current token when it is off screen.
  const { followTurn, turnTile } = options;
  const turnKey = turnTile ? `${turnTile.x},${turnTile.y}` : "";
  useEffect(() => {
    if (!followTurn || !turnTile) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (isOffScreen(turnTile, cameraRef.current)) {
        centreOn(turnTile);
      }
    });
    return () => cancelAnimationFrame(frame);
    // turnKey stands in for the tile's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followTurn, turnKey, centreOn, isOffScreen]);

  // The DM's camera: pull once, lock until freed, with an escape hatch
  // after ten seconds so nobody is trapped.
  const { remote, onRemoteHandled, isDirector } = options;
  useEffect(() => {
    if (!remote) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (!isDirector) {
        if (remote.mode === "free") {
          setLocked(false);
          setCanRelease(false);
        } else if (typeof remote.x === "number" && typeof remote.y === "number") {
          centreOn({ x: remote.x, y: remote.y }, remote.zoom);
          if (remote.mode === "lock") {
            setLocked(true);
            setCanRelease(false);
          }
        }
      }
      onRemoteHandled();
    });
    return () => cancelAnimationFrame(frame);
  }, [remote, isDirector, centreOn, onRemoteHandled]);

  const release = useCallback(() => {
    setLocked(false);
    setCanRelease(false);
  }, []);

  // Pointer handling on the frame: wheel zooms at the cursor; two fingers
  // pinch; a drag on the frame background pans (a drag that starts on a
  // token is the board's, not the camera's).
  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      if (locked) {
        return;
      }
      event.preventDefault();
      const rect = frameRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      setCamera((current) => {
        const zoom = clampZoom(current.zoom * factor);
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const ratio = zoom / current.zoom;
        return { zoom, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
      });
      setEased(false);
    },
    [locked],
  );

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const onPointerDown = useCallback((event: React.PointerEvent) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: 0 };
      setCamera((current) => {
        pinchRef.current = { distance: pinchRef.current?.distance ?? 1, zoom: current.zoom };
        return current;
      });
    }
  }, []);
  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (locked) {
        return;
      }
      if (!pointers.current.has(event.pointerId)) {
        return;
      }
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.current.size === 2 && pinchRef.current) {
        const [a, b] = [...pointers.current.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const rect = frameRef.current?.getBoundingClientRect();
        if (!rect) {
          return;
        }
        const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
        const zoom = clampZoom((pinchRef.current.zoom * distance) / Math.max(1, pinchRef.current.distance));
        zoomAt(zoom, mid.x, mid.y);
        event.preventDefault();
      }
    },
    [locked, zoomAt],
  );
  const onPointerUp = useCallback((event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) {
      pinchRef.current = null;
    }
    panRef.current = null;
  }, []);

  // Keyboard pans while the frame is focused; plus and minus zoom.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (locked) {
        return;
      }
      const step = 40;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [step, 0],
        ArrowRight: [-step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
      };
      if (moves[event.key]) {
        event.preventDefault();
        setEased(false);
        setCamera((current) => ({
          ...current,
          x: current.x + moves[event.key][0],
          y: current.y + moves[event.key][1],
        }));
      } else if (event.key === "+" || event.key === "=") {
        const m = metrics();
        if (m) {
          zoomAt(camera.zoom * 1.2, m.width / 2, m.height / 2);
        }
      } else if (event.key === "-") {
        const m = metrics();
        if (m) {
          zoomAt(camera.zoom / 1.2, m.width / 2, m.height / 2);
        }
      } else if (event.key === "0") {
        reset();
      }
    },
    [locked, metrics, zoomAt, camera.zoom, reset],
  );

  const zoomIn = useCallback(() => {
    const m = metrics();
    if (m) {
      zoomAt(camera.zoom * 1.25, m.width / 2, m.height / 2);
    }
  }, [metrics, zoomAt, camera.zoom]);
  const zoomOut = useCallback(() => {
    const m = metrics();
    if (m) {
      zoomAt(camera.zoom / 1.25, m.width / 2, m.height / 2);
    }
  }, [metrics, zoomAt, camera.zoom]);

  // The centre tile and zoom, for the DM's "pull everyone here".
  const describe = useCallback((): { x: number; y: number; zoom: number } | null => {
    const m = metrics();
    if (!m) {
      return null;
    }
    const unit = TILE * m.unit * camera.zoom;
    return {
      x: Math.round((m.width / 2 - camera.x) / unit - 0.5),
      y: Math.round((m.height / 2 - camera.y) / unit - 0.5),
      zoom: Number(camera.zoom.toFixed(2)),
    };
  }, [metrics, camera]);

  return {
    frameRef,
    camera,
    eased,
    locked,
    canRelease,
    release,
    reset,
    zoomIn,
    zoomOut,
    centreOn,
    describe,
    frameProps: {
      onWheel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onKeyDown,
    },
  };
}
