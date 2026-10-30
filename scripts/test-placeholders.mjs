// Every path src/lib/placeholders.ts can return must be a file that exists,
// every file that ships must be one some resolver can return, and the whole
// set must fit the byte budget the client apps carry it under.
//
// The resolver is a table of constants rather than a manifest lookup, which is
// the right call for a render path but means the table can drift from what
// scripts/generate-placeholders.mjs actually rendered. This walks the whole
// input space - every race, class, gender, genre, role, scene kind and creature
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
// ceilings, not targets. Every plate ships at the size the UI draws
// (scripts/generate-placeholders.mjs: 256 px squares, scenes no wider than
// 704 px, quality 70): the 512 px creature plates and 1000 px scenes that
// arrived with the majority-vote batches were downsized on 2026-10-12, which
// took the set from 27.8 MiB to 9.8 MiB and the apps down with it. The
// painted creature plates now sit under the same 48 KiB ceiling as the
// race/class portraits (the largest is 26 KiB); scenes top out at 102 KiB.
// The total leaves room for another batch at these sizes, not for a return
// to the painted ones.
const BUDGET_TOTAL_BYTES = 12 * 1024 * 1024;
const BUDGET_FILE_BYTES = 48 * 1024;
const BUDGET_SCENE_FILE_BYTES = 128 * 1024;
const BUDGET_PAINTED_SQUARE_BYTES = 48 * 1024;

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

// The sheet's choices (src/lib/gender.ts), plus free text an old sheet may hold.
const GENDER_INPUTS = ["", "Female", "Male", "Nonbinary", "she/her", "?"];
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
  // The content pack's classes from other books (Marshal, Mechanist) have
  // three-gender plates like the genre classes (issue #116).
  for (const klass of [...srdClasses.map((entry) => entry.id), ...genreClasses, "marshal", "mechanist"]) {
    check(R.characterPlaceholder({ class: klass, gender }), `class ${klass}/${gender}`);
  }
  for (const genre of GENRES) {
    check(R.characterPlaceholder({ genre, gender }), `genre lead ${genre}/${gender}`);
    check(R.characterPlaceholder({ gender }), `bare ${gender}`);
  }
  // Pack races mapped by id (Tome of Heroes and the rest), so their plates
  // are reachable.
  for (const id of R.raceFamilyIds()) {
    check(R.characterPlaceholder({ race: id, gender }), `pack race ${id}/${gender}`);
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
  // A species with a face of its own keeps it in any class: the class plates
  // are painted human, and a minotaur fighter drew a human fighter (0.31.1
  // playtest). A near-human species still wears its class's plate.
  for (const [race, klass, plate] of [
    ["bhain-kwai", "fighter", "character-race/bhain-kwai-"],
    ["bhain-kwai", "paladin", "character-race/bhain-kwai-"],
    ["toh_minotaur", "barbarian", "character-race/minotaur-"],
    ["dragonborn", "wizard", "character-race/dragonborn-"],
    ["tortle", "monk", "character-race/tortle-"],
    ["human", "fighter", "character-class/fighter-"],
    ["high_elf", "wizard", "character-class/wizard-"],
    ["hill_dwarf", "cleric", "character-class/cleric-"],
  ]) {
    const drawn = R.characterPlaceholder({ race, class: klass, gender });
    check(drawn, `${race} ${klass}/${gender}`);
    if (!drawn.includes(plate)) {
      failures.push(`a ${race} ${klass} drew ${drawn}, not ${plate}*`);
    }
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
      R.monsterPlaceholder(entry.type, { cr: entry.cr, genre: file, seed: entry.slug, slug: entry.slug, name: entry.name }),
      `${file}/${entry.slug}`,
    );
    // The bare type answer (a caller with no slug) still resolves too.
    check(R.monsterPlaceholder(entry.type, { cr: entry.cr, genre: file, seed: entry.slug }), `${file}/${entry.slug} by type`);
  }
}

// Creature families: every family key and alias, by slug and by its own SRD
// name, in every genre, at a mook's cr and a boss's. This is what makes each
// painted family plate reachable for the reverse check below; three of them
// (animated-armor, brown-bear, rust-monster) are in no fantasy bestiary and
// are only met through the content pack or a homebrew name.
const titleCase = (key) => key.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
for (const [key, plate] of Object.entries(R.MONSTER_FAMILIES)) {
  if (!existsSync(path.join(SET_DIR, "monster", `${plate}.webp`))) {
    failures.push(`MONSTER_FAMILIES ${key} -> ${plate} has no plate on disk`);
  }
  for (const genre of GENRES) {
    for (const cr of [1, 20]) {
      check(R.monsterPlaceholder("monstrosity", { cr, genre, slug: key, name: titleCase(key) }), `family ${key}/${genre}/${cr}`);
      check(R.monsterPlaceholder("monstrosity", { cr, genre, name: titleCase(key) }), `family by name ${key}/${genre}/${cr}`);
    }
  }
}

// The lookup order, case by case.
const expectPlate = (label, url, plate) => {
  checked += 1;
  if (!url.endsWith(`/monster/${plate}.webp`)) {
    failures.push(`${label} drew ${url}, expected monster/${plate}`);
  }
};
// Family hit: an owlbear is an owlbear, not a monstrosity.
expectPlate("family hit", R.monsterPlaceholder("monstrosity", { cr: 3, genre: "high_fantasy", slug: "owlbear", name: "Owlbear" }), "owlbear");
// Family hit from the name alone (a homebrew monster with no slug), numbered
// the way an encounter numbers a run.
expectPlate("family by name", R.monsterPlaceholder("undead", { cr: 1, genre: "high_fantasy", name: "Ghoul 2" }), "ghoul");
// Alias hit: a ghast shares the ghoul's plate, a polar bear the brown bear's.
expectPlate("alias ghast", R.monsterPlaceholder("undead", { cr: 2, genre: "high_fantasy", slug: "ghast", name: "Ghast" }), "ghoul");
expectPlate("alias polar bear", R.monsterPlaceholder("beast", { cr: 2, genre: "", slug: "polar-bear", name: "Polar Bear" }), "brown-bear");
// The lich (CR 21) beats the boss override, in fantasy and dark fantasy.
expectPlate("lich over boss", R.monsterPlaceholder("undead", { cr: 21, genre: "high_fantasy", slug: "lich", name: "Lich" }), "lich");
expectPlate("dark-fantasy lich", R.monsterPlaceholder("undead", { cr: 21, genre: "dark_fantasy", slug: "lich", name: "The Hollow Saint" }), "lich");
// ...but a CR 21 with no family is still the boss.
expectPlate("boss without family", R.monsterPlaceholder("undead", { cr: 21, genre: "high_fantasy", slug: "dracolich", name: "Dracolich" }), "high-fantasy-boss");
// Reskin guard: a cyberpunk Sump Rat fights as a giant-rat but is not a
// fantasy rat; it keeps the type plate. Likewise the reskinned lich keeps the
// cyberpunk boss, and a horror werewolf called The Good Doctor gives nothing
// away.
expectPlate("cyberpunk sump rat", R.monsterPlaceholder("beast", { cr: 0.125, genre: "cyberpunk", seed: "giant-rat", slug: "giant-rat", name: "Sump Rat" }), "beast");
// (The wasteland's Rad-Rat is no longer a type plate: it is a four-legged
// predator now, below with the genre tokens.)
expectPlate("wasteland rad-rat", R.monsterPlaceholder("beast", { cr: 0.125, genre: "post_apocalyptic", seed: "giant-rat", slug: "giant-rat", name: "Rad-Rat" }), "post-apocalyptic-predator");
expectPlate("cyberpunk reskinned lich", R.monsterPlaceholder("undead", { cr: 21, genre: "cyberpunk", slug: "lich", name: "The Uploaded Founder" }), "cyberpunk-boss");
const goodDoctor = R.monsterPlaceholder("humanoid", { cr: 3, genre: "horror", slug: "werewolf", name: "The Good Doctor" });
if (goodDoctor.includes("/werewolf.")) {
  failures.push(`horror's The Good Doctor drew ${goodDoctor}, giving the werewolf away`);
}
// ...while the SRD creature under its own name still draws its plate there.
expectPlate("cyberpunk plain troll", R.monsterPlaceholder("giant", { cr: 5, genre: "cyberpunk", slug: "troll", name: "Troll 1" }), "troll");
// Unknown creature: falls back to its type.
expectPlate("unknown creature", R.monsterPlaceholder("beast", { cr: 1, genre: "high_fantasy", slug: "axe-beak", name: "Axe Beak" }), "beast");
expectPlate("custom enemy", R.monsterPlaceholder("humanoid", { cr: 1, genre: "high_fantasy", slug: "custom", name: "Bandit Captain's Second" }), "humanoid");
// A family word inside a longer name is not the family.
expectPlate("name containing a family", R.monsterPlaceholder("humanoid", { cr: 1, genre: "high_fantasy", name: "Troll Hunter" }), "humanoid");

// The second batch. A dragon of any age shares its colour's young plate,
// and an ancient one (CR 23) beats the boss override like the lich does.
expectPlate("ancient black dragon", R.monsterPlaceholder("dragon", { cr: 21, genre: "high_fantasy", slug: "ancient-black-dragon", name: "Ancient Black Dragon" }), "young-black-dragon");
expectPlate("silver wyrmling", R.monsterPlaceholder("dragon", { cr: 2, genre: "high_fantasy", slug: "silver-dragon-wyrmling", name: "Silver Dragon Wyrmling" }), "young-silver-dragon");
// Green and red keep the plates they already had.
expectPlate("young green dragon", R.monsterPlaceholder("dragon", { cr: 8, genre: "high_fantasy", slug: "young-green-dragon", name: "Young Green Dragon" }), "dragon");
expectPlate("swarm of wasps", R.monsterPlaceholder("beast", { cr: 0.5, genre: "high_fantasy", slug: "swarm-of-wasps", name: "Swarm of Wasps" }), "swarm-of-insects");
expectPlate("reef shark", R.monsterPlaceholder("beast", { cr: 0.5, genre: "", slug: "reef-shark", name: "Reef Shark" }), "giant-shark");
expectPlate("will-o'-wisp by name", R.monsterPlaceholder("undead", { cr: 2, genre: "high_fantasy", name: "Will-o'-Wisp 2" }), "will-o-wisp");
expectPlate("hydra", R.monsterPlaceholder("monstrosity", { cr: 8, genre: "dark_fantasy", slug: "hydra", name: "The Marsh Mother" }), "hydra");
// Enemy NPC roles, from the stat block and from the name.
for (const [slug, plate] of [
  ["bandit", "bandit"], ["bandit-captain", "bandit"], ["thug", "executioner"],
  ["cultist", "cultist"], ["cult-fanatic", "cultist"], ["assassin", "assassin"], ["spy", "assassin"],
  ["knight", "dark-knight"], ["scout", "archer"], ["gladiator", "gladiator"], ["druid", "battle-shaman"],
  ["archmage", "tyrant"],
]) {
  expectPlate(`npc stat block ${slug}`, R.monsterPlaceholder("humanoid", { cr: 2, genre: "high_fantasy", slug, name: titleCase(slug) }), plate);
}
expectPlate("archmage over boss", R.monsterPlaceholder("humanoid", { cr: 12, genre: "high_fantasy", slug: "archmage", name: "Archmage" }), "tyrant");
for (const [name, plate] of [
  ["Necromancer", "necromancer"], ["Pirate Captain", "pirate"], ["Corsair 3", "pirate"], ["Houndmaster", "houndmaster"],
  ["Alchemist", "alchemical-saboteur"], ["Torturer", "executioner"], ["Death Knight", "dark-knight"],
]) {
  expectPlate(`npc name ${name}`, R.monsterPlaceholder("humanoid", { cr: 3, genre: "high_fantasy", slug: "custom", name }), plate);
}
// A mage or a veteran is not one of the roles; it keeps the humanoid plate.
expectPlate("mage stays humanoid", R.monsterPlaceholder("humanoid", { cr: 6, genre: "high_fantasy", slug: "mage", name: "Mage" }), "humanoid");
expectPlate("veteran stays humanoid", R.monsterPlaceholder("humanoid", { cr: 3, genre: "high_fantasy", slug: "veteran", name: "Veteran" }), "humanoid");
// The reskin guard covers the new entries: a cyberpunk bandit called a
// ganger and a cyberpunk archmage called something else keep the genre's
// plates, while a plain "Bandit" there is still a bandit.
for (const genre of ["cyberpunk", "steampunk", "post_apocalyptic", "horror", "mystery"]) {
  const ganger = R.monsterPlaceholder("humanoid", { cr: 0.125, genre, slug: "bandit", name: "Chrome Ganger" });
  const boss = R.monsterPlaceholder("humanoid", { cr: 12, genre, slug: "archmage", name: "The Chairman" });
  const hydra = R.monsterPlaceholder("monstrosity", { cr: 8, genre, slug: "hydra", name: "The Many-Mouthed" });
  for (const [label, url] of [["bandit", ganger], ["archmage", boss], ["hydra", hydra]]) {
    if (/\/monster\/(bandit|tyrant|hydra)\.webp$/.test(url)) {
      failures.push(`${genre} reskinned ${label} drew the fantasy plate ${url}`);
    }
  }
}
// Cyberpunk's Arena Champion fights as a gladiator; the fantasy arena plate
// is not its picture.
if (R.monsterPlaceholder("humanoid", { cr: 5, genre: "cyberpunk", slug: "gladiator", name: "Arena Champion" }).endsWith("/gladiator.webp")) {
  failures.push("cyberpunk Arena Champion drew the fantasy gladiator");
}
// A plain "Bandit" in cyberpunk is the genre's ganger (below), not the
// fantasy roadside bandit; a plain "Troll" there has no genre token and is
// still the troll.
expectPlate("cyberpunk plain bandit", R.monsterPlaceholder("humanoid", { cr: 0.125, genre: "cyberpunk", slug: "bandit", name: "Bandit 2" }), "cyberpunk-gang");

// Codex's additions are deliberately name-only: do not turn every imp into
// a microdrone, every spider into a clockwork machine, or every undead into
// a galvanic corpse merely because its underlying stats match.
expectPlate("cyberpunk Spy Microdrone", R.monsterPlaceholder("fiend", { genre: "cyberpunk", slug: "imp", name: "Spy Microdrone 2" }), "cyberpunk-microdrone");
expectPlate("steampunk Galvanic Revenant", R.monsterPlaceholder("undead", { genre: "steampunk", slug: "zombie", name: "Galvanic Revenant" }), "steampunk-galvanic-corpse");
for (const [genre, slug, name, unwanted] of [
  ["cyberpunk", "imp", "Imp", "cyberpunk-microdrone"],
  ["steampunk", "giant-spider", "Cable Spinner", "steampunk-clockwork-spider"],
  ["steampunk", "zombie", "Zombie", "steampunk-galvanic-corpse"],
  ["steampunk", "ghost", "The Lady of the Gallery", "steampunk-galvanic-corpse"],
  ["cyberpunk", "hydra", "Self-Repair Swarm Core", "steampunk-repair-swarm"],
  ["cyberpunk", "custom", "Walking Turret Operator", "cyberpunk-walking-turret"],
]) {
  if (R.monsterPlaceholder("construct", { genre, slug, name }).endsWith(`/${unwanted}.webp`)) {
    failures.push(`unrelated ${genre}/${name} drew ${unwanted}`);
  }
}

// Genre enemy tokens. Every name in a genre's table draws its token there,
// numbered like an encounter numbers a run and with or without "The"; the
// same name in every other genre never draws it; and every stat block the
// table maps draws it in its genre under a name the table does not know.
const genreOfSlug = (genre) => genre.replace(/-/g, "_");
for (const [genre, table] of Object.entries(R.GENRE_ENEMY_TOKENS)) {
  for (const [plate, names] of Object.entries(table.names)) {
    if (!plate.startsWith(`${genre}-`)) {
      failures.push(`genre token ${plate} is filed under ${genre}`);
    }
    if (!existsSync(path.join(SET_DIR, "monster", `${plate}.webp`))) {
      failures.push(`genre token ${plate} has no plate on disk`);
    }
    for (const name of names) {
      for (const variant of [name, `${name} 2`, name.startsWith("The ") ? name.slice(4) : `The ${name}`]) {
        for (const cr of [1, 20]) {
          const url = R.monsterPlaceholder("humanoid", { cr, genre: genreOfSlug(genre), slug: "custom", name: variant });
          check(url, `genre token ${genre}/${variant}`);
          expectPlate(`genre token ${genre}/${variant}/${cr}`, url, plate);
        }
      }
      for (const other of GENRES.filter((entry) => entry.replace(/_/g, "-") !== genre)) {
        const url = R.monsterPlaceholder("humanoid", { cr: 1, genre: other, slug: "custom", name });
        if (url.endsWith(`/${plate}.webp`)) {
          failures.push(`${genre} token ${plate} leaked into ${other || "no genre"} for ${name}`);
        }
      }
    }
  }
  for (const [slug, plate] of Object.entries(table.slugs)) {
    expectPlate(`genre slug ${genre}/${slug}`, R.monsterPlaceholder("beast", { cr: 1, genre: genreOfSlug(genre), slug, name: "Something Renamed" }), plate);
    for (const other of GENRES.filter((entry) => entry.replace(/_/g, "-") !== genre)) {
      const url = R.monsterPlaceholder("beast", { cr: 1, genre: other, slug, name: "Something Renamed" });
      if (url.endsWith(`/${plate}.webp`)) {
        failures.push(`${genre} token ${plate} leaked into ${other || "no genre"} by stat block ${slug}`);
      }
    }
  }
}
// Every bestiary entry, run in every genre: a genre token only ever shows in
// the genre whose bestiary it was painted for.
const tokenGenre = new Map();
for (const [genre, table] of Object.entries(R.GENRE_ENEMY_TOKENS)) {
  for (const plate of Object.keys(table.names)) {
    tokenGenre.set(plate, genre);
  }
}
for (const file of ["high-fantasy", "dark-fantasy", "cyberpunk", "horror", "mystery", "steampunk", "post-apocalyptic"]) {
  const entries = JSON.parse(readFileSync(path.join(ROOT, `src/lib/bestiary/${file}.json`), "utf8")).entries;
  for (const entry of entries) {
    for (const genre of GENRES) {
      const url = R.monsterPlaceholder(entry.type, { cr: entry.cr, genre, seed: entry.slug, slug: entry.slug, name: entry.name });
      const plate = url.split("/").pop().replace(/\.webp$/, "");
      const home = tokenGenre.get(plate);
      if (home && home !== genre.replace(/_/g, "-")) {
        failures.push(`${file}/${entry.slug} (${entry.name}) drew ${home}'s ${plate} in ${genre || "no genre"}`);
      }
    }
  }
}
// The cases the backlog called out, by their bestiary names.
for (const [genre, type, cr, slug, name, plate] of [
  ["post_apocalyptic", "beast", 0.25, "wolf", "Waste Hound", "post-apocalyptic-predator"],
  ["post_apocalyptic", "monstrosity", 1, "death-dog", "Two-Headed Coyote", "post-apocalyptic-predator"],
  ["post_apocalyptic", "beast", 1, "panther", "Glow Cat", "post-apocalyptic-predator"],
  ["post_apocalyptic", "monstrosity", 2, "ankheg", "Acid Burrower", "post-apocalyptic-burrower"],
  ["post_apocalyptic", "monstrosity", 5, "bulette", "Road Shark", "post-apocalyptic-burrower"],
  ["post_apocalyptic", "humanoid", 0.125, "bandit", "Road Raider", "post-apocalyptic-raider"],
  ["post_apocalyptic", "undead", 0.25, "zombie", "Rad-Feral", "post-apocalyptic-stalker"],
  ["post_apocalyptic", "plant", 5, "shambling-mound", "Compost Colossus", "post-apocalyptic-ambush-plant"],
  // A plain Giant Rat in the wasteland is the predator, not the fantasy rat.
  ["post_apocalyptic", "beast", 0.125, "giant-rat", "Giant Rat", "post-apocalyptic-predator"],
  ["steampunk", "fiend", 13, "rakshasa", "The Colonial Magnate", "steampunk-magnate"],
  ["steampunk", "undead", 21, "lich", "The Perpetual Chairman", "steampunk-magnate"],
  ["steampunk", "humanoid", 2, "bandit-captain", "Sky Pirate Captain", "steampunk-sky-pirate"],
  ["cyberpunk", "humanoid", 0.125, "guard", "Corpo Rent-a-Cop", "cyberpunk-corp-squad"],
  ["cyberpunk", "monstrosity", 3, "doppelganger", "Face-Dancer", "cyberpunk-synth"],
  ["mystery", "humanoid", 8, "assassin", "The Poisoner", "mystery-poisoner"],
  ["mystery", "humanoid", 0.125, "cultist", "Secret Society Member", "mystery-occult-enforcer"],
  ["mystery", "elemental", 6, "invisible-stalker", "The Unseen Burglar", "mystery-burglar"],
  ["horror", "humanoid", 0.125, "cultist", "Smiling Neighbor", "horror-possessed"],
  ["horror", "humanoid", 0, "commoner", "Possessed Villager", "horror-possessed"],
  ["dark_fantasy", "humanoid", 2, "berserker", "Flagellant Champion", "dark-fantasy-penitent"],
]) {
  expectPlate(`${genre} ${name}`, R.monsterPlaceholder(type, { cr, genre, slug, name }), plate);
}
// ...and the ones that stay put. A horror commoner is only possessed when the
// card says so; a horror cultist under another name is not; a magnate boss
// in steampunk does not reach the giants; a dark-fantasy cultist is still the
// fantasy cultist; the fantasy poisoner alias is the assassin outside mystery.
expectPlate("horror commoner", R.monsterPlaceholder("humanoid", { cr: 0, genre: "horror", slug: "commoner", name: "Farmhand" }), "humanoid");
expectPlate("horror cultist renamed", R.monsterPlaceholder("humanoid", { cr: 0.125, genre: "horror", slug: "cultist", name: "Hooded Figure" }), "humanoid");
expectPlate("steampunk ironmaster", R.monsterPlaceholder("giant", { cr: 9, genre: "steampunk", slug: "fire-giant", name: "The Ironmaster" }), "giant");
expectPlate("dark-fantasy cultist", R.monsterPlaceholder("humanoid", { cr: 0.125, genre: "dark_fantasy", slug: "cultist", name: "Cultist" }), "cultist");
expectPlate("fantasy poisoner", R.monsterPlaceholder("humanoid", { cr: 8, genre: "high_fantasy", slug: "assassin", name: "The Poisoner" }), "assassin");

for (const genre of GENRES) {
  for (const seed of ["", "abc", "a-campaign-id", "zzzz"]) {
    check(R.campaignPlaceholder(genre, seed), `cover ${genre}/${seed}`);
  }
}

for (const room of ["workshop", "maps", "cast", "bestiary", "encounters", "lore", "storyboard", "tables", "rulesets", "region", "party", "factions", "homebrew", "plugin", "share", "", "nope"]) {
  check(R.workshopPlaceholder(room), `workshop ${room}`);
  if (room && room !== "nope" && R.workshopPlaceholder(room) !== `/assets/placeholders/workshop/${room}.webp`) {
    failures.push(`workshop ${room} did not resolve to its dedicated plate`);
  }
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
// A kind of scene draws its plate whatever language the place is named in;
// a genre's own plate comes first, and a kind with several plates draws each
// for some place. No kind falls back to the genre's plates, or the journey.
const { cueIds } = await import("../src/lib/ambience/catalog.ts");
const SEEDS = Array.from({ length: 24 }, (_, index) => `loc-${index}`);
for (const genre of GENRES) {
  for (const scene of [...cueIds("bed"), null]) {
    for (const seed of SEEDS) {
      check(R.mapPlaceholder({ scene, genre }, seed), `map ${genre || "fantasy"}/${scene ?? "no kind"}`);
    }
  }
}
for (const [look, plate] of [
  [{ scene: "crypt", genre: "high_fantasy" }, "map/crypt"],
  [{ scene: "crypt", genre: "horror" }, "map/horror-crypt-chapel"],
  [{ scene: "town", genre: "mystery" }, "map/mystery-back-alley"],
  [{ scene: "plains", genre: "high_fantasy" }, "misc/journey"],
  [{ scene: null, genre: "" }, "misc/journey"],
]) {
  const url = R.mapPlaceholder(look, "loc-1");
  if (!url.endsWith(`/${plate}.webp`)) {
    failures.push(`map ${JSON.stringify(look)} drew ${url}, expected ${plate}`);
  }
}
if (!R.mapPlaceholder({ scene: null, genre: "cyberpunk" }, "loc-1").includes("/map/cyberpunk-")) {
  failures.push("a cyberpunk place with no kind should draw a cyberpunk plate");
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
  const group = url.split("/")[3];
  const ceiling = ["campaign", "map", "misc", "workshop"].includes(group)
    ? BUDGET_SCENE_FILE_BYTES
    : ["npc", "monster", "avatar", "character", "character-genre"].includes(group)
      ? BUDGET_PAINTED_SQUARE_BYTES
      : BUDGET_FILE_BYTES;
  if (size > ceiling) {
    failures.push(`${url} is ${(size / 1024).toFixed(0)} KB, over the ${ceiling / 1024} KB ceiling`);
  }
}
// The effect assets a feature ships under public/fx (stings, glyph sprites;
// docs/vtt-parity-implementation-plan.md 18.1) ride in the same payload,
// under their own ceiling. Absent is fine; over is not.
const FX_DIR = path.join(ROOT, "public", "fx");
// Raised from 1.5 MB for the painted effect flipbooks (docs/visual-overhaul-plan.md 2.3, 8b.3).
const FX_BUDGET_BYTES = 8 * 1024 * 1024;
const FX_STING_BYTES = 40 * 1024;
if (existsSync(FX_DIR)) {
  let fxBytes = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const size = statSync(full).size;
      fxBytes += size;
      if (/\.(ogg|opus|webm)$/i.test(entry.name) && size > FX_STING_BYTES) {
        failures.push(`${path.relative(ROOT, full)} is ${(size / 1024).toFixed(0)} KB, over the ${FX_STING_BYTES / 1024} KB sting ceiling`);
      }
    }
  };
  walk(FX_DIR);
  if (fxBytes > FX_BUDGET_BYTES) {
    failures.push(`public/fx is ${(fxBytes / 1024 / 1024).toFixed(2)} MB, over the ${FX_BUDGET_BYTES / 1024 / 1024} MB ceiling`);
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
