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
//   opengameart  OpenGameArt.org: game music, loops and effects under CC0,
//                CC BY, CC BY-SA and OGA-BY, the licence on every page.
//                Best for room tone, stings and loops.
//   incompetech  Kevin MacLeod's catalogue (incompetech.com), CC BY 4.0,
//                every piece tagged by mood and filed under collections
//                like Tension, Mystery, Wonder, Horror and Celtic and
//                Folk. Best for the music cues.
//   commons      Wikimedia Commons. Public-domain field recordings and
//                one-shots; its licence metadata is machine-readable.
//   freesound    CC0 recordings, the only source needing a key: set
//                FREESOUND_API_KEY (free, from freesound.org/apiv2/apply).
//   archive      The Internet Archive, for old public-domain recordings.
//
// Licences: public domain and the attribution licences (CC BY, CC BY-SA,
// OGA-BY) are accepted, because the app keeps the credit: every file's
// title, author, source and licence go into the lock and the manifest and
// are shown on /licenses, and travel inside the sound pack. The licence is
// read from each source's own record, never guessed, and anything the
// script cannot positively identify is refused. --public-domain-only
// narrows it to CC0 and the Public Domain Mark. NonCommercial and
// NoDerivatives are refused either way.
//
// Every candidate goes through scripts/lib/ambience-gate.mjs: licence,
// spoken word, relevance and length. The archives are full of correctly
// licensed audiobooks and pronunciation clips, and one in the cave is worse
// than silence.
//
// Usage:
//   node scripts/fetch-ambience.mjs                    fill every empty cue
//   node scripts/fetch-ambience.mjs --cue tavern       just this one
//   node scripts/fetch-ambience.mjs --layer music      one layer
//   node scripts/fetch-ambience.mjs --takes 2          this many files per cue
//   node scripts/fetch-ambience.mjs --cue cave --skip 1   take the next candidate
//   node scripts/fetch-ambience.mjs --public-domain-only
//   node scripts/fetch-ambience.mjs --source commons   force one source
//   node scripts/fetch-ambience.mjs --force            refetch cues already filled
//   node scripts/fetch-ambience.mjs --dry-run          resolve and report only
//   node scripts/fetch-ambience.mjs --manifest         rebuild manifest.json only
//   node scripts/fetch-ambience.mjs --pack [url]       install the sound pack
//                                                      (this release's asset by default)
//   node scripts/fetch-ambience.mjs --export-sources   write the resolved library
//                                                      to src/lib/ambience/sources.json
//   node scripts/fetch-ambience.mjs --reject city.wav  throw a file out for good
//                                                      (data/ambience-rejects.json)
//
// Where a file comes from, in order: the operator's pins
// (data/ambience-sources.json), the lock (data/ambience-lock.json, what this
// install resolved before), the shipped pins (src/lib/ambience/sources.json,
// the library the project resolved and committed, so every install gets the
// same tracks), and only then a search.
//
// A cue may hold several takes: tavern.mp3, tavern-2.mp3, tavern-3.ogg.
// Curating by hand: drop a file named after the cue into public/ambience and
// run with --manifest. It is kept, credited as locally supplied, and never
// overwritten. See docs/configuration.md.
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { acceptLicense, admit, durationOk, redistributable } from "./lib/ambience-gate.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { AMBIENCE_CUES } = await import("../src/lib/ambience/catalog.ts");
const { AUDIO_EXTENSIONS, libraryRoot, nextTrackFile, parseTrackFile, readLock, rebuildManifest, writeLock } =
  await import("../src/lib/ambience/library.ts");
const { installPack, packAssetUrl } = await import("../src/lib/ambience/pack.ts");

const ROOT = process.cwd();
const OUT_DIR = libraryRoot();
const SOURCES = path.join(ROOT, "data", "ambience-sources.json");
const SHIPPED = path.join(ROOT, "src", "lib", "ambience", "sources.json");
// Files the operator threw out, by URL, so a search never brings them back.
const REJECTS = path.join(ROOT, "data", "ambience-rejects.json");

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
const onlyLayer = option("layer");
const onlySource = option("source");
const skipCount = Number(option("skip", "0")) || 0;
const takes = Math.max(1, Number(option("takes", "1")) || 1);
const force = flag("force");
const dryRun = flag("dry-run");
const manifestOnly = flag("manifest");
const publicDomainOnly = flag("public-domain-only");
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
        publicDomainOnly,
      ),
      source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
      url: info.url,
      bytes: Number(info.size ?? 0),
      seconds: Number(info.duration ?? 0),
      categories: strip(meta.Categories?.value),
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
    publicDomainOnly
      ? 'license:"Creative Commons 0"'
      : '(license:"Creative Commons 0" OR license:"Attribution")',
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
      license: acceptLicense(hit.license, hit.license, publicDomainOnly),
      source: String(hit.url ?? `https://freesound.org/s/${hit.id}/`),
      url: preview,
      bytes: 0,
      seconds: Number(hit.duration ?? 0),
    });
  }
  return candidates;
}

async function fromArchive(query, layer = "music") {
  const url = new URL("https://archive.org/advancedsearch.php");
  // The spoken-word and radio-drama collections are left out at the
  // search rather than filtered after, so the 25 rows are not all
  // LibriVox. A bed asks the field-recording collection (radio aporee:
  // places recorded as they sound, each with its licence) before the rest.
  const exclude = "librivoxaudio OR audio_bookspoetry OR podcasts OR audio_news OR audio_religion OR spokenwordaudio OR oldtimeradio OR radioprograms OR audio_foreign";
  url.searchParams.set(
    "q",
    layer === "bed"
      ? `${query} AND mediatype:(audio) AND collection:(radio-aporee)`
      : `${query} AND mediatype:(audio) AND NOT collection:(${exclude})`,
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
      license: acceptLicense(doc.licenseurl, doc.licenseurl, publicDomainOnly),
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
        admit({ ...candidate, seconds: entry.seconds }, { layer, query: candidate.query }).ok,
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

// OpenGameArt: the advanced search as a page (there is no API), then each
// item's page for its files, licence and author. The site states the licence
// on every item, which is what makes it usable here at all.
const OGA = "https://opengameart.org";
// Music 12, sound effect 13. Room tone is filed under either, so a bed
// asks both.
const OGA_TYPES = { music: [12], bed: [13, 12], sting: [13] };
const ogaItems = new Map();

async function getText(url) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": AGENT } });
    if (response.ok) {
      return response.text();
    }
    if ((response.status === 429 || response.status >= 500) && attempt < RETRY_MS.length) {
      await sleep(RETRY_MS[attempt]);
      continue;
    }
    throw new Error(`${new URL(url).hostname} answered ${response.status}`);
  }
}

const unescapeHtml = (text) =>
  String(text ?? "")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();

async function ogaItem(slug) {
  if (ogaItems.has(slug)) {
    return ogaItems.get(slug);
  }
  const html = await getText(`${OGA}/content/${slug}`);
  const title = unescapeHtml(/<title>([^<|]+)/.exec(html)?.[1] ?? slug);
  const licenses = [...html.matchAll(/field-name-field-art-licenses[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g)]
    .map((m) => strip(m[0]).replace(/License\(s\):/i, "").trim())
    .join(" ");
  const author = unescapeHtml(/field-name-author-submitter[\s\S]*?class='username'>\s*<a[^>]*>([^<]+)</.exec(html)?.[1] ?? "");
  // The attached files, not the site's low-rate previews. One or more; the
  // smallest within bounds is the pick, the way the archive is handled.
  const files = [...html.matchAll(/href="(https:\/\/opengameart\.org\/sites\/default\/files\/[^"]+\.(?:mp3|ogg|wav|opus|m4a))"/gi)]
    .map((m) => m[1])
    .filter((url) => !url.includes("/audio_preview/"));
  const tags = [...html.matchAll(/field_art_tags_tid=([^"&]+)"/g)].map((m) => decodeURIComponent(m[1]).toLowerCase());
  const type = /field-name-field-art-type[\s\S]*?>(Music|Sound Effect)</.exec(html)?.[1] ?? "";
  const item = { slug, title, licenses, author: author || "Unknown", files: [...new Set(files)], tags, type };
  ogaItems.set(slug, item);
  await sleep(DELAY_MS);
  return item;
}

async function fromOpenGameArt(query, layer, cue) {
  const slugs = [];
  for (const type of OGA_TYPES[layer] ?? [13]) {
    const url = new URL(`${OGA}/art-search-advanced`);
    url.searchParams.set("keys", query);
    url.searchParams.append("field_art_type_tid[]", String(type));
    url.searchParams.set("sort_by", "count");
    url.searchParams.set("sort_order", "DESC");
    url.searchParams.set("items_per_page", "24");
    const html = await getText(url);
    for (const m of html.matchAll(/class="art-preview-title"><a href="\/content\/([^"]+)"/g)) {
      if (!slugs.includes(m[1])) {
        slugs.push(m[1]);
      }
    }
    await sleep(DELAY_MS);
  }
  // The search matches the term anywhere, popularity first, which put a
  // racing theme on the coast and a seagull on the critical hit. So each
  // item is read and scored: the cue's own words in the title or the tags,
  // room tone for a bed, and nothing from another genre or from a bundle of
  // assorted sounds. Only a score shows up at all.
  // "Ambient" and "loopable" are said of plenty of music; room tone calls
  // itself one of these.
  const roomTone = /ambience|ambiance|soundscape|room tone|field recording|background (noise|sound)|environment(al)? (audio|sound)|nature sound/i;
  const offGenre = /sci-?fi|space|futur|cyber|racing|chiptune|8-?bit|retro|techno|electro|synth|dubstep|dance|hip ?hop|trap|lo-?fi|christmas|western|tribal|shaman|surf|\brock\b|punk|metal|jazz|blues|funk|disco|\bpop\b|rap\b/i;
  const bundle = /\bpack\b|various|collection|\bsfx pack|sounds? (pack|set|bundle)|\d+ sounds/i;
  const wanted = (cue?.keywords ?? []).concat(cue?.label ? [cue.label] : []).map((word) => word.toLowerCase());
  const scored = [];
  for (const [index, slug] of slugs.slice(0, 18).entries()) {
    let item;
    try {
      item = await ogaItem(slug);
    } catch (error) {
      console.warn(`  ! opengameart ${slug}: ${error.message}`);
      continue;
    }
    if (!item.files.length) {
      continue;
    }
    const title = item.title.toLowerCase();
    const text = `${title} ${item.tags.join(" ")} ${slug.replace(/-/g, " ")}`;
    // Another genre's word anywhere is the end of it: a surf-rock tune tagged
    // "coast", "beach" and "ocean" is still surf rock.
    if (offGenre.test(text)) {
      continue;
    }
    // A bed is where they are, not a tune about it: a piece filed as music
    // is out unless it calls itself an ambience.
    if (layer === "bed" && item.type === "Music" && !roomTone.test(text)) {
      continue;
    }
    let score = 0;
    let matched = 0;
    for (const word of wanted) {
      if (title.includes(word)) {
        matched = Math.max(matched, 3);
      } else if (item.tags.some((tag) => tag.includes(word)) || slug.replace(/-/g, " ").includes(word)) {
        matched = Math.max(matched, 2);
      }
    }
    // Room tone with none of the cue's words is somebody else's room.
    if (!matched) {
      continue;
    }
    score += matched;
    if (layer === "bed" && roomTone.test(text)) {
      score += 2;
    }
    if (/\bloop/i.test(text) && layer !== "sting") {
      score += 1;
    }
    if (layer === "sting" && (bundle.test(text) || item.files.length > 4)) {
      score -= 4;
    }
    if (score >= 2) {
      scored.push({ score, index, item, slug });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map(({ item, slug }) => ({
    title: item.title,
    author: item.author,
    license: acceptLicense(item.licenses, "", publicDomainOnly),
    source: `${OGA}/content/${slug}`,
    // One file per item: the first attached, which is the one the author
    // led with. The length is measured after download.
    url: item.files[0],
    bytes: 0,
    seconds: 0,
    // Matched on the site's own tags; "Crowded Pub" is a tavern whatever
    // its title says.
    tagged: true,
  }));
}

// Kevin MacLeod's catalogue: one JSON of every piece, tagged by mood and
// filed under collections. A music cue names the collections and moods
// that fit it; a piece scores by those, by orchestral or acoustic
// instruments, and against the electronic and rock collections, which are
// not what a fantasy table wants under its scene. Everything is CC BY 4.0.
const INCOMPETECH = "https://incompetech.com/music/royalty-free";
const MOODS = {
  calm: { collections: [27, 20, 17, 16], feels: ["Calming", "Relaxed"] },
  wonder: { collections: [45, 43, 30], feels: ["Uplifting", "Mystical", "Epic"] },
  mystery: { collections: [40, 41], feels: ["Mysterious", "Eerie", "Mystical"] },
  tension: { collections: [44, 35], feels: ["Suspenseful", "Unnerving", "Dark"] },
  dread: { collections: [37, 38, 6, 5], feels: ["Dark", "Eerie", "Unnerving"] },
  battle: { collections: [33], feels: ["Action", "Intense", "Aggressive"] },
  boss: { collections: [33], feels: ["Epic", "Intense", "Aggressive"] },
  chase: { collections: [33], feels: ["Driving", "Action", "Intense"] },
  triumph: { collections: [43, 45], feels: ["Epic", "Uplifting", "Bright"] },
  sorrow: { collections: [36, 28], feels: ["Somber"] },
  travel: { collections: [3, 50], feels: ["Grooving", "Relaxed", "Bright"] },
  festive: { collections: [3, 50, 22], feels: ["Bouncy", "Humorous", "Bright"] },
};
const ORCHESTRAL = /strings|violin|viola|cello|bass|horn|brass|trumpet|trombone|tuba|choir|voices|timpani|harp|piano|flute|oboe|bassoon|clarinet|lute|recorder|guitar|percussion|drums|celesta|glockenspiel|harpsichord|organ|fiddle|accordion|whistle|bagpipe|dulcimer|mandolin/gi;
const ELECTRONIC = /synth|electronic|drum machine|808|sampler|sequencer|electric guitar|distort|dubstep|techno|house|trance|hip hop|rap|beat/gi;
const ELECTRONIC_COLLECTIONS = new Set([12, 18, 29, 7, 24, 25, 26, 11, 14, 23]);
let incompetechPieces = null;

function lengthSeconds(text) {
  const parts = String(text ?? "").split(":").map(Number);
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts.length === 2 ? parts[0] * 60 + parts[1] : 0;
}

async function fromIncompetech(cue) {
  const mood = MOODS[cue.id];
  if (!mood || cue.layer !== "music") {
    return [];
  }
  incompetechPieces ??= await getJson(`${INCOMPETECH}/pieces.json`);
  const scored = [];
  for (const piece of incompetechPieces) {
    const collection = Number(piece.collection);
    const feels = String(piece.feel ?? "").split(",").map((entry) => entry.trim());
    let score = 0;
    const slot = mood.collections.indexOf(collection);
    if (slot >= 0) {
      score += 6 - slot;
    }
    for (const feel of mood.feels) {
      if (feels.includes(feel)) {
        score += 2;
      }
    }
    const instruments = String(piece.instruments ?? "");
    score += Math.min(3, (instruments.match(ORCHESTRAL) ?? []).length);
    score -= 3 * (instruments.match(ELECTRONIC) ?? []).length;
    if (ELECTRONIC_COLLECTIONS.has(collection)) {
      score -= 6;
    }
    const seconds = lengthSeconds(piece.length);
    if (seconds < 60 || seconds > 420) {
      score -= 4;
    }
    if (score >= 6) {
      scored.push({ piece, score, seconds });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 40).map(({ piece, seconds }) => ({
    title: String(piece.title),
    author: "Kevin MacLeod (incompetech.com)",
    license: "CC BY 4.0 (attribution required)",
    source: `${INCOMPETECH}/index.html?isrc=${encodeURIComponent(piece.isrc ?? "")}`,
    url: `${INCOMPETECH}/mp3-royaltyfree/${encodeURIComponent(piece.filename)}`,
    bytes: 0,
    seconds,
    // Matched on the catalogue's own tags, so the title need not carry a
    // query word ("The Ice Giants" is a fine battle).
    tagged: true,
  }));
}

// Music goes to the catalogues made for it; room tone and one-shots to the
// game-asset site and the field recordings on Commons.
function sourcesFor(layer) {
  const order =
    layer === "music"
      ? ["incompetech", "opengameart", "archive", "freesound", "commons"]
      : ["opengameart", "commons", "freesound", "archive"];
  return onlySource ? order.filter((name) => name === onlySource) : order;
}

// The cue's own phrases first, then its plainest keywords: Commons and the
// archive both answer a two-word query far better than a five-word one, and
// a cue that finds nothing specific should still get a chance at "cavern".
function queriesFor(cue) {
  return [...cue.search, ...cue.keywords.slice(0, 3)];
}

// Every acceptable candidate for a cue, in the order the sources and
// queries rank them, one at a time: the caller pulls the next only when a
// download failed or measured wrong, so most cues cost one search.
async function* candidatesFor(cue, exclude = new Set()) {
  let seen = 0;
  const refused = new Map();
  for (const source of sourcesFor(cue.layer)) {
    // The catalogues answer a cue, not a query; one pass each. The game
    // asset site matches terms, so its plain keywords come first and the
    // archive phrasings after.
    const queries =
      source === "incompetech"
        ? [cue.label]
        : source === "opengameart"
          ? [...cue.keywords.slice(0, 2), ...cue.search]
          : queriesFor(cue);
    for (const query of queries) {
      let candidates = [];
      try {
        candidates =
          source === "commons"
            ? await fromCommons(query)
            : source === "freesound"
              ? await fromFreesound(query)
              : source === "opengameart"
                ? await fromOpenGameArt(query, cue.layer, cue)
                : source === "incompetech"
                  ? await fromIncompetech(cue)
                  : await fromArchive(query, cue.layer);
      } catch (error) {
        console.warn(`  ! ${source} "${query}": ${error.message}`);
        continue;
      }
      for (const candidate of candidates) {
        if (exclude.has(candidate.url) || exclude.has(candidate.source)) {
          continue;
        }
        const verdict = admit(candidate, { layer: cue.layer, query });
        if (!verdict.ok) {
          refused.set(verdict.why, (refused.get(verdict.why) ?? 0) + 1);
          continue;
        }
        if (seen++ < skipCount) {
          continue;
        }
        if (candidate.url) {
          yield { ...candidate, source_name: source };
          continue;
        }
        await sleep(DELAY_MS);
        const resolved = await resolveArchiveFile({ ...candidate, query }, cue.layer);
        if (resolved) {
          yield { ...resolved, source_name: source };
        }
      }
      await sleep(DELAY_MS);
    }
  }
  if (refused.size) {
    const why = [...refused.entries()].map(([reason, count]) => `${count} ${reason}`).join(", ");
    console.log(`  refused: ${why}`);
  }
}

// The length of a downloaded file, from ffprobe when it is installed. The
// sources rarely say, and a 26 s "thunder loop" is not a thunderclap.
function probeSeconds(file) {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
    return Number(out.trim()) || 0;
  } catch {
    return 0;
  }
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

// A WAV is ten times the size of the same sound as Ogg and the game-asset
// site serves plenty of them; the pack and every phone that installs it
// would rather not. Transcoded when ffmpeg is here, left alone otherwise.
function compressed(file) {
  if (path.extname(file).toLowerCase() !== ".wav") {
    return file;
  }
  const target = file.replace(/\.wav$/i, ".ogg");
  try {
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", file, "-codec:a", "libvorbis", "-q:a", "5", target], { stdio: "inherit" });
    unlinkSync(file);
    return target;
  } catch {
    return file;
  }
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
const shipped = readJson(SHIPPED, {});
const rejects = new Set(readJson(REJECTS, []));

// A wrong pick goes out by name, its URL and page remembered, and the next
// run fills the cue with something else.
const rejectFiles = args.filter((arg, index) => args[index - 1] === "--reject");
if (rejectFiles.length) {
  for (const name of rejectFiles) {
    const entry = lock[name];
    if (!entry) {
      console.error(`[ambience] ${name} is not in the lock.`);
      continue;
    }
    for (const key of [entry.url, entry.source]) {
      if (key) {
        rejects.add(key);
      }
    }
    delete lock[name];
    try {
      unlinkSync(path.join(OUT_DIR, name));
    } catch {
      // Already gone.
    }
    console.log(`[ambience] rejected ${name}: ${entry.title}`);
  }
  writeLock(lock);
  mkdirSync(path.dirname(REJECTS), { recursive: true });
  writeFileSync(REJECTS, `${JSON.stringify([...rejects], null, 2)}\n`);
  console.log(`[ambience] ${rebuildManifest()} cues playable.`);
  process.exit(0);
}

// The resolved library, as a file the project commits: every fetched track
// with a redistributable licence, keyed by file name, so the next install
// resolves the same tracks instead of searching.
if (flag("export-sources")) {
  const out = {};
  for (const [name, entry] of Object.entries(lock)) {
    if (entry.origin === "fetched" && entry.url && redistributable(entry.license)) {
      out[name] = { title: entry.title, author: entry.author, license: entry.license, source: entry.source, url: entry.url };
    }
  }
  writeFileSync(SHIPPED, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`[ambience] ${Object.keys(out).length} tracks written to ${path.relative(ROOT, SHIPPED)}.`);
  process.exit(0);
}

const cues = AMBIENCE_CUES.filter((cue) => (!onlyCue || cue.id === onlyCue) && (!onlyLayer || cue.layer === onlyLayer));
if (!cues.length) {
  console.error(`[ambience] no cue matches${onlyCue ? ` "${onlyCue}"` : ""}${onlyLayer ? ` in layer "${onlyLayer}"` : ""}.`);
  process.exit(1);
}

console.log(
  `[ambience] accepting ${publicDomainOnly ? "public domain only" : "public domain, CC BY, CC BY-SA and OGA-BY"}` +
    `${freesoundKey ? "" : " (no FREESOUND_API_KEY: that source is skipped)"}`,
);

let filled = 0;
let skipped = 0;
const missing = [];
// One file serves one cue: the forest and the night forest should not be
// the same birds, and three fights should not share one march.
const usedEverywhere = new Set([...rejects, ...Object.values(lock).flatMap((entry) => [entry.url, entry.source].filter(Boolean))]);

// A pin: somebody chose that file deliberately, and the licence they
// recorded is theirs to stand behind. The operator's pins name a cue; the
// shipped pins and the lock name a file.
function pinnedHits(cue) {
  const hits = [];
  const pin = pinned[cue.id];
  if (pin?.url) {
    hits.push({
      title: pin.title ?? cue.label,
      author: pin.author ?? "Unknown",
      license: pin.license ?? "Declared by the operator",
      source: pin.source ?? pin.url,
      url: pin.url,
      source_name: "pinned",
      origin: "local",
    });
  }
  for (const [name, entry] of Object.entries(force ? {} : lock)) {
    if (parseTrackFile(name)?.cueId === cue.id && entry.url && entry.origin === "fetched") {
      hits.push({ ...entry, source_name: "lock", origin: "fetched" });
    }
  }
  for (const [name, entry] of Object.entries(shipped)) {
    if (parseTrackFile(name)?.cueId === cue.id && entry.url) {
      hits.push({ ...entry, source_name: "shipped", origin: "fetched" });
    }
  }
  const seen = new Set();
  return hits.filter((hit) => !seen.has(hit.url) && seen.add(hit.url));
}

for (const cue of cues) {
  const existing = force ? [] : filesFor(cue.id);
  const wanted = takes - existing.length;
  if (wanted <= 0) {
    skipped += 1;
    continue;
  }
  console.log(`[ambience] ${cue.id} (${cue.label})`);
  // Files already here are not fetched twice; pins and the lock come
  // before a search, and a second take never repeats the first.
  const taken = new Set(
    Object.entries(lock)
      .filter(([name]) => parseTrackFile(name)?.cueId === cue.id && existing.includes(name))
      .flatMap(([, entry]) => [entry.url, entry.source].filter(Boolean)),
  );
  for (const url of usedEverywhere) {
    taken.add(url);
  }
  const queue = pinnedHits(cue).filter((hit) => !taken.has(hit.url));
  const found = candidatesFor(cue, taken);
  let got = 0;
  let tried = 0;
  while (got < wanted && tried < 8) {
    const hit = queue.shift() ?? (await found.next()).value;
    if (!hit) {
      break;
    }
    tried += 1;
    taken.add(hit.url);
    if (hit.source) {
      taken.add(hit.source);
    }
    console.log(`  ${hit.title} — ${hit.author} [${hit.source_name}]`);
    console.log(`  ${hit.license} · ${hit.source}${hit.seconds ? ` · ${Math.round(hit.seconds)}s` : ""}`);
    if (dryRun) {
      got += 1;
      continue;
    }
    const extension = path.extname(new URL(hit.url).pathname).toLowerCase() || ".mp3";
    const fetched = nextTrackFile(cue.id, AUDIO_EXTENSIONS.includes(extension) ? extension : ".mp3", filesFor(cue.id).filter((name) => !force || existing.includes(name)));
    try {
      const bytes = await download(hit.url, path.join(OUT_DIR, fetched));
      const target = compressed(path.join(OUT_DIR, fetched));
      const file = path.basename(target);
      const seconds = probeSeconds(target);
      if (!durationOk(cue.layer, seconds)) {
        unlinkSync(target);
        console.log(`  ! ${Math.round(seconds)}s is the wrong length for a ${cue.layer}; next`);
        continue;
      }
      lock[file] = {
        title: hit.title,
        author: hit.author,
        license: hit.license,
        source: hit.source,
        origin: hit.origin ?? "fetched",
        url: hit.url,
        ...(seconds ? { seconds: Math.round(seconds) } : {}),
      };
      writeLock(lock);
      usedEverywhere.add(hit.url);
      usedEverywhere.add(hit.source);
      console.log(`  saved ${(bytes / 1024 / 1024).toFixed(1)} MB as ${file}${seconds ? ` (${Math.round(seconds)}s)` : ""}`);
      filled += 1;
      got += 1;
    } catch (error) {
      console.warn(`  ! ${error.message}`);
    }
    await sleep(DELAY_MS);
  }
  if (!got && !existing.length) {
    console.log("  nothing acceptable found");
    missing.push(cue.id);
  }
}

if (!dryRun) {
  writeLock(lock);
  console.log(
    `\n[ambience] ${filled} fetched, ${skipped} already present, ${rebuildManifest()} cues playable.`,
  );
}
if (missing.length) {
  console.log(`\n[ambience] no file for: ${missing.join(", ")}`);
  console.log("[ambience] try --skip 1, a FREESOUND_API_KEY, or pin a URL in");
  console.log("[ambience] data/ambience-sources.json (see docs/configuration.md).");
}
