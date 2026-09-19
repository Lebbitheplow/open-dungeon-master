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
import { skinFor, type Skin } from "@/lib/battlemap/skins";

type TileEntry = { id: string; src: string; variants?: string[] };
type ObjectEntry = { id: string; src: string; sets: string[]; kind: string };
type DecalEntry = { id: string; src: string };
type Manifests = { tiles: Map<string, TileEntry>; objects: ObjectEntry[]; decals: DecalEntry[] };

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
    return { tiles: new Map(tiles.tiles.map((t) => [t.id, t])), objects: props.objects, decals: props.decals };
  })();
  return manifests;
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

async function assetsFor(skin: Skin, all: Manifests): Promise<RenderAssets> {
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
  for (const object of all.objects) {
    if (!object.sets.some((set) => skin.sets.includes(set))) continue;
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
  return [request.seedKey, request.width, request.height, request.theme, request.genre ?? "", request.quality, request.terrain].join("|");
}

// Paints the board and returns an object URL for it, or null when the painted
// sets are not on this host. The caller owns the URL and revokes it.
export async function paintMap(request: PaintRequest): Promise<string | null> {
  if (typeof document === "undefined" || request.width < 1 || request.height < 1) return null;
  const all = await loadManifests();
  if (!all) return null;
  const skin = skinFor(request.genre, request.theme);
  const assets = await assetsFor(skin, all);
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
      cell: cellSizeFor(request.width, request.height, request.quality),
      assets,
      // The board draws its own grid, light, darkness and fog over this.
      options: { grid: false, dressing: true, decals: true, quality: request.quality, ambient: "bright" },
    },
    canvas,
  );
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  return blob ? URL.createObjectURL(blob) : null;
}
