// The painted picture under the play board.
//
// The terrain string stays the rules; this draws what the place looks like
// from it, with the renderer and the painted tile, object and decal sets under
// public/assets. It sits in the same layer an uploaded backdrop does
// (src/lib/battlemap/backdrop.ts) and obeys the same fog rule for free: the
// input is the viewer's own projection, where an unexplored tile is already a
// space, so there is nothing here a player has not seen.
//
// Browser only. Assets load through fetch, which the desktop and Android apps
// already route to the host with the session token, so the same code paints
// in a browser tab and in the apps' native screens.
import { ODMRender, type RenderAssets } from "@/lib/battlemap/render/renderer.js";
import { mapSkinKey, resolveSkin, type MapSkin, type Skin } from "@/lib/battlemap/skins";

export type TileEntry = {
  id: string;
  src: string;
  variants?: string[];
  category?: string;
  label?: string;
  genre?: string | null;
  themes?: string[];
};
export type ObjectEntry = { id: string; src: string; sets: string[]; kind: string; label?: string; span?: number };
type DecalEntry = { id: string; src: string };
type Manifests = { tiles: Map<string, TileEntry>; objects: ObjectEntry[]; decals: DecalEntry[]; categories: Map<string, string> };

// A placed stamp: a painted object at a square (MapProp.stamp, scene.ts).
export type PaintStamp = { x: number; y: number; id: string };

export type PaintQuality = "full" | "low";
export type PaintRequest = {
  width: number;
  height: number;
  // Row-major terrain characters, spaces where the viewer has not explored.
  terrain: string;
  theme: string;
  genre: string | null | undefined;
  // Anything stable per map; the same seed always dresses a room the same way.
  seedKey: string;
  quality: PaintQuality;
  // The map's own skin, laid over the default the setting and theme give.
  skin?: MapSkin | null;
  // The automatic dressing; off for a thumbnail, where it is only noise.
  dressing?: boolean;
  // Pixels per square, overriding the quality's own; a thumbnail asks for 8.
  cell?: number;
  // Stamps the DM placed, drawn at full size over the dressing.
  stamps?: PaintStamp[];
};

let manifests: Promise<Manifests | null> | null = null;
const pictures = new Map<string, Promise<ImageBitmap | null>>();

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path);
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

function loadManifests(): Promise<Manifests | null> {
  manifests ??= (async () => {
    const [tiles, props] = await Promise.all([
      readJson<{ tiles: TileEntry[] }>("/assets/tiles/manifest.json"),
      readJson<{ objects: ObjectEntry[]; decals: DecalEntry[] }>("/assets/props/manifest.json"),
    ]);
    if (!tiles || !props) {
      // A host older than the painted sets, or a payload without them: the
      // board keeps its drawn terrain. Forget the miss so a later board retries.
      manifests = null;
      return null;
    }
    return {
      tiles: new Map(tiles.tiles.map((t) => [t.id, t])),
      objects: props.objects,
      decals: props.decals,
      categories: new Map(tiles.tiles.map((t) => [t.id, t.category ?? ""])),
    };
  })();
  return manifests;
}

// The catalogue for the pickers (the tileset panel and the stamp picker), or
// null on a host without the painted sets. Same cached fetch the painter uses.
export async function loadCatalogue(): Promise<{ tiles: TileEntry[]; objects: ObjectEntry[] } | null> {
  const all = await loadManifests();
  return all ? { tiles: [...all.tiles.values()], objects: all.objects } : null;
}

function picture(src: string): Promise<ImageBitmap | null> {
  let pending = pictures.get(src);
  if (!pending) {
    pending = (async () => {
      try {
        const response = await fetch(src);
        return response.ok ? await createImageBitmap(await response.blob()) : null;
      } catch {
        return null;
      }
    })();
    pictures.set(src, pending);
  }
  return pending;
}

async function assetsFor(skin: Skin, all: Manifests, stamps: PaintStamp[] = []): Promise<RenderAssets> {
  const assets: RenderAssets = { tiles: {}, objects: {}, decals: {}, catalogue: { objects: all.objects, decals: all.decals } };
  const tileIds = new Set<string>(Object.values(skin.bind));
  if (skin.patch) tileIds.add(skin.patch.id);
  const jobs: Promise<void>[] = [];
  for (const id of tileIds) {
    const entry = all.tiles.get(id);
    if (!entry) continue;
    jobs.push(
      Promise.all((entry.variants ?? [entry.src]).map(picture)).then((loaded) => {
        const kept = loaded.filter((p): p is ImageBitmap => p !== null);
        if (kept.length) assets.tiles[id] = kept as unknown as HTMLImageElement[];
      }),
    );
  }
  const stamped = new Set(stamps.map((stamp) => stamp.id));
  for (const object of all.objects) {
    if (!stamped.has(object.id) && !object.sets.some((set) => skin.sets.includes(set))) continue;
    jobs.push(picture(object.src).then((p) => void (p && (assets.objects[object.id] = p as unknown as HTMLImageElement))));
  }
  for (const decal of all.decals) {
    jobs.push(picture(decal.src).then((p) => void (p && (assets.decals[decal.id] = p as unknown as HTMLImageElement))));
  }
  await Promise.all(jobs);
  return assets;
}

function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  }
  return (h >>> 0) % 100000;
}

// Pixels per square. The picture is stretched to the board by the SVG, so this
// only sets its sharpness: enough for a zoomed board on a desktop, less on a
// phone or under low effects, and never so large that a big map stalls a tab.
export function cellSizeFor(width: number, height: number, quality: PaintQuality): number {
  const budget = quality === "full" ? 3_200_000 : 1_200_000;
  return Math.max(16, Math.min(quality === "full" ? 48 : 32, Math.floor(Math.sqrt(budget / Math.max(1, width * height)))));
}

export function paintKey(request: PaintRequest): string {
  return [
    request.seedKey,
    request.width,
    request.height,
    request.theme,
    request.genre ?? "",
    request.quality,
    mapSkinKey(request.skin),
    request.dressing === false ? "bare" : "",
    request.cell ?? "",
    (request.stamps ?? []).map((stamp) => `${stamp.x},${stamp.y},${stamp.id}`).join(";"),
    request.terrain,
  ].join("|");
}

// Paints the board onto a fresh canvas, or null when the painted sets are not
// on this host. The map editor draws this canvas under its own overlays and
// the play board shows the canvas itself (usePaintedMap.ts): no encode, no
// object URL, the pixels the renderer wrote are the pixels on screen.
export async function paintCanvas(request: PaintRequest): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined" || request.width < 1 || request.height < 1) return null;
  const all = await loadManifests();
  if (!all) return null;
  const skin = resolveSkin(request.genre, request.theme, request.skin, all.categories);
  const stamps = (request.stamps ?? []).filter((stamp) => all.objects.some((object) => object.id === stamp.id));
  const assets = await assetsFor(skin, all, stamps);
  if (!Object.keys(assets.tiles).length) return null;
  const rows: string[] = [];
  for (let y = 0; y < request.height; y++) {
    rows.push(request.terrain.slice(y * request.width, (y + 1) * request.width).padEnd(request.width, " "));
  }
  const canvas = document.createElement("canvas");
  ODMRender.render(
    {
      rows,
      skin,
      seed: seedOf(request.seedKey),
      cell: request.cell ?? cellSizeFor(request.width, request.height, request.quality),
      assets,
      // The board draws its own grid, light, darkness and fog over this.
      options: {
        grid: false,
        dressing: request.dressing !== false,
        decals: true,
        quality: request.quality,
        ambient: "bright",
        props: stamps,
      },
    },
    canvas,
  );
  return canvas;
}

// Lets a painted canvas go: a zero-size canvas has no backing store, so the
// memory returns without waiting for the element to be collected.
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

// Thumbnails (docs/visual-overhaul-plan.md 3.7): the same renderer at 8 px a
// square with the dressing off, kept as a data URL per paint key. In memory
// only and bounded, oldest out first; a saved PNG is not worth a column when
// the renderer takes a few milliseconds at this size.
export const THUMB_CELL = 8;
const THUMB_LIMIT = 120;
const thumbs = new Map<string, Promise<string | null>>();

export type ThumbRequest = Omit<PaintRequest, "quality" | "cell" | "dressing">;

// `cell` is 8 for a strip of small tiles; a gallery card asks for more so the
// picture is not soft at the size it is shown.
export function thumbRequest(request: ThumbRequest, cell: number = THUMB_CELL): PaintRequest {
  return { ...request, quality: "low", cell: Math.max(4, Math.min(24, Math.round(cell))), dressing: false };
}

export function paintThumb(request: ThumbRequest, cell: number = THUMB_CELL): Promise<string | null> {
  const full = thumbRequest(request, cell);
  const key = paintKey(full);
  const cached = thumbs.get(key);
  if (cached) {
    // Touched: move to the young end.
    thumbs.delete(key);
    thumbs.set(key, cached);
    return cached;
  }
  const pending = paintCanvas(full)
    .then((canvas) => (canvas ? canvas.toDataURL("image/webp", 0.85) : null))
    .catch(() => null);
  thumbs.set(key, pending);
  // A miss (no painted sets yet) is forgotten so a later gallery retries.
  void pending.then((url) => {
    if (!url) thumbs.delete(key);
  });
  while (thumbs.size > THUMB_LIMIT) {
    const oldest = thumbs.keys().next().value;
    if (oldest === undefined) break;
    thumbs.delete(oldest);
  }
  return pending;
}
