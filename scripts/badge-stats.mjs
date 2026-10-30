// The README's download and pull counts, written as shields.io endpoint
// badges (https://shields.io/badges/endpoint-badge) by the Badge stats
// workflow. shields' own github/downloads badge pages through every release
// on each request, and with 70-odd server releases and 80-odd app releases of
// two dozen files each it timed out and drew an empty badge. The Docker pull
// badge counted only the image's name from before the rename. Here each count
// is summed once, with every page and both image names, and the badge reads
// the result.
//
//   node scripts/badge-stats.mjs <out dir>      (GITHUB_TOKEN raises the API limit)
//
// A source that cannot be read keeps the count already in <out dir>, so one
// failed request never blanks a badge.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OWNER = "Lebbitheplow";
const SERVER_REPO = "open-game-master";
const APP_REPO = "open-game-master-client";
const IMAGES = ["lebbi/open-game-master", "lebbi/open-dungeon-master"];

const out = path.resolve(process.argv[2] || "badges");
mkdirSync(out, { recursive: true });

const headers = { Accept: "application/vnd.github+json", "User-Agent": "open-game-master-badge-stats" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function json(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

// Every asset of every release, drafts and prereleases included, since a
// beta's downloads are downloads too.
async function releaseDownloads(repo) {
  let total = 0;
  for (let page = 1; ; page += 1) {
    const releases = await json(`https://api.github.com/repos/${OWNER}/${repo}/releases?per_page=100&page=${page}`, { headers });
    for (const release of releases) {
      for (const asset of release.assets ?? []) total += Number(asset.download_count) || 0;
    }
    if (releases.length < 100) return total;
  }
}

async function dockerPulls() {
  let total = 0;
  for (const image of IMAGES) {
    const repo = await json(`https://hub.docker.com/v2/repositories/${image}/`, { headers: { "User-Agent": headers["User-Agent"] } });
    total += Number(repo.pull_count) || 0;
  }
  return total;
}

// shields' own short form: 776, 9.6k, 1.2M.
export function metric(count) {
  if (count < 1_000) return String(count);
  const [divisor, suffix] = count < 1_000_000 ? [1_000, "k"] : [1_000_000, "M"];
  const short = count / divisor;
  return `${short < 10 ? short.toFixed(1).replace(/\.0$/, "") : Math.round(short)}${suffix}`;
}

function write(file, label, logo, count) {
  const badge = { schemaVersion: 1, label, message: metric(count), color: "d4ab3a", labelColor: "151229", namedLogo: logo, logoColor: "d4ab3a", style: "flat-square" };
  writeFileSync(path.join(out, file), `${JSON.stringify(badge, null, 2)}\n`);
}

const badges = [
  { file: "server-downloads.json", label: "server downloads", logo: "github", count: () => releaseDownloads(SERVER_REPO) },
  { file: "app-downloads.json", label: "app downloads", logo: "github", count: () => releaseDownloads(APP_REPO) },
  { file: "docker-pulls.json", label: "docker pulls", logo: "docker", count: dockerPulls },
];

let failed = 0;
for (const badge of badges) {
  try {
    const count = await badge.count();
    write(badge.file, badge.label, badge.logo, count);
    console.log(`${badge.file}: ${count}`);
  } catch (error) {
    failed += 1;
    let kept = "nothing yet";
    try {
      kept = JSON.parse(readFileSync(path.join(out, badge.file), "utf8")).message;
    } catch {
      // No earlier count: the badge stays as it was until a run reads one.
    }
    console.warn(`${badge.file}: kept ${kept} (${error.message})`);
  }
}
process.exitCode = failed === badges.length ? 1 : 0;
