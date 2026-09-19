"use client";

import { useEffect, useState } from "react";
import { TILE } from "@/app/campaigns/[campaignId]/battleMapCells";
import { flipbookFrame, type FlipbookSheet } from "@/lib/battlemap/flipbooks";
import type { XY } from "@/lib/battlemap/types";

// The sheets this host has, read once. A host without them (older than the
// painted effects) resolves to an empty map and every effect stays drawn.
let sheets: Promise<Map<string, FlipbookSheet>> | null = null;

function loadSheets(): Promise<Map<string, FlipbookSheet>> {
  sheets ??= fetch("/fx/manifest.json")
    .then((response) => (response.ok ? response.json() : { sheets: [] }))
    .then((body: { sheets?: FlipbookSheet[] }) => new Map((body.sheets ?? []).map((sheet) => [sheet.id, sheet])))
    .catch(() => new Map());
  return sheets;
}

// One painted effect played once over a point on the board, inside the
// board's <svg>. The sheet is painted on black, so it is screened over the
// map: black adds nothing and the glow adds light. The nested <svg> is the
// crop: its viewBox walks the sheet one frame at a time.
export function Flipbook({ sheetId, at, tiles = 2.4 }: { sheetId: string; at: XY; tiles?: number }) {
  const [sheet, setSheet] = useState<FlipbookSheet | null>(null);
  const [frame, setFrame] = useState(0);

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
    if (!sheet) return;
    const started = performance.now();
    let raf = 0;
    const tick = () => {
      const next = flipbookFrame(sheet, performance.now() - started);
      setFrame(next);
      if (next >= 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sheet]);

  if (!sheet || frame < 0) {
    return null;
  }
  const size = TILE * tiles;
  const rows = Math.ceil(sheet.frames / sheet.columns);
  const column = frame % sheet.columns;
  const row = Math.floor(frame / sheet.columns);
  return (
    <svg
      x={at.x - size / 2}
      y={at.y - size / 2}
      width={size}
      height={size}
      viewBox={`${column * sheet.frame} ${row * sheet.frame} ${sheet.frame} ${sheet.frame}`}
      style={{ mixBlendMode: "screen" }}
      pointerEvents="none"
    >
      <image href={sheet.src} width={sheet.columns * sheet.frame} height={rows * sheet.frame} />
    </svg>
  );
}
