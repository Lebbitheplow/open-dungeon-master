import type { AtlasMap, Folder, Pin, Region, XY } from "./model.ts";

// Folders and nested maps, after WorldForge's categories and maps modules
// (by Smoebo). Both are trees stored as flat lists with parent pointers, and
// both have to survive a parent loop that a hand-edited export can carry:
// every walk keeps a visited set, and anything a walk cannot reach from a
// root is shown as a root rather than lost. Pure.

// ---- folders ----

export function folderChildren(folders: Folder[]): Map<string, Folder[]> {
  const ids = new Set(folders.map((folder) => folder.id));
  const kids = new Map<string, Folder[]>();
  for (const folder of folders) {
    const parent = folder.parentId && ids.has(folder.parentId) && folder.parentId !== folder.id ? folder.parentId : "";
    kids.set(parent, [...(kids.get(parent) ?? []), folder]);
  }
  for (const group of kids.values()) group.sort((a, b) => a.name.localeCompare(b.name));
  return kids;
}

// Depth-first, for an indented list; every folder exactly once.
export function folderTree(folders: Folder[]): Array<{ folder: Folder; depth: number }> {
  const kids = folderChildren(folders);
  const out: Array<{ folder: Folder; depth: number }> = [];
  const seen = new Set<string>();
  const walk = (parent: string, depth: number) => {
    for (const folder of kids.get(parent) ?? []) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      out.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk("", 0);
  for (const folder of [...folders].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!seen.has(folder.id)) {
      seen.add(folder.id);
      out.push({ folder, depth: 0 });
      walk(folder.id, 1);
    }
  }
  return out;
}

// A folder and everything under it, for a filter that means "in here".
export function folderAndBelow(folders: Folder[], id: string): Set<string> {
  const kids = folderChildren(folders);
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    if (out.has(current)) continue;
    out.add(current);
    for (const child of kids.get(current) ?? []) stack.push(child.id);
  }
  return out;
}

export function folderPath(folders: Folder[], id: string): Folder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: Folder[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

// A folder may not move under itself or anything inside it.
export function canMoveFolder(folders: Folder[], id: string, parentId: string): boolean {
  return !parentId || !folderAndBelow(folders, id).has(parentId);
}

// Deleting a folder never deletes what was in it: its folders and entries
// move up to its parent.
export function removeFolder(folders: Folder[], id: string): { folders: Folder[]; heir: string } {
  const dead = folders.find((folder) => folder.id === id);
  const heir = dead?.parentId ?? "";
  return {
    heir,
    folders: folders.filter((folder) => folder.id !== id).map((folder) => (folder.parentId === id ? { ...folder, parentId: heir } : folder)),
  };
}

// ---- nested maps ----
//
// A map nests under a pin: map.parentPinId is its one place in the tree,
// pin.linkedMapId is the jump behind "Open map". Making a sub-map sets both;
// linking an existing map from a second pin sets only the jump (a portal),
// so a map can be reached from many pins and still has one breadcrumb.

export function mapParentOf(maps: AtlasMap[], pins: Pin[], atlas: AtlasMap): string | null {
  if (!atlas.parentPinId) return null;
  const pin = pins.find((entry) => entry.id === atlas.parentPinId);
  return pin && pin.mapId !== atlas.id && maps.some((entry) => entry.id === pin.mapId) ? pin.mapId : null;
}

export function mapBreadcrumbs(maps: AtlasMap[], pins: Pin[], mapId: string): AtlasMap[] {
  const byId = new Map(maps.map((atlas) => [atlas.id, atlas]));
  const trail: AtlasMap[] = [];
  const seen = new Set<string>();
  let current = byId.get(mapId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    trail.unshift(current);
    const parent = mapParentOf(maps, pins, current);
    current = parent ? byId.get(parent) : undefined;
  }
  return trail;
}

// Would hanging `targetId` under `pin` make a loop?
export function mapWouldLoop(maps: AtlasMap[], pins: Pin[], pin: Pin, targetId: string): boolean {
  return mapBreadcrumbs(maps, pins, pin.mapId).some((atlas) => atlas.id === targetId);
}

export function mapTree(maps: AtlasMap[], pins: Pin[]): Array<{ map: AtlasMap; depth: number }> {
  const kids = new Map<string, AtlasMap[]>();
  const roots: AtlasMap[] = [];
  for (const atlas of maps) {
    const parent = mapParentOf(maps, pins, atlas);
    if (parent) kids.set(parent, [...(kids.get(parent) ?? []), atlas]);
    else roots.push(atlas);
  }
  const out: Array<{ map: AtlasMap; depth: number }> = [];
  const seen = new Set<string>();
  const walk = (atlas: AtlasMap, depth: number) => {
    if (seen.has(atlas.id)) return;
    seen.add(atlas.id);
    out.push({ map: atlas, depth });
    for (const child of kids.get(atlas.id) ?? []) walk(child, depth + 1);
  };
  roots.forEach((root) => walk(root, 0));
  maps.forEach((atlas) => walk(atlas, 0));
  return out;
}

// ---- regions ----

export const REGION_COLORS = ["#c9a84c", "#7da868", "#8a9bb8", "#b87d5c", "#7d6ba8", "#5d9b8a", "#b8608a", "#8a8a5c"];

// The colour fewest regions on this map use yet.
export function nextRegionColor(regions: Region[]): string {
  const use = new Map(REGION_COLORS.map((shade) => [shade, 0]));
  regions.forEach((region) => use.has(region.color) && use.set(region.color, use.get(region.color)! + 1));
  return REGION_COLORS.reduce((best, shade) => (use.get(shade)! < use.get(best)! ? shade : best), REGION_COLORS[0]);
}

export function pointInPolygon(point: XY, points: XY[]): boolean {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Where a region's label sits: its area-weighted centre, or the mean of its
// corners when it has no area to speak of.
export function polygonCentroid(points: XY[]): XY {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const cross = points[j].x * points[i].y - points[i].x * points[j].y;
    area += cross;
    cx += (points[j].x + points[i].x) * cross;
    cy += (points[j].y + points[i].y) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
  }
  return { x: cx / (area * 3), y: cy / (area * 3) };
}

// The topmost region under a point: the last drawn wins.
export function regionAt(regions: Region[], point: XY): Region | null {
  for (let i = regions.length - 1; i >= 0; i -= 1) {
    if (pointInPolygon(point, regions[i].points)) return regions[i];
  }
  return null;
}
