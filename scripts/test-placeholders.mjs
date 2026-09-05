// Every path src/lib/placeholders.ts can return must be a file that exists,
// every file that ships must be one some resolver can return, and the whole
// set must fit the byte budget the client apps carry it under.
//
// The resolver is a table of constants rather than a manifest lookup, which is
// the right call for a render path but means the table can drift from what
// scripts/generate-placeholders.mjs actually rendered. This walks the whole
// input space - every race, class, gender, genre, role, map cue and creature
// type the app can hold, plus all 576 bestiary entries at their real cr - and
// asserts the answer resolves. A missing plate is a broken image in front of
// a player, so it fails the build rather than warning. The reverse check
// catches the other drift: a plate rendered for a slot nothing draws is dead
// weight in every APK.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const R = await import("../src/lib/placeholders.ts");
const { CREATURE_TYPES } = await import("../src/lib/bestiary/statblock.ts");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const SET_DIR = path.join(PUBLIC, "assets", "placeholders");

// The whole set rides inside the desktop app and the Android APK. These are
// ceilings, not targets: generate-placeholders.mjs encodes at 256px squares
// and 704px landscapes at quality 70, which lands well under both.
const BUDGET_TOTAL_BYTES = 3.5 * 1024 * 1024;
const BUDGET_FILE_BYTES = 48 * 1024;

const failures = [];
const reached = new Set();
let checked = 0;

function check(url, label) {
  checked += 1;
  reached.add(url);
  const file = path.join(PUBLIC, url.replace(/^\//, ""));
  if (!existsSync(file)) {
    failures.push(`${label} -> ${url}`);
  }
}

const GENDER_INPUTS = ["", "male", "female", "nonbinary", "she/her", "he/him", "Agender", "?"];
const GENRES = [
  "high_fantasy", "dark_fantasy", "mystery", "horror",
  "cyberpunk", "steampunk", "post_apocalyptic", "custom", "",
];

const races = JSON.parse(readFileSync(path.join(ROOT, "src/lib/srd/races.json"), "utf8")).races;
const srdClasses = JSON.parse(readFileSync(path.join(ROOT, "src/lib/srd/classes.json"), "utf8")).classes;
const genreClasses = [];
for (const file of ["cyberpunk", "steampunk", "horror", "mystery", "post-apocalyptic", "dark-fantasy"]) {
  const data = JSON.parse(readFileSync(path.join(ROOT, `src/lib/classes/${file}.json`), "utf8"));
  genreClasses.push(...data.classes.map((entry) => entry.id));
}

// Characters: every race x gender, every class x gender, and the bare
// fallbacks with nothing known at all.
for (const gender of GENDER_INPUTS) {
  for (const race of races) {
    check(R.characterPlaceholder({ race: race.id, gender }), `race ${race.id}/${gender}`);
  }
  for (const klass of [...srdClasses.map((entry) => entry.id), ...genreClasses]) {
    check(R.characterPlaceholder({ class: klass, gender }), `class ${klass}/${gender}`);
  }
  for (const genre of GENRES) {
    check(R.characterPlaceholder({ genre, gender }), `genre lead ${genre}/${gender}`);
    check(R.characterPlaceholder({ gender }), `bare ${gender}`);
  }
  // An unknown race or class must still land somewhere real.
  check(R.characterPlaceholder({ race: "spacefolk", class: "chronomancer", gender }), `unknown/${gender}`);
  // Every race in every genre: the wasteland's half-orc is its mutant lead.
  for (const genre of GENRES) {
    for (const race of races) {
      check(R.characterPlaceholder({ race: race.id, genre, gender }), `race ${race.id}/${genre}/${gender}`);
    }
  }
  const mutant = R.characterPlaceholder({ race: "half_orc", genre: "post_apocalyptic", gender });
  if (!mutant.includes("post-apocalyptic-mutant")) {
    failures.push(`a wasteland half-orc drew ${mutant}, not the mutant lead`);
  }
}

// Monsters: every creature type, the swarm alias, junk, and the boss band,
// in every genre, under a spread of seeds so both plates of a two-plate
// type get drawn.
for (const type of [...CREATURE_TYPES, "swarm", "Humanoid (goblinoid)", "", "nonsense"]) {
  check(R.monsterPlaceholder(type), `monster ${type}`);
  for (const genre of GENRES) {
    check(R.monsterPlaceholder(type, { cr: 20, genre }), `boss ${genre}`);
    for (const seed of ["", "a", "b", "c", "d", "e", "f"]) {
      check(R.monsterPlaceholder(type, { cr: 1, genre, seed }), `mook ${genre}/${type}/${seed}`);
    }
  }
}

// Every bestiary entry the app ships, at its real cr and genre.
for (const file of ["high-fantasy", "dark-fantasy", "cyberpunk", "horror", "mystery", "post-apocalyptic", "steampunk"]) {
  const entries = JSON.parse(readFileSync(path.join(ROOT, `src/lib/bestiary/${file}.json`), "utf8")).entries;
  for (const entry of entries) {
    check(
      R.monsterPlaceholder(entry.type, { cr: entry.cr, genre: file, seed: entry.slug }),
      `${file}/${entry.slug}`,
    );
  }
}

for (const genre of GENRES) {
  for (const seed of ["", "abc", "a-campaign-id", "zzzz"]) {
    check(R.campaignPlaceholder(genre, seed), `cover ${genre}/${seed}`);
  }
}

for (const room of ["workshop", "maps", "cast", "bestiary", "encounters", "lore", "storyboard", "tables", "rulesets", "", "nope"]) {
  check(R.workshopPlaceholder(room), `workshop ${room}`);
}

for (const tile of ["party", "quest", "faction", "treasure", "chapter", "session", "journey", "empty", "nope"]) {
  check(R.miscPlaceholder(tile), `misc ${tile}`);
}

// Enough seeds that every one of the eight sigils comes up.
for (const seed of ["", "zzz", "éè", ...Array.from({ length: 40 }, (_, index) => `user-${index}`)]) {
  check(R.avatarPlaceholder(seed), `avatar ${seed}`);
}

for (const role of ["merchant", "guard", "cyberpunk-fixer", "mystery-informant", "", "nope", "Street Doc"]) {
  check(R.npcPlaceholder(role), `npc ${role}`);
  check(R.npcPlaceholder(role, "Marla Venn"), `npc ${role} seeded`);
}

// Every role the cast editor's picker offers, in every genre, has a plate,
// and the twelve hashed fallbacks all resolve.
for (const genre of GENRES) {
  for (const role of R.npcRoleOptions(genre)) {
    check(R.npcPlaceholder(role.id), `role option ${genre}/${role.id}`);
    if (!R.npcRoleLabel(role.id)) {
      failures.push(`role option ${role.id} has no label`);
    }
  }
}
for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p"]) {
  check(R.npcPlaceholder("", seed), `npc hashed ${seed}`);
}

// Maps: every setting resolves from its own name, in the genre that owns it,
// and free text that matches nothing still lands on a real file. Each map
// id is spelled as a person would name the place, which is what the cue
// table has to recognise for the plate to ever be drawn.
const MAP_NAMES = {
  "": [
    "dungeon", "cavern", "crypt", "sewer", "castle hall", "throne room", "temple",
    "library", "tavern", "market", "village", "city gate", "forest", "deep forest",
    "swamp", "desert", "tundra", "mountain pass", "coast", "ship deck", "ruins",
    "arena", "laboratory", "wasteland",
  ],
  cyberpunk: ["neon alley", "arcology", "server farm", "undercity"],
  steampunk: ["factory", "airship dock", "clockwork vault", "gaslit street"],
  post_apocalyptic: ["overpass", "scrap market", "shelter", "dead highway"],
  horror: ["manor", "asylum", "crypt chapel", "graveyard"],
  mystery: ["precinct", "parlour", "back alley", "morgue"],
};
for (const [genre, names] of Object.entries(MAP_NAMES)) {
  for (const name of names) {
    const url = R.mapPlaceholder({ name, genre });
    check(url, `map ${genre || "fantasy"}/${name}`);
    const expected = `${genre ? `${genre.replace(/_/g, "-")}-` : ""}${name.replace(/\s+/g, "-")}`;
    if (!url.endsWith(`/${expected}.webp`)) {
      failures.push(`map ${genre || "fantasy"}/${name} drew ${url}, expected ${expected}`);
    }
  }
}
for (const genre of GENRES) {
  for (const name of ["The Gilded Nothing", "", "Xyzzy"]) {
    check(R.mapPlaceholder({ name, genre }, "loc-1"), `map fallback ${genre}/${name}`);
  }
  check(
    R.mapPlaceholder({ name: "A room", description: "A vaulted crypt of old kings", genre }),
    `map by description ${genre}`,
  );
}

// The reverse check: every plate on disk is one of the answers above.
const shipped = [];
for (const group of readdirSync(SET_DIR, { withFileTypes: true })) {
  if (!group.isDirectory()) {
    continue;
  }
  for (const file of readdirSync(path.join(SET_DIR, group.name))) {
    if (file.endsWith(".webp")) {
      shipped.push(`/assets/placeholders/${group.name}/${file}`);
    }
  }
}
for (const url of shipped) {
  if (!reached.has(url)) {
    failures.push(`shipped but no resolver ever draws it: ${url}`);
  }
}

// The byte budget the client apps carry the set under.
let totalBytes = 0;
for (const url of shipped) {
  const size = statSync(path.join(PUBLIC, url.replace(/^\//, ""))).size;
  totalBytes += size;
  if (size > BUDGET_FILE_BYTES) {
    failures.push(`${url} is ${(size / 1024).toFixed(0)} KB, over the ${BUDGET_FILE_BYTES / 1024} KB ceiling`);
  }
}
if (totalBytes > BUDGET_TOTAL_BYTES) {
  failures.push(
    `the set is ${(totalBytes / 1024 / 1024).toFixed(2)} MB, over the ${(BUDGET_TOTAL_BYTES / 1024 / 1024).toFixed(1)} MB ceiling`,
  );
}

if (failures.length) {
  console.error(`test-placeholders: ${failures.length} of ${checked} resolved to a missing file`);
  for (const line of failures.slice(0, 25)) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

console.log(
  `test-placeholders: ${checked} passed, ${shipped.length} plates all reachable, ${(totalBytes / 1024 / 1024).toFixed(2)} MB shipped`,
);
