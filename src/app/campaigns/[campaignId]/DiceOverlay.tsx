"use client";

import { useCallback, useEffect, useRef } from "react";
import { rollToDiceBoxNotation } from "@/lib/dice-notation";
import { diceLookKey, diceLookTheme } from "@/lib/dice/dice-look";
import {
  captureListeners,
  DICE_IDLE_MS,
  releaseListeners,
  type CapturedListener,
} from "@/lib/dice/dice-box-lifecycle";
import { hydrateDiceLook, useDiceLook } from "@/lib/dice/dice-look-store";
import type { StoredRoll } from "@/lib/db/rolls";

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
type Tray = { box: DiceBoxInstance; listeners: CapturedListener[] };

// Firefox caps live WebGL contexts (~32) and loses the oldest past that, so
// every orphaned context from an undisposed box brings the tab closer to a
// wedge; tear the renderer down whenever the overlay unmounts or the tray
// has sat idle (DICE_IDLE_MS), and take the resize listener with it so a
// later window resize never reaches a disposed renderer.
function disposeTray(tray: Tray | null) {
  if (!tray) {
    return;
  }
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
}

export function DiceOverlay({
  latestRoll,
  enabled,
}: {
  latestRoll: { roll: StoredRoll; source: string; seq: number } | null;
  enabled: boolean;
}) {
  const trayRef = useRef<Tray | null>(null);
  const idleTimerRef = useRef(0);
  const initFailedRef = useRef(false);
  const queueRef = useRef<string[][]>([]);
  const animatingRef = useRef(false);
  // Only rolls that arrive after mount animate; the snapshot backlog and
  // reconnect replays stay silent. The watermark starts at whatever the
  // stream already holds (0 on a table nothing has rolled at yet), so the
  // first roll of a fresh table, and the first after the dice are switched
  // back on, tumbles like every later one instead of passing for backlog.
  const seenSeqRef = useRef<number>(latestRoll?.seq ?? 0);
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

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      queueRef.current = [];
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = 0;
      disposeTray(trayRef.current);
      trayRef.current = null;
    };
  }, []);

  const pump = useCallback(async () => {
    if (animatingRef.current) {
      return;
    }
    const notations = queueRef.current.shift();
    if (!notations) {
      return;
    }
    animatingRef.current = true;
    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = 0;
    try {
      const box = await ensureBox();
      if (box) {
        const wanted = diceLookKey(lookRef.current);
        if (themedRef.current !== wanted) {
          themedRef.current = wanted;
          await box.updateConfig(diceLookTheme(lookRef.current));
        }
        for (const notation of notations) {
          await box.roll(notation);
          await new Promise((resolve) => setTimeout(resolve, 1_200));
        }
        box.clearDice();
      }
    } catch {
      // A wedged animation must never block the game.
    } finally {
      animatingRef.current = false;
      if (queueRef.current.length) {
        void pump();
      } else if (trayRef.current && !unmountedRef.current) {
        // Nothing left to show: let the context go after a quiet spell. The
        // next roll rebuilds the tray (theme load plus WebGL init), which is
        // the same path the very first roll takes.
        idleTimerRef.current = window.setTimeout(() => {
          idleTimerRef.current = 0;
          if (animatingRef.current || queueRef.current.length) {
            return;
          }
          disposeTray(trayRef.current);
          trayRef.current = null;
          themedRef.current = "";
        }, DICE_IDLE_MS);
      }
    }

    async function ensureBox(): Promise<DiceBoxInstance | null> {
      if (trayRef.current || initFailedRef.current) {
        return trayRef.current?.box ?? null;
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
        const tray: Tray = { box, listeners: captured };
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
        return box;
      } catch {
        initFailedRef.current = true;
        return null;
      }
    }
  }, []);

  useEffect(() => {
    if (!latestRoll) {
      return;
    }
    if (latestRoll.seq <= seenSeqRef.current) {
      return;
    }
    seenSeqRef.current = latestRoll.seq;
    if (!enabled || latestRoll.source === "physical") {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const notations = rollToDiceBoxNotation(latestRoll.roll.breakdown);
    if (!notations) {
      return;
    }
    if (queueRef.current.length >= 5) {
      queueRef.current.shift();
    }
    queueRef.current.push(notations);
    void pump();
  }, [latestRoll, enabled, pump]);

  return (
    <div
      id="dice-overlay"
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 [&_canvas]:!bg-transparent"
    />
  );
}
