import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { cueById } from "@/lib/ambience/catalog";

// What is actually on disk. The catalog says what cues EXIST; this says
// which of them this install can play, and who to credit for the file.
//
// public/ambience is written by scripts/fetch-ambience.mjs and is not in
// git: the audio is public-domain material fetched from the archives, not
// something the project redistributes. A table that has never run the script
// hears nothing, and nothing breaks, because every consumer asks here first
// rather than assuming a file is there.

export type InstalledTrack = {
  cueId: string;
  url: string;
  title: string;
  author: string;
  source: string;
  license: string;
};

type ManifestEntry = {
  file?: unknown;
  title?: unknown;
  author?: unknown;
  source?: unknown;
  license?: unknown;
};

const ROOT = path.join(process.cwd(), "public", "ambience");
const MANIFEST = path.join(ROOT, "manifest.json");

// Re-read only when the manifest's mtime moves. A fetch run while the server
// is up therefore shows up without a restart, and the common case (every
// client asking once on load) costs one stat.
let cache: { mtimeMs: number; tracks: InstalledTrack[] } | null = null;

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function read(): InstalledTrack[] {
  if (!existsSync(MANIFEST)) {
    cache = null;
    return [];
  }
  const { mtimeMs } = statSync(MANIFEST);
  if (cache && cache.mtimeMs === mtimeMs) {
    return cache.tracks;
  }
  let parsed: { tracks?: Record<string, ManifestEntry> };
  try {
    parsed = JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch {
    // A half-written manifest (the fetch script is mid-run) reads as an
    // empty library rather than taking the endpoint down.
    cache = { mtimeMs, tracks: [] };
    return [];
  }
  const tracks: InstalledTrack[] = [];
  for (const [cueId, entry] of Object.entries(parsed.tracks ?? {})) {
    const file = text(entry?.file);
    // A cue the catalog has since dropped, or a manifest line pointing at a
    // file that is not there, is skipped: the client must never be handed a
    // URL that 404s on every scene change.
    if (!file || !cueById(cueId) || path.basename(file) !== file) {
      continue;
    }
    if (!existsSync(path.join(ROOT, file))) {
      continue;
    }
    tracks.push({
      cueId,
      url: `/ambience/${encodeURIComponent(file)}`,
      title: text(entry?.title, cueId),
      author: text(entry?.author, "Unknown"),
      source: text(entry?.source),
      license: text(entry?.license, "Public domain"),
    });
  }
  tracks.sort((a, b) => a.cueId.localeCompare(b.cueId));
  cache = { mtimeMs, tracks };
  return tracks;
}

export function installedTracks(): InstalledTrack[] {
  return read();
}
