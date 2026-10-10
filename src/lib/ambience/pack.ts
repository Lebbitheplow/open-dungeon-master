import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import {
  libraryRoot,
  parseTrackFile,
  readLock,
  rebuildManifest,
  writeLock,
  type AmbienceLock,
  type TrackCredit,
} from "@/lib/ambience/library";

// The sound pack: one zip holding tracks for public/ambience and the credit
// for each, so a server that cannot run scripts (the desktop and Android
// apps bundle one) still gets a library with one tap in the admin panel.
//
// What goes in is decided by licence (packable() below): public-domain and
// attribution-licensed recordings travel with their credits; files the
// operator merely declared stay behind, and generated takes go only when
// asked for.

export const PACK_FILE = "ambience-pack.zip";
const CREDITS_FILE = "credits.json";
// A pack is a few dozen minute-long mp3s; anything past this is not one.
export const PACK_MAX_BYTES = 400 * 1024 * 1024;
const TRACK_MAX_BYTES = 40 * 1024 * 1024;

export type PackEntry = { file: string; data: Buffer; credit: TrackCredit };

export function packAssetUrl(version: string): string {
  return `https://github.com/Lebbitheplow/open-dungeon-master/releases/download/v${version}/${PACK_FILE}`;
}

export async function buildPack(entries: PackEntry[]): Promise<Buffer> {
  const zip = new JSZip();
  const credits: AmbienceLock = {};
  for (const entry of entries) {
    if (!parseTrackFile(entry.file)) {
      throw new Error(`"${entry.file}" is not a track file name.`);
    }
    zip.file(entry.file, entry.data);
    credits[entry.file] = { ...entry.credit, origin: "pack" };
  }
  zip.file(CREDITS_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), credits }, null, 2));
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

// Opens a pack and checks every name before anything is written: a zip is
// untrusted input even when it came from a release, and a path in it must
// never reach past the library folder.
export async function readPack(buffer: Buffer): Promise<PackEntry[]> {
  if (buffer.length > PACK_MAX_BYTES) {
    throw new Error("That file is too large to be a sound pack.");
  }
  const zip = await JSZip.loadAsync(buffer);
  const creditsFile = zip.file(CREDITS_FILE);
  let credits: Record<string, TrackCredit> = {};
  if (creditsFile) {
    try {
      const parsed = JSON.parse(await creditsFile.async("string")) as { credits?: Record<string, TrackCredit> };
      credits = parsed?.credits && typeof parsed.credits === "object" ? parsed.credits : {};
    } catch {
      credits = {};
    }
  }
  const entries: PackEntry[] = [];
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir || name === CREDITS_FILE) {
      continue;
    }
    if (!parseTrackFile(name)) {
      // A stray folder, a readme, a file for a cue this catalog does not
      // know: skipped, not fatal, so a pack from a newer release still
      // installs what this server can use.
      continue;
    }
    const data = await file.async("nodebuffer");
    if (!data.length || data.length > TRACK_MAX_BYTES) {
      continue;
    }
    const credit = credits[name] ?? {};
    entries.push({
      file: name,
      data,
      credit: {
        title: typeof credit.title === "string" ? credit.title : name,
        author: typeof credit.author === "string" ? credit.author : "Sound pack",
        source: typeof credit.source === "string" ? credit.source : "",
        license: typeof credit.license === "string" ? credit.license : "Sound pack",
        origin: "pack",
      },
    });
  }
  if (!entries.length) {
    throw new Error("That pack holds no tracks this catalog knows.");
  }
  return entries;
}

// Writes the pack's tracks into the library, credits them in the lock and
// rebuilds the manifest. A file already there is kept unless `replace`:
// an operator's own take of a cue outranks the pack's.
export async function installPack(buffer: Buffer, { replace = false } = {}): Promise<{ installed: number; kept: number; playable: number }> {
  const entries = await readPack(buffer);
  const root = libraryRoot();
  const lock = readLock();
  let installed = 0;
  let kept = 0;
  for (const entry of entries) {
    const target = path.join(root, entry.file);
    if (existsSync(target) && !replace) {
      kept += 1;
      continue;
    }
    writeFileSync(target, entry.data);
    lock[entry.file] = entry.credit;
    installed += 1;
  }
  writeLock(lock);
  return { installed, kept, playable: rebuildManifest() };
}

// Whether a credit may travel in the pack: public domain and the attribution
// licences (CC BY, CC BY-SA, OGA-BY), with the credit riding along, and
// nothing the operator merely declared. Generated takes only when asked:
// the library is meant to be recordings people made.
export function packable(credit: TrackCredit | undefined, { includeGenerated = false } = {}): boolean {
  if (!credit) {
    return false;
  }
  if (credit.origin === "generated") {
    return includeGenerated;
  }
  if (credit.origin === "local") {
    return false;
  }
  const license = String(credit.license ?? "").toLowerCase();
  return license.startsWith("public domain") || license.startsWith("cc by") || license.startsWith("oga-by");
}

// The tracks on disk the pack builder may take: see packable(); everything
// with `all`.
export function packableEntries({ all = false, includeGenerated = false } = {}): PackEntry[] {
  const root = libraryRoot();
  const lock = readLock();
  const entries: PackEntry[] = [];
  if (!existsSync(root)) {
    return entries;
  }
  for (const name of readdirSync(root).sort()) {
    if (!parseTrackFile(name)) {
      continue;
    }
    const credit = lock[name];
    if (!all && !packable(credit, { includeGenerated })) {
      continue;
    }
    entries.push({
      file: name,
      data: readFileSync(path.join(root, name)),
      credit: credit ?? { title: name, author: "Supplied locally", source: "", license: "Declared by the operator", origin: "local" },
    });
  }
  return entries;
}
