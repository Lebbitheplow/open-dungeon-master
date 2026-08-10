// Validate a directory of world pack manifests.
//
//   node scripts/validate-world-packs.mjs [dir]
//
// Defaults to data/worlds (the installed packs on this server). Point it at a
// staging directory to check packs before publishing them.
//
// This is the author-facing tool. scripts/test-world-packs.mjs runs the same
// checks against the bundled directory as part of the test suite; this one
// takes a path so third-party packs, which are never committed here, can be
// checked without being installed first.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { worldPackSchema, groupByFranchise, summarizePack } = await import(
  "../src/lib/worlds/types.ts"
);
const { GENRES } = await import("../src/lib/schemas/game-settings.ts");
const { findRace, findClass, SRD_BACKGROUNDS } = await import("../src/lib/srd/index.ts");
const { CUSTOM_BACKGROUNDS } = await import("../src/lib/backgrounds/index.ts");
const { SRD_WEAPONS } = await import("../src/lib/srd/weapons.ts");
const { SRD_ARMOR } = await import("../src/lib/srd/armor.ts");

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(process.argv[2] ?? path.join(scriptsDir, "..", "data", "worlds"));
const contentDbPath = path.resolve(scriptsDir, "../data/content/open5e.sqlite");

if (!fs.existsSync(target)) {
  console.error(`No such directory: ${target}`);
  process.exit(1);
}

const problems = [];
function check(file, condition, message) {
  if (!condition) {
    problems.push(`${file}: ${message}`);
  }
}

// index.json is the registry listing written by build-world-registry.mjs, not
// a pack. A staging folder holds both, so skip it the same way the builder does.
const files = fs
  .readdirSync(target)
  .filter((file) => file.endsWith(".json") && file !== "index.json")
  .sort();
const packs = [];
for (const file of files) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(target, file), "utf8"));
  } catch (error) {
    problems.push(`${file}: not valid JSON (${error.message})`);
    continue;
  }
  const parsed = worldPackSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${file}: ${issue.path.join(".") || "(root)"} ${issue.message}`);
    }
    continue;
  }
  packs.push({ file, pack: parsed.data });
}

const seenIds = new Set();
const seenNames = new Set();
const backgroundIds = new Set([
  ...SRD_BACKGROUNDS.map((entry) => entry.id),
  ...CUSTOM_BACKGROUNDS.map((entry) => entry.id),
]);

for (const { file, pack } of packs) {
  check(file, pack.id === path.basename(file, ".json"), `id "${pack.id}" does not match the filename`);
  check(file, !seenIds.has(pack.id), `duplicate pack id ${pack.id}`);
  check(file, !seenNames.has(pack.name), `duplicate pack name ${pack.name}`);
  seenIds.add(pack.id);
  seenNames.add(pack.name);

  check(file, GENRES.includes(pack.baseGenre), `unknown baseGenre ${pack.baseGenre}`);
  check(file, pack.baseGenre !== "custom", "baseGenre must not be custom");
  check(file, pack.theme.length <= 120, "theme is longer than 120 chars");
  check(file, pack.premise.length <= 500, "premise is longer than 500 chars");
  check(file, pack.dmFlavor.length >= 200, "dmFlavor is too thin to steer the DM");

  for (const entry of pack.races) {
    check(file, Boolean(findRace(entry.id)), `race id ${entry.id} does not exist`);
  }
  for (const entry of pack.classes) {
    const klass = findClass(entry.id);
    check(file, Boolean(klass), `class id ${entry.id} does not exist`);
    if (klass && klass.spellAbility === null) {
      check(file, entry.castingLabel === null, `${entry.id} is not a caster but sets castingLabel`);
    }
  }
  for (const entry of pack.backgrounds) {
    check(file, backgroundIds.has(entry.id), `background id ${entry.id} does not exist`);
  }
  for (const raceId of pack.companionRaces) {
    check(file, Boolean(findRace(raceId)), `companionRaces entry ${raceId} does not exist`);
  }

  for (const key of ["races", "classes", "backgrounds"]) {
    const names = new Set();
    const ids = new Set();
    for (const entry of pack[key]) {
      check(file, entry.name.toLowerCase() !== entry.id.toLowerCase(), `${key} ${entry.id} renames to its own id`);
      check(file, !names.has(entry.name.toLowerCase()), `duplicate ${key} name ${entry.name}`);
      // A repeated id is silent data loss: applyIdReskins builds a Map, so the
      // last entry wins and the earlier reskin never renders.
      check(file, !ids.has(entry.id), `duplicate ${key} id ${entry.id}, so one of the reskins is dead`);
      names.add(entry.name.toLowerCase());
      ids.add(entry.id);
    }
  }
  for (const key of ["spells", "items", "features"]) {
    const names = new Set();
    const sources = new Set();
    for (const entry of pack[key]) {
      check(file, entry.name.toLowerCase() !== entry.from.toLowerCase(), `${key} "${entry.from}" renames to itself`);
      check(file, !names.has(entry.name.toLowerCase()), `duplicate ${key} name ${entry.name}`);
      check(file, !sources.has(entry.from.toLowerCase()), `two ${key} reskins map "${entry.from}"`);
      names.add(entry.name.toLowerCase());
      sources.add(entry.from.toLowerCase());
    }
  }
  const slugs = pack.monsters.map((entry) => entry.slug);
  check(file, new Set(slugs).size === slugs.length, "duplicate monster slugs");

  const codes = new Set(["LG", "NG", "CG", "LN", "N", "CN", "LE", "NE", "CE"]);
  for (const code of pack.alignments) {
    check(file, codes.has(code), `unknown alignment code ${code}`);
  }

  const walk = (value, trail = "") => {
    if (typeof value === "string") {
      check(file, !value.includes("—"), `em dash in ${trail}`);
    } else if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${trail}[${index}]`));
    } else if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        walk(entry, trail ? `${trail}.${key}` : key);
      }
    }
  };
  walk(pack);

  const floors = {
    races: 6, classes: 6, backgrounds: 4, monsters: 15, spells: 10,
    items: 6, factions: 3, locations: 4, hooks: 4, glossary: 6,
  };
  for (const [key, floor] of Object.entries(floors)) {
    check(file, pack[key].length >= floor, `only ${pack[key].length} ${key}, needs ${floor}`);
  }
  check(file, pack.nameSeeds.people.length >= 6, "needs at least 6 people name seeds");
  check(file, pack.nameSeeds.places.length >= 6, "needs at least 6 place name seeds");
}

for (const group of groupByFranchise(packs.map(({ pack }) => summarizePack(pack)))) {
  if (group.editions.length < 2) {
    continue;
  }
  const labels = group.editions.map((entry) => entry.edition);
  for (const edition of group.editions) {
    check(`${edition.id}.json`, edition.edition.trim().length > 0, `${group.franchise} has several entries, so each needs an edition label`);
  }
  check(group.franchise, new Set(labels).size === labels.length, `duplicate edition labels: ${labels.join(", ")}`);
}

if (fs.existsSync(contentDbPath)) {
  const { default: Database } = await import("better-sqlite3-multiple-ciphers");
  const db = new Database(contentDbPath, { readonly: true });
  const crBySlug = new Map(db.prepare("SELECT slug, cr FROM monsters").all().map((r) => [r.slug, r.cr]));
  const spellNames = new Set(db.prepare("SELECT name FROM spells").all().map((r) => r.name.toLowerCase()));
  const itemNames = new Set(db.prepare("SELECT name FROM items").all().map((r) => r.name.toLowerCase()));
  db.close();
  for (const weapon of SRD_WEAPONS) itemNames.add(weapon.name.toLowerCase());
  for (const armor of SRD_ARMOR) itemNames.add(armor.name.toLowerCase());

  for (const { file, pack } of packs) {
    for (const entry of pack.monsters) {
      if (!crBySlug.has(entry.slug)) {
        problems.push(`${file}: monster slug "${entry.slug}" is not in the content pack`);
      } else if (crBySlug.get(entry.slug) !== entry.cr) {
        problems.push(`${file}: ${entry.slug} cr is ${entry.cr}, content pack says ${crBySlug.get(entry.slug)}`);
      }
    }
    for (const entry of pack.spells) {
      check(file, spellNames.has(entry.from.toLowerCase()), `spell "${entry.from}" is not a real spell name`);
    }
    for (const entry of pack.items) {
      check(file, itemNames.has(entry.from.toLowerCase()), `item "${entry.from}" is not a real item name`);
    }
  }
} else {
  console.log("note: content pack absent; skipping monster, spell and item integrity checks");
}

console.log(`Checked ${packs.length} pack(s) in ${target}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  process.exit(1);
}
console.log("All packs valid.");
assert.ok(true);
