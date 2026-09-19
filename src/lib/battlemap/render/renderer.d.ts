// Types for the canvas renderer (renderer.js stays JavaScript: it is inlined
// verbatim into the NAS preview page).
import type { Skin } from "@/lib/battlemap/skins";

export type RenderAssets = {
  tiles: Record<string, HTMLImageElement[]>;
  objects: Record<string, HTMLImageElement>;
  decals: Record<string, HTMLImageElement>;
  catalogue: { objects: unknown[]; decals: unknown[] };
};

export type RenderOptions = {
  grid?: boolean;
  dressing?: boolean;
  decals?: boolean;
  quality?: "full" | "low";
  ambient?: "bright" | "dim" | "dark";
  lights?: Array<{ x: number; y: number; brightRadius: number; dimRadius: number }>;
  zones?: Array<{ x0: number; y0: number; x1: number; y1: number; ambient: string; kind?: string }>;
  props?: Array<{ x: number; y: number; id: string; rot?: number }>;
  unexplored?: Set<string>;
  unseen?: Set<string>;
};

export type RenderSpec = {
  rows: string[];
  skin: Skin;
  seed: number;
  cell?: number;
  assets: RenderAssets;
  options?: RenderOptions;
};

export const ODMRender: {
  render(spec: RenderSpec, canvas: HTMLCanvasElement): void;
  dressingPool(skin: Skin, objects: unknown[]): unknown[];
};
