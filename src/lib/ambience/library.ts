import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import shippedSources from "./sources.json";
import { cueById, cuesForLayer, type AmbienceLayer } from "@/lib/ambience/catalog";

// What is actually on disk. The catalog says what cues EXIST; this says
// which of them this install can play, and who to credit for each file.
//
// public/ambience ships with the project: the open-licensed library
// scripts/fetch-ambience.mjs resolved, pinned with its credits in
// src/lib/ambience/sources.json. An operator can add to it with the same
// script, with the sound pack from the admin panel, or by dropping files
// in by hand. A cue may have several files: "battle.mp3", "battle-2.mp3"
// and "battle-3.ogg" are three takes of the same cue, and the player moves
// between them so a long fight is not one loop forever.
//
// Every consumer asks here first rather than assuming a file is there, so
// a cue without one is silence, not an error.

export const AUDIO_EXTENSIONS = [".mp3", ".ogg", ".opus", ".m4a", ".wav"];

export type TrackCredit = {
  title?: string;
  author?: string;
  source?: string;
  license?: string;
  // Where the file came from, for the pack builder: a download the fetch
  // script resolved, a take generated here, or a file supplied by hand.
  origin?: "fetched" | "generated" | "local" | "pack";
  url?: string;
};

export type InstalledTrack = {
  cueId: string;
  file: string;
  url: string;
  // 1 for "cue.ext", n for "cue-n.ext".
  variant: number;
  title: string;
  author: string;
  source: string;
  license: string;
};

// The lock: every file's credit, keyed by file name. Lives under data/ so it
// survives the folder being emptied and refilled, and is what the manifest
// is rebuilt from.
export type AmbienceLock = Record<string, TrackCredit>;

export function libraryRoot(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "ambience");
}

export function lockPath(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "ambience-lock.json");
}

function manifestPath(): string {
  return path.join(/*turbopackIgnore: true*/ libraryRoot(), "manifest.json");
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

// "battle.mp3" and "battle-2.mp3" both belong to the battle cue; anything
// else in the folder (the manifest, a stray download) belongs to nothing.
export function parseTrackFile(name: string): { cueId: string; variant: number; extension: string } | null {
  const extension = path.extname(name).toLowerCase();
  if (!AUDIO_EXTENSIONS.includes(extension) || path.basename(name) !== name) {
    return null;
  }
  const match = /^([a-z][a-z_]*?)(?:-(\d+))?$/.exec(path.basename(name, extension));
  if (!match || !cueById(match[1])) {
    return null;
  }
  return { cueId: match[1], variant: match[2] ? Number(match[2]) : 1, extension };
}

// The next free file name for a cue: "tavern.mp3" when the cue has nothing,
// else the lowest "tavern-n.mp3" not taken, whatever the extensions.
export function nextTrackFile(cueId: string, extension: string, existing: string[]): string {
  const taken = new Set(
    existing.map((name) => parseTrackFile(name)).filter((entry) => entry?.cueId === cueId).map((entry) => entry!.variant),
  );
  if (!taken.has(1)) {
    return `${cueId}${extension}`;
  }
  let variant = 2;
  while (taken.has(variant)) {
    variant += 1;
  }
  return `${cueId}-${variant}${extension}`;
}

// ---- the lock ----

// The shipped pins: the library the project resolved and committed
// (src/lib/ambience/sources.json), which is also every shipped file's credit.
// A fresh clone has the files and no lock, and must still name the authors.
function shippedCredits(): AmbienceLock {
  try {
    // Imported, not read from the tree: the client apps prune src/ from the
    // bundled server, so a file read here would credit nobody in the apps.
    const credits: AmbienceLock = {};
    for (const [file, value] of Object.entries(shippedSources as Record<string, TrackCredit>)) {
      if (parseTrackFile(file) && value && typeof value === "object") {
        credits[file] = { ...value, origin: "fetched" };
      }
    }
    return credits;
  } catch {
    return {};
  }
}

export function readLock(): AmbienceLock {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(lockPath(), "utf8"));
  } catch {
    return shippedCredits();
  }
  if (!parsed || typeof parsed !== "object") {
    return shippedCredits();
  }
  const lock: AmbienceLock = shippedCredits();
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const entry = value as TrackCredit & { file?: unknown };
    // The first lock was keyed by cue id with the file inside the entry;
    // one file per cue, so that key and this one name the same thing.
    const file = parseTrackFile(key) ? key : text(entry.file);
    if (!file || !parseTrackFile(file)) {
      continue;
    }
    lock[file] = {
      title: text(entry.title),
      author: text(entry.author),
      source: text(entry.source),
      license: text(entry.license),
      origin: entry.origin ?? "fetched",
      ...(text(entry.url) ? { url: text(entry.url) } : {}),
    };
  }
  return lock;
}

export function writeLock(lock: AmbienceLock) {
  mkdirSync(path.dirname(lockPath()), { recursive: true });
  writeFileSync(lockPath(), `${JSON.stringify(lock, null, 2)}\n`);
}

// ---- the manifest ----

type ManifestEntry = { file?: unknown; title?: unknown; author?: unknown; source?: unknown; license?: unknown };

// Rebuilt from what is actually on disk, every time. The lock supplies the
// credits; a file with no lock entry is one somebody added by hand, and is
// kept and credited as such rather than treated as an error. Returns how
// many cues are playable.
export function rebuildManifest(): number {
  const root = libraryRoot();
  mkdirSync(root, { recursive: true });
  const lock = readLock();
  const tracks: Record<string, ManifestEntry[]> = {};
  for (const name of readdirSync(root).sort()) {
    const parsed = parseTrackFile(name);
    if (!parsed) {
      continue;
    }
    const credit = lock[name];
    (tracks[parsed.cueId] ??= []).push(
      credit
        ? { file: name, title: credit.title, author: credit.author, source: credit.source, license: credit.license }
        : { file: name, title: parsed.cueId, author: "Supplied locally", source: "", license: "Declared by the operator" },
    );
  }
  for (const list of Object.values(tracks)) {
    list.sort((a, b) => (parseTrackFile(String(a.file))?.variant ?? 0) - (parseTrackFile(String(b.file))?.variant ?? 0));
  }
  writeFileSync(manifestPath(), `${JSON.stringify({ generatedAt: new Date().toISOString(), tracks }, null, 2)}\n`);
  cache = null;
  return Object.keys(tracks).length;
}

// Reads a manifest's tracks, in either shape: the first manifest held one
// entry per cue, this one holds a list. Pure, so the tests can feed it a
// manifest and a pretend disk.
export function parseManifest(parsed: unknown, exists: (file: string) => boolean): InstalledTrack[] {
  const tracks: InstalledTrack[] = [];
  const record = parsed && typeof parsed === "object" ? (parsed as { tracks?: Record<string, unknown> }).tracks ?? {} : {};
  for (const [cueId, value] of Object.entries(record)) {
    const entries = (Array.isArray(value) ? value : [value]) as ManifestEntry[];
    for (const entry of entries) {
      const file = text(entry?.file);
      const info = file ? parseTrackFile(file) : null;
      // A cue the catalog has since dropped, a file named for another cue,
      // or a line pointing at a file that is not there is skipped: the
      // client must never be handed a URL that 404s on every scene change.
      if (!info || info.cueId !== cueId || !exists(file)) {
        continue;
      }
      tracks.push({
        cueId,
        file,
        url: `/ambience/${encodeURIComponent(file)}`,
        variant: info.variant,
        title: text(entry?.title, cueId),
        author: text(entry?.author, "Unknown"),
        source: text(entry?.source),
        license: text(entry?.license, "Public domain"),
      });
    }
  }
  tracks.sort((a, b) => a.cueId.localeCompare(b.cueId) || a.variant - b.variant);
  return tracks;
}

// Re-read only when the manifest's mtime moves. A fetch run while the server
// is up therefore shows up without a restart, and the common case (every
// client asking once on load) costs one stat.
let cache: { mtimeMs: number; tracks: InstalledTrack[] } | null = null;

export function installedTracks(): InstalledTrack[] {
  const manifest = manifestPath();
  if (!existsSync(manifest)) {
    cache = null;
    return [];
  }
  const { mtimeMs } = statSync(manifest);
  if (cache && cache.mtimeMs === mtimeMs) {
    return cache.tracks;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifest, "utf8"));
  } catch {
    // A half-written manifest (a fetch is mid-run) reads as an empty
    // library rather than taking the endpoint down.
    cache = { mtimeMs, tracks: [] };
    return [];
  }
  const root = libraryRoot();
  const tracks = parseManifest(parsed, (file) => existsSync(path.join(/*turbopackIgnore: true*/ root, file)));
  cache = { mtimeMs, tracks };
  return tracks;
}

export type LayerCount = { installed: number; total: number; files: number };

// How much of each layer this install can play: what the settings hint, the
// admin card and the sound panel say instead of "silence".
export function installedCounts(tracks = installedTracks()): Record<AmbienceLayer, LayerCount> {
  const counts = {} as Record<AmbienceLayer, LayerCount>;
  for (const layer of ["bed", "music", "sting"] as const) {
    const cues = cuesForLayer(layer);
    const mine = tracks.filter((track) => cueById(track.cueId)?.layer === layer);
    counts[layer] = {
      installed: new Set(mine.map((track) => track.cueId)).size,
      total: cues.length,
      files: mine.length,
    };
  }
  return counts;
}
