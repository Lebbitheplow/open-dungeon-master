// Fills the sound library: downloads audio for the cues in
// src/lib/ambience/catalog.ts into public/ambience, and rebuilds the
// manifest the app reads to know what it can play.
//
// Archive audio is NOT in git and is not redistributed by this project. Each
// file is fetched from a public archive at the operator's request, and the
// licence is read from that archive's own metadata rather than guessed. By
// default only public-domain dedications are accepted (CC0 and the Public
// Domain Mark): an unlicensed file is worse than a missing one, because a
// missing one is obvious. --allow-attribution widens that to CC BY and
// CC BY-SA, which are usable but oblige you to keep the credit visible;
// every accepted file's credit is written into the lock and the manifest
// and shown on the app's /licenses page either way.
//
// Sources, tried in the order that suits the layer:
//   commons    Wikimedia Commons. Best for room tone and one-shot sounds,
//              and its licence metadata is machine-readable and reliable.
//   freesound  The best source for this material by a distance, and the
//              only one that needs a key: set FREESOUND_API_KEY (free, from
//              freesound.org/apiv2/apply). Fetches the CC0-filtered preview
//              renders, which are 128kbps mp3 and ample for a bed.
//   archive    The Internet Archive. Best for music, where "public domain"
//              usually means an old recording rather than a dedication.
//
// Every candidate goes through scripts/lib/ambience-gate.mjs: licence,
// spoken word, relevance and length. The archives are full of correctly
// licensed audiobooks and pronunciation clips, and one in the cave is worse
// than silence.
//
// Usage:
//   node scripts/fetch-ambience.mjs                    fill every empty cue
//   node scripts/fetch-ambience.mjs --cue tavern       just this one
//   node scripts/fetch-ambience.mjs --cue cave --skip 1   take the next candidate
//   node scripts/fetch-ambience.mjs --allow-attribution   accept CC BY / CC BY-SA
//   node scripts/fetch-ambience.mjs --source commons   force one source
//   node scripts/fetch-ambience.mjs --force            refetch cues already filled
//   node scripts/fetch-ambience.mjs --dry-run          resolve and report only
//   node scripts/fetch-ambience.mjs --manifest         rebuild manifest.json only
//   node scripts/fetch-ambience.mjs --pack [url]       install the sound pack
//                                                      (this release's asset by default)
//
// A cue may hold several takes: tavern.mp3, tavern-2.mp3, tavern-3.ogg. The
// fetch fills a cue that has none; scripts/generate-ambience.mjs adds takes.
// Curating by hand: drop a file named after the cue into public/ambience and
// run with --manifest. It is kept, credited as locally supplied, and never
// overwritten. data/ambience-sources.json pins exact URLs for cues the
// searches cannot fill; data/ambience-lock.json records what each file
// resolved to, so a second machine fetches the same files rather than
// whatever the search returns that day. See docs/configuration.md.
import { mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { acceptLicense, admit } from "./lib/ambience-gate.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { AMBIENCE_CUES } = await import("../src/lib/ambience/catalog.ts");
const { AUDIO_EXTENSIONS, libraryRoot, nextTrackFile, parseTrackFile, readLock, rebuildManifest, writeLock } =
  await import("../src/lib/ambience/library.ts");
const { installPack, packAssetUrl } = await import("../src/lib/ambience/pack.ts");

const ROOT = process.cwd();
const OUT_DIR = libraryRoot();
const SOURCES = path.join(ROOT, "data", "ambience-sources.json");

const MIN_BYTES = 20 * 1024;
const MAX_BYTES = 25 * 1024 * 1024;
const DELAY_MS = 400;
// Commons answers a burst of searches with 429; waiting it out beats
// reporting "nothing found" for a cue it simply had not answered yet.
const RETRY_MS = [3000, 8000, 20000];
const AGENT = "open-dungeon-master/ambience (local install; https://github.com/Lebbitheplow/open-dungeon-master)";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
function option(name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
}

const onlyCue = option("cue");
const onlySource = option("source");
const skipCount = Number(option("skip", "0")) || 0;
const force = flag("force");
const dryRun = flag("dry-run");
const manifestOnly = flag("manifest");
const allowAttribution = flag("allow-attribution");
const freesoundKey = process.env.FREESOUND_API_KEY ?? "";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const strip = (html) => String(html ?? "").replace(/<[^>]*>/g, "").trim();

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function getJson(url) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": AGENT } });
    if (response.ok) {
      return response.json();
    }
    if ((response.status === 429 || response.status >= 500) && attempt < RETRY_MS.length) {
      await sleep(RETRY_MS[attempt]);
      continue;
    }
    throw new Error(`${new URL(url).hostname} answered ${response.status}`);
  }
}

function sizeOk(bytes) {
  return bytes >= MIN_BYTES && bytes <= MAX_BYTES;
}

// ---- sources ----

// Each returns an ordered list of candidates:
// { title, author, license, source, url, bytes, seconds }

async function fromCommons(query) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", `filetype:audio ${query}`);
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", "25");
  url.searchParams.set("prop", "imageinfo");
  // size carries the duration for audio, which the length gate needs.
  url.searchParams.set("iiprop", "url|extmetadata|size|mime");
  url.searchParams.set("format", "json");
  const body = await getJson(url);
  const candidates = [];
  for (const page of Object.values(body?.query?.pages ?? {})) {
    const info = page.imageinfo?.[0];
    const meta = info?.extmetadata ?? {};
    if (!info?.url || !sizeOk(Number(info.size ?? 0))) {
      continue;
    }
    // Commons hands back a URL with tracking parameters on it, so the
    // extension has to come from the path rather than the whole string.
    if (!AUDIO_EXTENSIONS.includes(path.extname(new URL(info.url).pathname).toLowerCase())) {
      continue;
    }
    candidates.push({
      title: String(page.title ?? "").replace(/^File:/, ""),
      author: strip(meta.Artist?.value) || strip(meta.Credit?.value) || "Unknown",
      license: acceptLicense(
        strip(meta.LicenseShortName?.value) || strip(meta.License?.value),
        strip(meta.LicenseUrl?.value),
        allowAttribution,
      ),
      source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
      url: info.url,
      bytes: Number(info.size ?? 0),
      seconds: Number(info.duration ?? 0),
    });
  }
  return candidates;
}

async function fromFreesound(query) {
  if (!freesoundKey) {
    return [];
  }
  const url = new URL("https://freesound.org/apiv2/search/text/");
  url.searchParams.set("query", query);
  // The API's own filter, so the licence gate below is a second check
  // rather than the only one.
  url.searchParams.set(
    "filter",
    allowAttribution
      ? '(license:"Creative Commons 0" OR license:"Attribution")'
      : 'license:"Creative Commons 0"',
  );
  url.searchParams.set("fields", "id,name,username,license,url,previews,filesize,duration");
  url.searchParams.set("page_size", "25");
  url.searchParams.set("token", freesoundKey);
  const body = await getJson(url);
  const candidates = [];
  for (const hit of body?.results ?? []) {
    const preview = hit.previews?.["preview-hq-mp3"] ?? hit.previews?.["preview-lq-mp3"];
    if (!preview) {
      continue;
    }
    candidates.push({
      title: String(hit.name ?? `freesound ${hit.id}`),
      author: String(hit.username ?? "Unknown"),
      license: acceptLicense(hit.license, hit.license, allowAttribution),
      source: String(hit.url ?? `https://freesound.org/s/${hit.id}/`),
      url: preview,
      bytes: 0,
      seconds: Number(hit.duration ?? 0),
    });
  }
  return candidates;
}

async function fromArchive(query) {
  const url = new URL("https://archive.org/advancedsearch.php");
  // The spoken-word collections are left out at the search rather than
  // filtered after, so the 25 rows are not all LibriVox.
  url.searchParams.set(
    "q",
    `${query} AND mediatype:(audio) AND NOT collection:(librivoxaudio OR audio_bookspoetry OR podcasts OR audio_news OR audio_religion OR spokenwordaudio)`,
  );
  for (const field of ["identifier", "title", "creator", "licenseurl"]) {
    url.searchParams.append("fl[]", field);
  }
  url.searchParams.set("rows", "25");
  url.searchParams.set("page", "1");
  url.searchParams.set("output", "json");
  const body = await getJson(url);
  const candidates = [];
  for (const doc of body?.response?.docs ?? []) {
    candidates.push({
      identifier: doc.identifier,
      title: String(doc.title ?? doc.identifier),
      author: Array.isArray(doc.creator) ? doc.creator.join(", ") : String(doc.creator ?? "Unknown"),
      license: acceptLicense(doc.licenseurl, doc.licenseurl, allowAttribution),
      source: `https://archive.org/details/${doc.identifier}`,
      url: null,
      bytes: 0,
      seconds: 0,
    });
  }
  return candidates;
}

// An archive.org hit names an item, not a file, so the file is chosen in a
// second call. Smallest usable one of the right length: these are loops and
// one-shots, and the archive's own derivative mp3 is almost always the
// right pick.
async function resolveArchiveFile(candidate, layer) {
  const body = await getJson(
    `https://archive.org/metadata/${encodeURIComponent(candidate.identifier)}`,
  );
  const file = (body?.files ?? [])
    .map((entry) => ({
      name: String(entry.name ?? ""),
      size: Number(entry.size ?? 0),
      seconds: Number(entry.length ?? 0),
    }))
    .filter(
      (entry) =>
        AUDIO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase()) &&
        sizeOk(entry.size) &&
        admit({ ...candidate, seconds: entry.seconds }, { layer, query: candidate.query, allowAttribution }).ok,
    )
    .sort((a, b) => a.size - b.size)[0];
  if (!file) {
    return null;
  }
  return {
    ...candidate,
    url: `https://archive.org/download/${encodeURIComponent(candidate.identifier)}/${encodeURIComponent(file.name)}`,
    bytes: file.size,
    seconds: file.seconds,
  };
}

// Music means old recordings, which the Internet Archive has and Commons
// mostly does not; room tone and one-shots are the other way round.
function sourcesFor(layer) {
  const order =
    layer === "music" ? ["archive", "freesound", "commons"] : ["commons", "freesound", "archive"];
  return onlySource ? order.filter((name) => name === onlySource) : order;
}

// The cue's own phrases first, then its plainest keywords: Commons and the
// archive both answer a two-word query far better than a five-word one, and
// a cue that finds nothing specific should still get a chance at "cavern".
function queriesFor(cue) {
  return [...cue.search, ...cue.keywords.slice(0, 3)];
}

async function resolve(cue) {
  let seen = 0;
  const refused = new Map();
  for (const source of sourcesFor(cue.layer)) {
    for (const query of queriesFor(cue)) {
      let candidates = [];
      try {
        candidates =
          source === "commons"
            ? await fromCommons(query)
            : source === "freesound"
              ? await fromFreesound(query)
              : await fromArchive(query);
      } catch (error) {
        console.warn(`  ! ${source} "${query}": ${error.message}`);
        continue;
      }
      for (const candidate of candidates) {
        const verdict = admit(candidate, { layer: cue.layer, query, allowAttribution });
        if (!verdict.ok) {
          refused.set(verdict.why, (refused.get(verdict.why) ?? 0) + 1);
          continue;
        }
        if (seen++ < skipCount) {
          continue;
        }
        if (candidate.url) {
          return { ...candidate, source_name: source };
        }
        await sleep(DELAY_MS);
        const resolved = await resolveArchiveFile({ ...candidate, query }, cue.layer);
        if (resolved) {
          return { ...resolved, source_name: source };
        }
      }
      await sleep(DELAY_MS);
    }
  }
  if (refused.size) {
    const why = [...refused.entries()].map(([reason, count]) => `${count} ${reason}`).join(", ");
    console.log(`  refused: ${why}`);
  }
  return null;
}

async function download(url, destination) {
  const response = await fetch(url, { headers: { "User-Agent": AGENT }, redirect: "follow" });
  if (!response.ok) {
    throw new Error(`download answered ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < MIN_BYTES) {
    throw new Error(`file is only ${buffer.length} bytes`);
  }
  writeFileSync(destination, buffer);
  return buffer.length;
}

function filesFor(cueId) {
  if (!existsSync(OUT_DIR)) {
    return [];
  }
  return readdirSync(OUT_DIR).filter((name) => parseTrackFile(name)?.cueId === cueId);
}

// ---- run ----

mkdirSync(OUT_DIR, { recursive: true });

if (manifestOnly) {
  console.log(`[ambience] manifest rebuilt: ${rebuildManifest()} cues playable.`);
  process.exit(0);
}

if (flag("pack")) {
  const pkg = readJson(path.join(ROOT, "package.json"), { version: "0.0.0" });
  const url = process.env.AMBIENCE_PACK_URL || option("pack") || packAssetUrl(pkg.version);
  console.log(`[ambience] fetching the sound pack from ${url}`);
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10 * 60_000) });
  if (!response.ok) {
    console.error(`[ambience] ${new URL(url).host} answered ${response.status}; no pack for this version?`);
    process.exit(1);
  }
  const result = await installPack(Buffer.from(await response.arrayBuffer()), { replace: force });
  console.log(
    `[ambience] ${result.installed} tracks installed, ${result.kept} already here, ${result.playable} cues playable.`,
  );
  process.exit(0);
}

const lock = readLock();
const pinned = readJson(SOURCES, {});

const cues = AMBIENCE_CUES.filter((cue) => !onlyCue || cue.id === onlyCue);
if (onlyCue && !cues.length) {
  console.error(`[ambience] no cue called "${onlyCue}".`);
  process.exit(1);
}

console.log(
  `[ambience] accepting ${allowAttribution ? "public domain, CC BY and CC BY-SA" : "public domain only"}` +
    `${freesoundKey ? "" : " (no FREESOUND_API_KEY: that source is skipped)"}`,
);

let filled = 0;
let skipped = 0;
const missing = [];

for (const cue of cues) {
  const existing = filesFor(cue.id);
  if (existing.length && !force) {
    skipped += 1;
    continue;
  }
  console.log(`[ambience] ${cue.id} (${cue.label})`);

  // A pinned source wins outright: somebody chose that file deliberately,
  // and the licence they recorded is theirs to stand behind. After that,
  // what this cue resolved to last time, so a second machine gets the same
  // file; a search only when neither says anything.
  const pin = pinned[cue.id];
  const locked = Object.entries(lock).find(
    ([name, entry]) => parseTrackFile(name)?.cueId === cue.id && entry.url && entry.origin === "fetched",
  );
  const hit = pin?.url
    ? {
        title: pin.title ?? cue.label,
        author: pin.author ?? "Unknown",
        license: pin.license ?? "Declared by the operator",
        source: pin.source ?? pin.url,
        url: pin.url,
        source_name: "pinned",
      }
    : locked && !force
      ? { ...locked[1], source_name: "lock" }
      : await resolve(cue);

  if (!hit) {
    console.log("  nothing acceptable found");
    missing.push(cue.id);
    continue;
  }
  console.log(`  ${hit.title} — ${hit.author} [${hit.source_name}]`);
  console.log(`  ${hit.license} · ${hit.source}${hit.seconds ? ` · ${Math.round(hit.seconds)}s` : ""}`);
  if (dryRun) {
    continue;
  }

  const extension = path.extname(new URL(hit.url).pathname).toLowerCase() || ".mp3";
  const file = nextTrackFile(cue.id, AUDIO_EXTENSIONS.includes(extension) ? extension : ".mp3", force ? [] : existing);
  try {
    const bytes = await download(hit.url, path.join(OUT_DIR, file));
    lock[file] = {
      title: hit.title,
      author: hit.author,
      license: hit.license,
      source: hit.source,
      origin: hit.source_name === "pinned" ? "local" : "fetched",
      url: hit.url,
    };
    console.log(`  saved ${(bytes / 1024 / 1024).toFixed(1)} MB as ${file}`);
    filled += 1;
  } catch (error) {
    console.warn(`  ! ${error.message}`);
    missing.push(cue.id);
  }
  await sleep(DELAY_MS);
}

if (!dryRun) {
  writeLock(lock);
  console.log(
    `\n[ambience] ${filled} fetched, ${skipped} already present, ${rebuildManifest()} cues playable.`,
  );
}
if (missing.length) {
  console.log(`\n[ambience] no file for: ${missing.join(", ")}`);
  console.log("[ambience] try --allow-attribution, --skip 1, a FREESOUND_API_KEY,");
  console.log("[ambience] pin a URL in data/ambience-sources.json, or make the track here:");
  console.log("[ambience] npm run generate-ambience (see docs/configuration.md).");
}
