"use client";

import { useCallback, useEffect, useRef } from "react";
import { rollToDiceBoxNotation } from "@/lib/dice-notation";
import { diceLookKey, diceLookTheme } from "@/lib/dice/dice-look";
import {
  captureListeners,
  DICE_IDLE_MS,
  DICE_QUEUE_MAX,
  DICE_ROLL_DEADLINE_MS,
  freshRolls,
  holdAfterThrow,
  releaseListeners,
  settleWithin,
  trayBuildAllowed,
  type CapturedListener,
  type QueuedRoll,
} from "@/lib/dice/dice-box-lifecycle";
import { hydrateDiceLook, useDiceLook } from "@/lib/dice/dice-look-store";
import type { StoredRoll } from "@/lib/db/rolls";
import { shellHost } from "@/lib/shell-host";

// Full-screen 3D dice tray: rolls arriving over SSE replay with baked
// physics, forced to land on the server's authoritative values
// (dice-box-threejs "2d20@12,15" notation). Purely cosmetic; the RollCard
// chips in chat remain the durable record, and any init failure (no
// WebGL) silently falls back to chips alone.

type DiceBoxInstance = {
  initialize: () => Promise<void>;
  roll: (notation: string) => Promise<unknown>;
  clearDice: () => void;
  updateConfig: (config: Record<string, unknown>) => Promise<void>;
  renderer?: {
    dispose: () => void;
    forceContextLoss: () => void;
    domElement: HTMLCanvasElement;
  };
};

// A built tray: the box plus the window listener it registered during
// initialize(), which the library never removes on its own.
type Tray = { box: DiceBoxInstance; listeners: CapturedListener[]; overlay: Window | null; disposed?: boolean };

export type OverlayRoll = { roll: StoredRoll; source: string; seq: number };

// The native HWND covers web canvases; an owned transparent layer preserves the same renderer.
function foregroundDice(canvas?: HTMLCanvasElement): Window | null {
  const frame = document.querySelector("iframe[data-native-board-active]");
  if (!canvas || shellHost()?.platform !== "desktop" || !frame?.getClientRects().length) return null;
  let overlay: Window | null = null;
  const parent = canvas.parentElement;
  try {
    overlay = window.open("about:blank", "odm-native-dice-overlay");
    if (!overlay) return null;
    overlay.document.title = "ODM dice";
    overlay.document.documentElement.style.cssText = "width:100%;height:100%;background:transparent";
    overlay.document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:transparent";
    canvas.style.background = "transparent";
    overlay.document.body.appendChild(canvas);
    overlay.document.body.style.zoom = String(window.devicePixelRatio / overlay.devicePixelRatio);
    return overlay;
  } catch {
    parent?.appendChild(canvas);
    overlay?.close();
    return null;
  }
}

// Firefox caps live WebGL contexts (~32) and loses the oldest past that, so
// every orphaned context from an undisposed box brings the tab closer to a
// wedge; tear the renderer down whenever the overlay unmounts or the tray
// has sat idle (DICE_IDLE_MS), and take the resize listener with it so a
// later window resize never reaches a disposed renderer. It is also how a
// stuck throw is cleared (issue 668): removing the canvas is the one step
// that guarantees nothing stays drawn, whatever state the library is in.
// Safe to call twice: forceContextLoss below fires the context-lost
// listener, which disposes the same tray again.
function disposeTray(tray: Tray | null) {
  if (!tray || tray.disposed) {
    return;
  }
  tray.disposed = true;
  releaseListeners(window, tray.listeners);
  try {
    tray.box.clearDice();
  } catch {
    // Disposal must never throw during unmount.
  }
  try {
    tray.box.renderer?.dispose();
    tray.box.renderer?.forceContextLoss();
    tray.box.renderer?.domElement.remove();
  } catch {
    // Same: a half-initialized renderer is fine to abandon.
  }
  try { tray.overlay?.close(); } catch { /* The owner may already have closed. */ }
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

// The browser scenarios read whether a throw is on screen from the overlay's
// data-dice (scripts/browser/scenarios/106-dice-clear.mjs). A DOM write, not
// state, so it never re-renders the table.
function markTray(overlay: HTMLDivElement | null, state: "rolling" | "idle") {
  if (overlay) overlay.dataset.dice = state;
}

function newestSeq(rolls: readonly OverlayRoll[]): number {
  return rolls.reduce((top, entry) => Math.max(top, entry.seq), 0);
}

export function DiceOverlay({
  rolls,
  enabled,
}: {
  // The last few rolls the stream heard, oldest first. A list rather than
  // the latest one, because an enemy's attack and damage can arrive in one
  // render and the attack's throw used to be lost (issue 668).
  rolls: readonly OverlayRoll[];
  enabled: boolean;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const trayRef = useRef<Tray | null>(null);
  const idleTimerRef = useRef(0);
  const buildFailuresRef = useRef(0);
  const webglRef = useRef<boolean | null>(null);
  const queueRef = useRef<QueuedRoll[]>([]);
  const animatingRef = useRef(false);
  // Only rolls that arrive after mount animate; the snapshot backlog and
  // reconnect replays stay silent. The watermark starts at whatever the
  // stream already holds (0 on a table nothing has rolled at yet), so the
  // first roll of a fresh table, and the first after the dice are switched
  // back on, tumbles like every later one instead of passing for backlog.
  const seenSeqRef = useRef<number>(newestSeq(rolls));
  const unmountedRef = useRef(false);
  // The player's own dice (src/lib/dice/dice-look.ts). The box is themed
  // from whatever the look is when it is first built, and re-themed in
  // place when the look changes, so a tweak in the editor shows on the
  // very next roll without a new WebGL context.
  const look = useDiceLook();
  const lookRef = useRef(look);
  const themedRef = useRef("");
  useEffect(() => {
    hydrateDiceLook();
  }, []);
  useEffect(() => {
    lookRef.current = look;
  }, [look]);

  const dropTray = useCallback(() => {
    const tray = trayRef.current;
    trayRef.current = null;
    themedRef.current = "";
    disposeTray(tray);
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    const alignOverlay = () => {
      const overlay = trayRef.current?.overlay;
      if (overlay && !overlay.closed) overlay.document.body.style.zoom = String(window.devicePixelRatio / overlay.devicePixelRatio);
    };
    // A hidden tab pauses requestAnimationFrame, so a throw in flight would
    // freeze mid-air and every roll after it would pile up and replay stale
    // when the seat came back (issue 668). Hidden: drop the waiting rolls
    // and the tray in use; the deadline then releases the throw that was in
    // flight. The chip and the roll toast still show every number.
    const onVisibility = () => {
      if (!document.hidden) return;
      queueRef.current = [];
      if (animatingRef.current) dropTray();
    };
    window.addEventListener("resize", alignOverlay);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("resize", alignOverlay);
      document.removeEventListener("visibilitychange", onVisibility);
      unmountedRef.current = true;
      queueRef.current = [];
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = 0;
      dropTray();
    };
  }, [dropTray]);

  const pump = useCallback(async () => {
    if (animatingRef.current) {
      return;
    }
    queueRef.current = freshRolls(queueRef.current, performance.now());
    const next = queueRef.current.shift();
    if (!next) {
      return;
    }
    animatingRef.current = true;
    markTray(overlayRef.current, "rolling");
    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = 0;
    let tray: Tray | null = null;
    let wedged = false;
    try {
      const box = await ensureBox();
      tray = trayRef.current;
      if (box && tray) {
        if (!tray.overlay || tray.overlay.closed) tray.overlay = foregroundDice(box.renderer?.domElement);
        const wanted = diceLookKey(lookRef.current);
        if (themedRef.current !== wanted) {
          // Marked themed only once the theme took, so a re-theme that
          // failed is tried again on the next roll (issue 668).
          const themed = await settleWithin(box.updateConfig(diceLookTheme(lookRef.current)), DICE_ROLL_DEADLINE_MS);
          if (themed === "done") themedRef.current = wanted;
        }
        for (const notation of next.notations) {
          const thrown = await settleWithin(box.roll(notation), DICE_ROLL_DEADLINE_MS);
          if (thrown !== "done") {
            wedged = true;
            break;
          }
          if (unmountedRef.current || trayRef.current !== tray) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, holdAfterThrow(queueRef.current.length)));
        }
      }
    } catch {
      // A wedged animation must never block the game.
      wedged = true;
    } finally {
      // The clear always runs now (issue 668). A throw that failed or never
      // finished takes its whole tray with it: the library may be stuck
      // mid-frame, and removing the canvas is the only clear that cannot
      // itself be left half done. The next roll builds a fresh tray.
      if (tray) {
        if (wedged || tray.disposed) {
          if (trayRef.current === tray) dropTray();
          else disposeTray(tray);
        } else {
          try {
            tray.box.clearDice();
          } catch {
            if (trayRef.current === tray) dropTray();
          }
        }
      }
      animatingRef.current = false;
      if (queueRef.current.length) {
        void pump();
      } else {
        markTray(overlayRef.current, "idle");
        if (trayRef.current && !unmountedRef.current) {
          // Nothing left to show: let the context go after a quiet spell. The
          // next roll rebuilds the tray (theme load plus WebGL init), which is
          // the same path the very first roll takes.
          idleTimerRef.current = window.setTimeout(() => {
            idleTimerRef.current = 0;
            if (animatingRef.current || queueRef.current.length) {
              return;
            }
            dropTray();
          }, DICE_IDLE_MS);
        }
      }
    }

    async function ensureBox(): Promise<DiceBoxInstance | null> {
      if (trayRef.current) {
        return trayRef.current.box;
      }
      if (webglRef.current === null) webglRef.current = webglAvailable();
      // A failed build used to switch 3D dice off until reload, even when it
      // was only a theme texture that failed to load; it is retried once
      // now, and never on a device without WebGL (issue 668).
      if (!trayBuildAllowed(buildFailuresRef.current, webglRef.current)) {
        return null;
      }
      try {
        const { default: DiceBox } = await import("@3d-dice/dice-box-threejs");
        // Shadows stay on everywhere, phones included: Kaleb wants the full
        // look on every device (decided 2026-09-22).
        const box = new DiceBox("#dice-overlay", {
          assetPath: "/dice-box/",
          sounds: false,
          shadows: true,
          light_intensity: 0.8,
          baseScale: 85,
          ...diceLookTheme(lookRef.current),
        }) as unknown as DiceBoxInstance;
        themedRef.current = diceLookKey(lookRef.current);
        // The resize listener is added before initialize()'s first await,
        // so the capture only spans that synchronous stretch.
        const { result: ready, captured } = captureListeners(window, ["resize"], () => box.initialize());
        const tray: Tray = { box, listeners: captured, overlay: null };
        try {
          await ready;
        } catch (error) {
          disposeTray(tray);
          throw error;
        }
        if (unmountedRef.current) {
          disposeTray(tray);
          return null;
        }
        trayRef.current = tray;
        // A lost context (the GPU reset, too many contexts open) leaves a
        // dead canvas holding its last frame; drop it so the next roll
        // builds a working tray (issue 668).
        box.renderer?.domElement.addEventListener("webglcontextlost", () => {
          if (trayRef.current === tray) dropTray();
          else disposeTray(tray);
        });
        return box;
      } catch {
        buildFailuresRef.current += 1;
        return null;
      }
    }
  }, [dropTray]);

  useEffect(() => {
    const unseen = rolls.filter((entry) => entry.seq > seenSeqRef.current).sort((a, b) => a.seq - b.seq);
    if (!unseen.length) {
      return;
    }
    seenSeqRef.current = unseen[unseen.length - 1].seq;
    if (!enabled) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    // Nobody is looking: the throw would freeze with the frame loop.
    if (document.hidden) {
      return;
    }
    const now = performance.now();
    for (const entry of unseen) {
      if (entry.source === "physical") {
        continue;
      }
      // A blind roll reaches the table with its faces stripped
      // (src/lib/dm/viewer.ts): there is nothing to throw.
      if (!entry.roll.breakdown) {
        continue;
      }
      const notations = rollToDiceBoxNotation(entry.roll.breakdown);
      if (!notations) {
        continue;
      }
      queueRef.current.push({ at: now, notations });
    }
    queueRef.current = freshRolls(queueRef.current, now, undefined, DICE_QUEUE_MAX);
    void pump();
  }, [rolls, enabled, pump]);

  return (
    <div
      ref={overlayRef}
      id="dice-overlay"
      data-dice="idle"
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 [&_canvas]:!bg-transparent"
    />
  );
}
