// Fills the sound library: downloads one audio file per cue in
// src/lib/ambience/catalog.ts into public/ambience, and writes the manifest
// the app reads to know what it can play.
//
// The audio is NOT in git and is not redistributed by this project. Each
// file is fetched from a public archive at the operator's request, and the
// licence is read from that archive's own metadata rather than guessed. By
// default only public-domain dedications are accepted (CC0 and the Public
// Domain Mark): an unlicensed file is worse than a missing one, because a
// missing one is obvious. --allow-attribution widens that to CC BY and
// CC BY-SA, which are usable but oblige you to keep the credit visible;
// every accepted file's credit is written into the manifest and shown on
// the app's /licenses page either way.
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
// Usage:
//   node scripts/fetch-ambience.mjs                    fill every empty cue
//   node scripts/fetch-ambience.mjs --cue tavern       just this one
//   node scripts/fetch-ambience.mjs --cue cave --skip 1   take the next candidate
//   node scripts/fetch-ambience.mjs --allow-attribution   accept CC BY / CC BY-SA
//   node scripts/fetch-ambience.mjs --source commons   force one source
//   node scripts/fetch-ambience.mjs --force            refetch cues already filled
//   node scripts/fetch-ambience.mjs --dry-run          resolve and report only
//   node scripts/fetch-ambience.mjs --manifest         rebuild manifest.json only
//
// Curating by hand: drop a file named after the cue (tavern.mp3) into
// public/ambience and run with --manifest. It is kept, credited as locally
// supplied, and never overwritten. data/ambience-sources.json pins exact
// URLs for cues the searches cannot fill; see docs/configuration.md.
import { mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { AMBIENCE_CUES } = await import("../src/lib/ambience/catalog.ts");

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public", "ambience");
const MANIFEST = path.join(OUT_DIR, "manifest.json");
// Resolved sources, kept in git-ignored data/ so a second machine fetches
// the same files rather than whatever the search returns that day.
const LOCK = path.join(ROOT, "data", "ambience-lock.json");
const SOURCES = path.join(ROOT, "data", "ambience-sources.json");

const EXTENSIONS = [".mp3", ".ogg", ".opus", ".m4a", ".wav"];
const MIN_BYTES = 20 * 1024;
const MAX_BYTES = 25 * 1024 * 1024;
const DELAY_MS = 400;
const AGENT = "open-dungeon-master/ambience (local install; https://github.com/)";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
function option(name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
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
  const response = await fetch(url, { headers: { "User-Agent": AGENT } });
  if (!response.ok) {
    throw new Error(`${new URL(url).hostname} answered ${response.status}`);
  }
  return response.json();
}

// ---- the licence gate ----

// Returns a short label when the licence is acceptable, null when it is not.
// Deliberately conservative: anything this cannot positively identify is
// refused, including a blank licence field.
function acceptLicense(shortName, url) {
  const text = `${shortName ?? ""} ${url ?? ""}`.toLowerCase();
  if (
    text.includes("publicdomain/zero") ||
    text.includes("publicdomain/mark") ||
    text.includes("creative commons 0") ||
    /\bcc0\b/.test(text) ||
    text.includes("public domain")
  ) {
    return "Public domain (CC0 or PD Mark)";
  }
  if (!allowAttribution) {
    return null;
  }
  // Order matters: "by-sa" contains "by".
  if (text.includes("by-sa") || text.includes("attribution-sharealike")) {
    return "CC BY-SA (attribution and share-alike required)";
  }
  if (text.includes("by-nc") || text.includes("noncommercial") || text.includes("noderiv")) {
    // NC and ND are refused even under --allow-attribution: whether an app
    // that plays them is a commercial or derivative use is exactly the
    // question this script must not answer on an operator's behalf.
    return null;
  }
  if (text.includes("cc by") || text.includes("cc-by") || text.includes("licenses/by/")) {
    return "CC BY (attribution required)";
  }
  return null;
}

function sizeOk(bytes) {
  return bytes >= MIN_BYTES && bytes <= MAX_BYTES;
}

// ---- the relevance gate ----

// Words that appear in every query and so distinguish nothing.
const NOISE = new Set([
  "sound", "sounds", "effect", "effects", "ambience", "ambient", "ambiance",
  "loop", "public", "domain", "music", "instrumental", "orchestral", "noise",
  "the", "and", "with", "from", "field", "recording",
]);

function words(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter((word) => word.length >= 4 && !NOISE.has(word));
}

// A search that returns something correctly licensed but about the wrong
// thing is the worse failure of the two: a missing cue is silent, and a
// wrong one is a polka in the crypt. The candidate's title has to share a
// distinguishing word with what was asked for.
function relevant(query, title) {
  const wanted = words(query);
  if (!wanted.length) {
    return true;
  }
  const found = new Set(words(title));
  return wanted.some((word) => found.has(word));
}

// ---- sources ----

// Each returns an ordered list of candidates:
// { title, author, license, source, url, bytes }

async function fromCommons(query) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", `filetype:audio ${query}`);
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", "25");
  url.searchParams.set("prop", "imageinfo");
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
    if (!EXTENSIONS.includes(path.extname(new URL(info.url).pathname).toLowerCase())) {
      continue;
    }
    const license = acceptLicense(
      strip(meta.LicenseShortName?.value) || strip(meta.License?.value),
      strip(meta.LicenseUrl?.value),
    );
    if (!license) {
      continue;
    }
    candidates.push({
      title: String(page.title ?? "").replace(/^File:/, ""),
      author: strip(meta.Artist?.value) || strip(meta.Credit?.value) || "Unknown",
      license,
      source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
      url: info.url,
      bytes: Number(info.size ?? 0),
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
      ? '(license:"Creative Commons 0" OR license:"Attribution" OR license:"Attribution NonCommercial")'
      : 'license:"Creative Commons 0"',
  );
  url.searchParams.set("fields", "id,name,username,license,url,previews,filesize,duration");
  url.searchParams.set("page_size", "25");
  url.searchParams.set("token", freesoundKey);
  const body = await getJson(url);
  const candidates = [];
  for (const hit of body?.results ?? []) {
    const license = acceptLicense(hit.license, hit.license);
    const preview = hit.previews?.["preview-hq-mp3"] ?? hit.previews?.["preview-lq-mp3"];
    if (!license || !preview) {
      continue;
    }
    candidates.push({
      title: String(hit.name ?? `freesound ${hit.id}`),
      author: String(hit.username ?? "Unknown"),
      license,
      source: String(hit.url ?? `https://freesound.org/s/${hit.id}/`),
      url: preview,
      bytes: 0,
    });
  }
  return candidates;
}

async function fromArchive(query) {
  const url = new URL("https://archive.org/advancedsearch.php");
  url.searchParams.set("q", `${query} AND mediatype:(audio)`);
  for (const field of ["identifier", "title", "creator", "licenseurl"]) {
    url.searchParams.append("fl[]", field);
  }
  url.searchParams.set("rows", "25");
  url.searchParams.set("page", "1");
  url.searchParams.set("output", "json");
  const body = await getJson(url);
  const candidates = [];
  for (const doc of body?.response?.docs ?? []) {
    const license = acceptLicense(doc.licenseurl, doc.licenseurl);
    if (!license) {
      continue;
    }
    candidates.push({
      identifier: doc.identifier,
      title: String(doc.title ?? doc.identifier),
      author: Array.isArray(doc.creator) ? doc.creator.join(", ") : String(doc.creator ?? "Unknown"),
      license,
      source: `https://archive.org/details/${doc.identifier}`,
      url: null,
      bytes: 0,
    });
  }
  return candidates;
}

// An archive.org hit names an item, not a file, so the file is chosen in a
// second call. Smallest usable one: these are loops and one-shots, and the
// archive's own derivative mp3 is almost always the right pick.
async function resolveArchiveFile(candidate) {
  const body = await getJson(
    `https://archive.org/metadata/${encodeURIComponent(candidate.identifier)}`,
  );
  const file = (body?.files ?? [])
    .map((entry) => ({ name: String(entry.name ?? ""), size: Number(entry.size ?? 0) }))
    .filter(
      (entry) => EXTENSIONS.includes(path.extname(entry.name).toLowerCase()) && sizeOk(entry.size),
    )
    .sort((a, b) => a.size - b.size)[0];
  if (!file) {
    return null;
  }
  return {
    ...candidate,
    url: `https://archive.org/download/${encodeURIComponent(candidate.identifier)}/${encodeURIComponent(file.name)}`,
    bytes: file.size,
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
        if (!relevant(query, candidate.title)) {
          continue;
        }
        if (seen++ < skipCount) {
          continue;
        }
        if (candidate.url) {
          return { ...candidate, source_name: source };
        }
        await sleep(DELAY_MS);
        const resolved = await resolveArchiveFile(candidate);
        if (resolved) {
          return { ...resolved, source_name: source };
        }
      }
      await sleep(DELAY_MS);
    }
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

// ---- the manifest ----

// Rebuilt from what is actually on disk, every run. The lock file supplies
// the credits; a file with no lock entry is one somebody added by hand, and
// is kept and credited as such rather than treated as an error.
function writeManifest(lock) {
  mkdirSync(OUT_DIR, { recursive: true });
  const known = new Set(AMBIENCE_CUES.map((cue) => cue.id));
  const tracks = {};
  for (const name of readdirSync(OUT_DIR)) {
    const extension = path.extname(name).toLowerCase();
    const cueId = path.basename(name, extension);
    if (!EXTENSIONS.includes(extension) || !known.has(cueId)) {
      continue;
    }
    const entry = lock[cueId];
    tracks[cueId] =
      entry?.file === name
        ? {
            file: name,
            title: entry.title,
            author: entry.author,
            source: entry.source,
            license: entry.license,
          }
        : {
            file: name,
            title: cueId,
            author: "Supplied locally",
            source: "",
            license: "Declared by the operator",
          };
  }
  writeFileSync(
    MANIFEST,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), tracks }, null, 2)}\n`,
  );
  return Object.keys(tracks).length;
}

function existingFile(cueId) {
  for (const extension of EXTENSIONS) {
    if (existsSync(path.join(OUT_DIR, `${cueId}${extension}`))) {
      return `${cueId}${extension}`;
    }
  }
  return null;
}

// ---- run ----

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(path.dirname(LOCK), { recursive: true });

const lock = readJson(LOCK, {});
const pinned = readJson(SOURCES, {});

if (manifestOnly) {
  console.log(`[ambience] manifest rebuilt: ${writeManifest(lock)} cues playable.`);
  process.exit(0);
}

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
  if (existingFile(cue.id) && !force) {
    skipped += 1;
    continue;
  }
  console.log(`[ambience] ${cue.id} (${cue.label})`);

  // A pinned source wins outright: somebody chose that file deliberately,
  // and the licence they recorded is theirs to stand behind.
  const pin = pinned[cue.id];
  const hit = pin?.url
    ? {
        title: pin.title ?? cue.label,
        author: pin.author ?? "Unknown",
        license: pin.license ?? "Declared by the operator",
        source: pin.source ?? pin.url,
        url: pin.url,
        source_name: "pinned",
      }
    : await resolve(cue);

  if (!hit) {
    console.log("  nothing acceptable found");
    missing.push(cue.id);
    continue;
  }
  console.log(`  ${hit.title} — ${hit.author} [${hit.source_name}]`);
  console.log(`  ${hit.license} · ${hit.source}`);
  if (dryRun) {
    continue;
  }

  const extension = path.extname(new URL(hit.url).pathname).toLowerCase() || ".mp3";
  const file = `${cue.id}${EXTENSIONS.includes(extension) ? extension : ".mp3"}`;
  try {
    const bytes = await download(hit.url, path.join(OUT_DIR, file));
    lock[cue.id] = {
      file,
      title: hit.title,
      author: hit.author,
      license: hit.license,
      source: hit.source,
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
  writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(
    `\n[ambience] ${filled} fetched, ${skipped} already present, ${writeManifest(lock)} cues playable.`,
  );
}
if (missing.length) {
  console.log(`\n[ambience] no file for: ${missing.join(", ")}`);
  console.log("[ambience] try --allow-attribution, --skip 1, a FREESOUND_API_KEY,");
  console.log("[ambience] or pin a URL in data/ambience-sources.json.");
}
