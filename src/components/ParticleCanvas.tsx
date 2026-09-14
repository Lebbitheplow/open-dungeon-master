"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { prefersReducedMotion, useLowEffects } from "@/lib/effects-mode";
import {
  burst,
  createField,
  draw,
  LOW_SPRITES,
  MAX_SPRITES,
  mulberry,
  spawnWeather,
  step,
  type ParticleField,
  type WeatherSky,
} from "@/lib/particles";

// The single particle overlay a surface owns: one canvas, one animation
// frame loop, shared by bursts (an effect at a tile) and weather (a sky
// that keeps falling). Callers get a handle through `onReady` and ask it to
// burst; weather is a prop so the loop tops it up itself. Stops entirely
// while the tab is hidden and on reduced motion, and never runs when there
// is nothing to draw, so an idle board costs no frames.

export type ParticleHandle = {
  burst: (
    x: number,
    y: number,
    color: string,
    kind: "spark" | "shard" | "mist" | "ring" | "drip" | "bloom",
    count: number,
  ) => void;
};

export function ParticleCanvas({
  className,
  weather = null,
  windX = 0,
  density = 0,
  embers = false,
  motes = false,
  onReady,
}: {
  className?: string;
  // The sky to keep falling, or null for none.
  weather?: WeatherSky | null;
  // Horizontal drift from the wind, in sprite units per millisecond.
  windX?: number;
  // 0..1 of the cap the weather may use.
  density?: number;
  embers?: boolean;
  motes?: boolean;
  onReady?: (handle: ParticleHandle | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fieldRef = useRef<ParticleField | null>(null);
  const frameRef = useRef(0);
  const lastRef = useRef(0);
  const low = useLowEffects();
  const weatherRef = useRef({ weather, windX, density, embers, motes, low });
  useEffect(() => {
    weatherRef.current = { weather, windX, density, embers, motes, low };
  }, [weather, windX, density, embers, motes, low]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const cap = low ? LOW_SPRITES : MAX_SPRITES;
    const field = createField(canvas.clientWidth || 1, canvas.clientHeight || 1, cap);
    fieldRef.current = field;
    const rng = mulberry(Date.now() & 0xffff);
    const context = canvas.getContext("2d");

    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      field.width = width;
      field.height = height;
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);

    let running = false;
    const tick = (now: number) => {
      frameRef.current = 0;
      if (!context || document.hidden || prefersReducedMotion()) {
        running = false;
        context?.clearRect(0, 0, field.width, field.height);
        return;
      }
      const dt = Math.min(48, lastRef.current ? now - lastRef.current : 16);
      lastRef.current = now;
      const current = weatherRef.current;
      const skyActive =
        current.weather !== null &&
        (current.weather !== "clear" || current.embers || current.motes);
      if (skyActive && current.weather) {
        const target = Math.round(
          (current.low ? LOW_SPRITES : MAX_SPRITES) * Math.max(0, Math.min(1, current.density)),
        );
        spawnWeather(field, current.weather, target, current.windX, rng, {
          lowEffects: current.low,
          embers: current.embers,
          motes: current.motes,
        });
      } else {
        // Weather turned off: let the long-lived sprites go.
        field.sprites = field.sprites.filter((sprite) => sprite.total <= 2000);
      }
      step(field, dt);
      draw(context, field);
      if (field.sprites.length > 0 || skyActive) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        running = false;
      }
    };
    const wake = () => {
      if (running) {
        return;
      }
      running = true;
      lastRef.current = 0;
      frameRef.current = requestAnimationFrame(tick);
    };

    const handle: ParticleHandle = {
      burst: (x, y, color, kind, count) => {
        if (prefersReducedMotion()) {
          return;
        }
        burst(field, x, y, color, kind, weatherRef.current.low ? Math.ceil(count / 3) : count, rng);
        wake();
      },
    };
    onReady?.(handle);
    wake();
    const onVisibility = () => {
      if (!document.hidden) {
        wake();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    // Weather prop changes must wake the loop when it went idle.
    const interval = window.setInterval(() => {
      const current = weatherRef.current;
      if (current.weather && (current.weather !== "clear" || current.embers || current.motes)) {
        wake();
      }
    }, 1000);
    return () => {
      onReady?.(null);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
      observer?.disconnect();
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      fieldRef.current = null;
    };
  }, [low, onReady]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
    />
  );
}
