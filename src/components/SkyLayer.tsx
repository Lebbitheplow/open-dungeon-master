"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { ParticleCanvas } from "@/components/ParticleCanvas";
import { useLowEffects } from "@/lib/effects-mode";
import type { SceneState } from "@/lib/scene/state";

// The sky over the table (docs/vtt-parity-implementation-plan.md section
// 2.3): a gradient wash keyed to the hour, weather on the particle canvas,
// and a vignette that tightens at night. Sits under the board and over the
// scene art; everything it draws is a fact the server sent in `scene_state`.
// Transitions ease over --dur-scene with --ease-drift; low effects drops the
// particles to a fifth and the depth to one layer.

const WASH: Record<SceneState["dayPart"], string> = {
  night: "linear-gradient(180deg, rgba(10, 8, 30, 0.55) 0%, rgba(6, 5, 20, 0.35) 100%)",
  dawn: "linear-gradient(180deg, rgba(40, 28, 60, 0.35) 0%, rgba(212, 140, 110, 0.22) 100%)",
  morning: "linear-gradient(180deg, rgba(255, 244, 214, 0.08) 0%, rgba(255, 236, 190, 0.05) 100%)",
  day: "linear-gradient(180deg, rgba(255, 250, 235, 0.06) 0%, rgba(255, 250, 235, 0.02) 100%)",
  dusk: "linear-gradient(180deg, rgba(60, 24, 40, 0.3) 0%, rgba(224, 112, 58, 0.22) 100%)",
  evening: "linear-gradient(180deg, rgba(20, 14, 48, 0.42) 0%, rgba(12, 9, 32, 0.3) 100%)",
};

const OVERCAST = "linear-gradient(180deg, rgba(60, 62, 70, 0.28) 0%, rgba(40, 42, 50, 0.22) 100%)";

export function SkyLayer({
  scene,
  mode,
  className,
  visible = true,
}: {
  scene: SceneState | null;
  // Under the board (full strength) or over a picture (half density, a tint).
  mode: "board" | "art";
  className?: string;
  // Off screen (a side panel behind another tab): the weather rests.
  visible?: boolean;
}) {
  const low = useLowEffects();
  const weather = scene?.weather ?? null;
  const dayPart = scene?.dayPart ?? "day";
  const sky = weather?.sky ?? "clear";
  const wash = useMemo(() => {
    const base = WASH[dayPart];
    if (sky === "overcast" || sky === "storm" || sky === "fog") {
      return `${OVERCAST}, ${base}`;
    }
    return base;
  }, [dayPart, sky]);
  const density = useMemo(() => {
    const scale = mode === "art" ? 0.5 : 1;
    if (sky === "rain" || sky === "snow" || sky === "storm") {
      return Math.min(1, (0.25 + (weather?.precipitation ?? 1) * 0.25)) * scale;
    }
    if (sky === "fog") {
      return 0.05 * scale;
    }
    return 0.12 * scale;
  }, [sky, weather?.precipitation, mode]);
  const windX = weather?.wind === "gale" ? 0.35 : weather?.wind === "breeze" ? 0.12 : 0.03;
  const embers = scene?.climate === "blighted" && (dayPart === "night" || dayPart === "evening");
  const motes =
    !embers &&
    sky === "clear" &&
    (dayPart === "morning" || dayPart === "day") &&
    (scene?.climate === "temperate" || scene?.climate === "tropical");
  const particleSky = sky === "wind" || sky === "overcast" ? "clear" : sky;
  const stormFlash = sky === "storm" && !low;

  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      <div className="sky-wash absolute inset-0" style={{ background: wash }} />
      <ParticleCanvas
        weather={scene ? particleSky : null}
        windX={windX}
        density={density}
        embers={embers}
        motes={motes}
        visible={visible}
      />
      {stormFlash ? <div className="storm-flash absolute inset-0 bg-white" /> : null}
      {/* The vignette tightens at night. */}
      <div
        className="sky-wash absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,var(--vig)) 100%)",
          ["--vig" as string]: dayPart === "night" ? 0.5 : dayPart === "evening" || dayPart === "dusk" ? 0.4 : 0.32,
        }}
      />
    </div>
  );
}
