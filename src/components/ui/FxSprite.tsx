"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { FlipbookSheet } from "@/lib/battlemap/flipbooks";

// A painted effect sheet (public/fx) played in ordinary HTML: the campfire in
// the rest moment, the radiant burst behind a level-up. The board plays the
// same sheets inside its SVG (BoardFlipbook); this is the player for
// everywhere else. The sheet is an <img> slid behind a square window, so the
// client apps point it at the host the way they do any other picture.
//
// The frames are painted on black and laid over the page with a screen blend.
// Under reduced motion a loop rests on one frame and a one-shot does not play.

let sheets: Promise<Map<string, FlipbookSheet>> | null = null;

function loadSheets(): Promise<Map<string, FlipbookSheet>> {
  sheets ??= fetch("/fx/manifest.json")
    .then((response) => (response.ok ? response.json() : { sheets: [] }))
    .then((body: { sheets?: FlipbookSheet[] }) => new Map((body.sheets ?? []).map((sheet) => [sheet.id, sheet])))
    .catch(() => new Map());
  return sheets;
}

export function FxSprite({
  sheetId,
  loop = false,
  delay = 0,
  className,
  onDone,
}: {
  sheetId: string;
  loop?: boolean;
  delay?: number;
  // Sizes and places the square window; the sprite fills it.
  className?: string;
  onDone?: () => void;
}) {
  const [sheet, setSheet] = useState<FlipbookSheet | null>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    let alive = true;
    void loadSheets().then((all) => {
      if (alive) setSheet(all.get(sheetId) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [sheetId]);

  useEffect(() => {
    const element = image.current;
    if (!sheet || !element) return;
    const rows = Math.ceil(sheet.frames / sheet.columns);
    const show = (frame: number) => {
      const column = frame % sheet.columns;
      const row = Math.floor(frame / sheet.columns);
      element.style.transform = `translate(${(-column / sheet.columns) * 100}%, ${(-row / rows) * 100}%)`;
      element.style.opacity = "1";
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (loop) show(Math.floor(sheet.frames / 2));
      else done.current?.();
      return;
    }
    const started = performance.now();
    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - started - delay;
      if (elapsed >= 0) {
        const frame = Math.floor((elapsed / 1000) * sheet.fps);
        if (!loop && frame >= sheet.frames) {
          element.style.opacity = "0";
          done.current?.();
          return;
        }
        show(frame % sheet.frames);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sheet, loop, delay]);

  if (!sheet) {
    return <span className={cn("pointer-events-none block", className)} aria-hidden="true" />;
  }
  return (
    <span
      className={cn("pointer-events-none block overflow-hidden", className)}
      style={{ mixBlendMode: "screen" }}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={image}
        src={sheet.src}
        alt=""
        draggable={false}
        className="block max-w-none origin-top-left opacity-0"
        style={{ width: `${sheet.columns * 100}%` }}
      />
    </span>
  );
}
