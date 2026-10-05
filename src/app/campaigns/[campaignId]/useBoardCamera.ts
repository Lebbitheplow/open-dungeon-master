"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TILE } from "@/app/campaigns/[campaignId]/battleMapCells";
import { prefersReducedMotion } from "@/lib/effects-mode";
import { clampZoomTo, fitCamera, minZoomFor } from "@/lib/battlemap/camera-fit";
import type { CameraEvent } from "@/lib/scene/state";

// Zoom and pan for the live board (docs/vtt-parity-implementation-plan.md
// section 1.2, "Camera"): wheel at the cursor, pinch on touch, a drag on the
// ground, corner buttons, a "follow the turn" pan that eases over
// --dur-scene, and the DM's pull and lock through the `camera` event. The
// board itself is not touched; the camera is a transform on the frame
// around it. The view rests on the fit (src/lib/battlemap/camera-fit.ts):
// the whole board, whatever the shape of the window it is shown in.

export type Camera = { zoom: number; x: number; y: number };

// One mouse-wheel notch (100 pixels of scroll) zooms by 1.12; a trackpad
// pinch sends many small deltas and zooms in proportion.
const WHEEL_RATE = Math.log(1.12) / 100;
const IDENTITY: Camera = { zoom: 1, x: 0, y: 0 };
// How far a press travels before it is a drag of the view and not a tap.
const PAN_SLOP = 6;
// What a press on the board must not start a drag of the view from: a
// figure (its own drag), a control, or a surface that reads the drag itself.
const NO_PAN = "[data-token-id], [data-no-pan], button, a, input, select, textarea";

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
  // The frame as state too, so the native listeners below follow it when
  // the board moves between the side panel and the enlarged view (a new
  // element each time).
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);
  const attachFrame = useCallback((element: HTMLDivElement | null) => {
    frameRef.current = element;
    setFrameEl(element);
  }, []);
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
  const panRef = useRef<{ id: number; x: number; y: number; cx: number; cy: number; active: boolean } | null>(null);
  // A drag of the view ends in a click on whatever lies under the pointer;
  // that click is the drag's, not a tap on a tile.
  const pannedRef = useRef(false);
  // True while the view rests on the fit, so a window that changes shape
  // re-fits instead of leaving the board half out of it. Any move the
  // viewer makes clears it; "Fit the board" sets it again.
  const fittedRef = useRef(true);

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

  const fit = useCallback((): Camera => {
    const m = metrics();
    return m ? fitCamera(m, { width: boardWidth, height: boardHeight }) : IDENTITY;
  }, [metrics, boardWidth, boardHeight]);
  const clampZoom = useCallback((zoom: number) => clampZoomTo(zoom, minZoomFor(fit())), [fit]);

  const zoomAt = useCallback(
    (nextZoom: number, px: number, py: number) => {
      setEased(false);
      fittedRef.current = false;
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
    [clampZoom],
  );

  const reset = useCallback(() => {
    setEased(true);
    fittedRef.current = true;
    setCamera(fit());
  }, [fit]);

  // Centre a tile in the frame at a zoom, easing over --dur-scene.
  const centreOn = useCallback(
    (tile: { x: number; y: number }, zoom?: number) => {
      const m = metrics();
      if (!m) {
        return;
      }
      setEased(!prefersReducedMotion());
      fittedRef.current = false;
      setCamera((current) => {
        const z = clampZoom(zoom ?? current.zoom);
        const tx = (tile.x + 0.5) * TILE * m.unit * z;
        const ty = (tile.y + 0.5) * TILE * m.unit * z;
        return { zoom: z, x: m.width / 2 - tx, y: m.height / 2 - ty };
      });
    },
    [metrics, clampZoom],
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
  // token is the board's, not the camera's). The wheel is a native
  // non-passive listener: React's onWheel is passive, so it could not stop
  // the panel scrolling under the zoom, nor a trackpad pinch or Ctrl+wheel
  // zooming the whole page along with the board (issue 67).
  useEffect(() => {
    if (!frameEl || locked) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = frameEl.getBoundingClientRect();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 600 : 1);
      const factor = Math.exp(-Math.max(-100, Math.min(100, pixels)) * WHEEL_RATE);
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setEased(false);
      fittedRef.current = false;
      setCamera((current) => {
        const zoom = clampZoom(current.zoom * factor);
        const ratio = zoom / current.zoom;
        return { zoom, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
      });
    };
    frameEl.addEventListener("wheel", onWheel, { passive: false });
    return () => frameEl.removeEventListener("wheel", onWheel);
  }, [frameEl, locked, clampZoom]);

  // The pan is held in the frame's pixels and the board fills the frame's
  // width, so when the frame changes width (browser zoom, a resized window,
  // the enlarged view) the pan scales with it and the same part of the
  // board stays in view. Without this a zoomed-in view slid off to one side
  // on every resize (issue 67). A hidden frame (width 0) keeps the view for
  // when it shows again. A view still resting on the fit is simply fitted
  // again, which is also how a board first lands whole in a fixed window
  // (issue 87).
  const frameWidth = useRef(0);
  useEffect(() => {
    if (!frameEl) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const width = frameEl.clientWidth;
      if (!width) {
        return;
      }
      const before = frameWidth.current;
      frameWidth.current = width;
      if (fittedRef.current) {
        const next = fit();
        setEased(false);
        setCamera((current) =>
          current.zoom === next.zoom && current.x === next.x && current.y === next.y ? current : next,
        );
        return;
      }
      if (!before || before === width) {
        return;
      }
      const ratio = width / before;
      setEased(false);
      setCamera((current) =>
        current.x || current.y ? { ...current, x: current.x * ratio, y: current.y * ratio } : current,
      );
    });
    observer.observe(frameEl);
    return () => observer.disconnect();
  }, [frameEl, fit]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const onPointerDown = useCallback((event: React.PointerEvent) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pannedRef.current = false;
    const frame = frameRef.current;
    const onGround = !(event.target as HTMLElement).closest?.(NO_PAN);
    // A press on the board gives it the keyboard: a tile that handles its
    // own press would otherwise leave the arrow keys with whatever had
    // them, and nothing would say why they do nothing (issue 90).
    if (frame && onGround && document.activeElement !== frame) {
      frame.focus({ preventScroll: true });
    }
    // One pointer on the ground may drag the view. A finger does only where
    // the frame is a fixed window: elsewhere that drag scrolls the page.
    const mayPan =
      frame &&
      onGround &&
      pointers.current.size === 1 &&
      (event.pointerType === "touch"
        ? getComputedStyle(frame).touchAction === "none"
        : event.button === 0 || event.button === 1);
    panRef.current = mayPan
      ? { id: event.pointerId, x: event.clientX, y: event.clientY, cx: cameraRef.current.x, cy: cameraRef.current.y, active: false }
      : null;
    if (pointers.current.size === 2) {
      panRef.current = null;
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
        return;
      }
      const pan = panRef.current;
      if (!pan || pan.id !== event.pointerId) {
        return;
      }
      const dx = event.clientX - pan.x;
      const dy = event.clientY - pan.y;
      if (!pan.active) {
        if (Math.hypot(dx, dy) < PAN_SLOP) {
          return;
        }
        pan.active = true;
        pannedRef.current = true;
        fittedRef.current = false;
        frameRef.current?.setPointerCapture?.(event.pointerId);
        frameRef.current?.setAttribute("data-panning", "");
      }
      setEased(false);
      setCamera((current) => ({ ...current, x: pan.cx + dx, y: pan.cy + dy }));
    },
    [locked, zoomAt, clampZoom],
  );
  const onPointerUp = useCallback((event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) {
      pinchRef.current = null;
    }
    panRef.current = null;
    frameRef.current?.removeAttribute("data-panning");
  }, []);
  // Capture phase, so the tile under a finished drag never hears of it.
  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (pannedRef.current) {
      pannedRef.current = false;
      event.stopPropagation();
      event.preventDefault();
    }
  }, []);

  // Keyboard pans while the frame is focused; plus and minus zoom. A key
  // held with Ctrl, Cmd or Alt is the browser's (Ctrl+plus zooms the page):
  // taking it too zoomed the board along with the page, and once the page
  // reflowed and the board lost focus the zoom back out never reached it,
  // leaving a few huge tiles (issue 67).
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (locked || event.ctrlKey || event.metaKey || event.altKey) {
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
        fittedRef.current = false;
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
    attachFrame,
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
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onClickCapture,
      onKeyDown,
    },
  };
}
