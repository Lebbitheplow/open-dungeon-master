// Which default plate a thing draws before anyone has painted it one.
//
// Every path here points at scripts/placeholder-set.mjs output under
// public/assets/placeholders. The rule throughout is most-specific-first: a
// character shows its class if we have one, else its race, else the genre it
// plays in, else a plain hooded adventurer. Nothing here touches the
// filesystem, so it runs on the server and the client alike;
// scripts/test-placeholders.mjs asserts that every path these functions can
// return is a file that actually exists.
//
// Deliberately not a lookup into manifest.json: the manifest is a build
// artifact for tooling, and a render path that can 404 because a JSON fetch
// lost a race is worse than a table of thirty constants.

import { normalizeCreatureType } from "@/lib/bestiary/creature-type";

const BASE = "/assets/placeholders";

// Stable per-key pick, so a face or a cover never reshuffles between renders.
function hash(value: string): number {
  let acc = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    acc ^= value.charCodeAt(index);
    acc = Math.imul(acc, 16777619);
  }
  return acc >>> 0;
}


// ---- gender ----

// The sheet's gender is one of the builder's choices (src/lib/gender.ts),
// compared as written rather than read as words, so it means the same at
// every table. "neutral" is a real answer rather than a failure: it is what
// an unspecified gender and a nonbinary one both correctly land on.
export type PlaceholderGender = "masculine" | "feminine" | "neutral";

export function normalizeGender(gender: string | null | undefined): PlaceholderGender {
  return gender === "Male" ? "masculine" : gender === "Female" ? "feminine" : "neutral";
}

// ---- races ----

// Subraces collapse to the family the silhouette can actually show: a hill
// dwarf and a mountain dwarf are the same outline. Keys are the SRD ids from
// src/lib/srd/races.json; values are plate ids.
const RACE_FAMILY: Record<string, string> = {
  hill_dwarf: "dwarf",
  mountain_dwarf: "dwarf",
  high_elf: "elf",
  wood_elf: "elf",
  drow: "drow",
  lightfoot_halfling: "halfling",
  stout_halfling: "halfling",
  human: "human",
  variant_human: "human",
  dragonborn: "dragonborn",
  rock_gnome: "gnome",
  forest_gnome: "gnome",
  deep_gnome: "deep-gnome",
  gnome_deep: "deep-gnome",
  svirfneblin: "deep-gnome",
  half_elf: "half-elf",
  half_orc: "half-orc",
  orc: "orc",
  tiefling: "tiefling",
  aasimar: "aasimar",
  goliath: "goliath",
  firbolg: "firbolg",
  tabaxi: "tabaxi",
  kenku: "kenku",
  tortle: "tortle",
  fire_genasi: "genasi-fire",
  genasi_fire: "genasi-fire",
  water_genasi: "genasi-water",
  genasi_water: "genasi-water",
  air_genasi: "genasi-air",
  genasi_air: "genasi-air",
  genasi: "genasi",
  earth_genasi: "genasi-earth",
  genasi_earth: "genasi-earth",
  changeling: "changeling",
  warforged: "warforged",
  goblin: "goblin",
  bugbear: "bugbear",
  lizardfolk: "lizardfolk",
  // Tome of Heroes (Kobold Press) via Open5e: v1 slugs and v2 "toh_" keys.
  alseid: "alseid",
  toh_alseid: "alseid",
  catfolk: "catfolk",
  toh_catfolk: "catfolk",
  malkin: "malkin",
  toh_malkin: "malkin",
  pantheran: "pantheran",
  toh_pantheran: "pantheran",
  derro: "derro",
  toh_derro: "derro",
  far_touched: "derro",
  toh_far_touched: "derro",
  mutated: "derro",
  toh_mutated: "derro",
  uncorrupted: "derro",
  toh_uncorrupted: "derro",
  erina: "erina",
  toh_erina: "erina",
  minotaur: "minotaur",
  toh_minotaur: "minotaur",
  bhain_kwai: "minotaur",
  toh_bhain_kwai: "minotaur",
  boghaid: "minotaur",
  toh_boghaid: "minotaur",
  mushroomfolk: "mushroomfolk",
  toh_mushroomfolk: "mushroomfolk",
  acid_cap: "mushroomfolk",
  toh_acid_cap: "mushroomfolk",
  favored: "mushroomfolk",
  toh_favored: "mushroomfolk",
  morel: "mushroomfolk",
  toh_morel: "mushroomfolk",
  satarre: "satarre",
  toh_satarre: "satarre",
  shade: "shade",
  toh_shade: "shade",
  darakhul: "darakhul-human",
  toh_darakhul: "darakhul-human",
  derro_heritage: "darakhul-derro",
  toh_derro_heritage: "darakhul-derro",
  dragonborn_heritage: "darakhul-dragonborn",
  toh_dragonborn_heritage: "darakhul-dragonborn",
  drow_heritage: "darakhul-drow",
  toh_drow_heritage: "darakhul-drow",
  dwarf_heritage: "darakhul-dwarf",
  toh_dwarf_heritage: "darakhul-dwarf",
  elfshadow_fey_heritage: "darakhul-elf",
  toh_elfshadow_fey_heritage: "darakhul-elf",
  gnome_heritage: "darakhul-gnome",
  toh_gnome_heritage: "darakhul-gnome",
  halfling_heritage: "darakhul-halfling",
  toh_halfling_heritage: "darakhul-halfling",
  humanhalf_elf_heritage: "darakhul-human",
  toh_humanhalf_elf_heritage: "darakhul-human",
  kobold_heritage: "darakhul-kobold",
  toh_kobold_heritage: "darakhul-kobold",
  tiefling_heritage: "darakhul-tiefling",
  toh_tiefling_heritage: "darakhul-tiefling",
  trollkin_heritage: "darakhul-trollkin",
  toh_trollkin_heritage: "darakhul-trollkin",
  ravenfolk: "darakhul-ravenfolk",
  toh_ravenfolk: "darakhul-ravenfolk",
  gearforged: "warforged",
  toh_gearforged: "warforged",
  dwarf_chassis: "gearforged-dwarf",
  toh_dwarf_chassis: "gearforged-dwarf",
  gnome_chassis: "gearforged-gnome",
  toh_gnome_chassis: "gearforged-gnome",
  kobold_chassis: "gearforged-kobold",
  toh_kobold_chassis: "gearforged-kobold",
  human_chassis: "warforged",
  toh_human_chassis: "warforged",
  toh_drow: "drow",
  delver: "drow",
  toh_delver: "drow",
  fever_bit: "drow",
  toh_fever_bit: "drow",
  purified: "drow",
  toh_purified: "drow",
};

// Every race id with a plate of its own, for the test that walks them.
export function raceFamilyIds(): string[] {
  return Object.keys(RACE_FAMILY);
}

export function raceFamily(raceId: string | null | undefined): string | null {
  const id = String(raceId ?? "").trim().toLowerCase().replace(/[\s-]/g, "_");
  return RACE_FAMILY[id] ?? null;
}

// ---- classes ----

// The SRD twelve plus the artificer and the six-per-genre original classes
// are all painted in three genders, so a neutral character in a genre class
// draws its own neutral plate rather than falling through to the genre lead.
const SRD_CLASS_IDS = new Set([
  "artificer",
  "barbarian",
  "bard",
  "cleric",
  "druid",
  "fighter",
  "monk",
  "paladin",
  "ranger",
  "rogue",
  "sorcerer",
  "warlock",
  "wizard",
]);

// Three-gender plates like the genre classes': the content pack's classes from
// other books (Level Up's Marshal, Black Flag's Mechanist), painted so their
// cards no longer fall to the hooded stranger (issue #116).
const GENRE_CLASS_IDS = new Set([
  "marshal", "mechanist",
  "netrunner", "street_samurai", "rigger", "fixer", "esper", "trauma_doc",
  "machinist", "aeronaut", "alchemist", "gadgeteer", "aether_channeler", "steam_knight",
  "exorcist", "occultist", "survivor", "slayer", "parapsychologist", "apostate",
  "detective", "alienist", "grifter", "enforcer", "muckraker", "spirit_medium",
  "scavenger", "road_warrior", "aberrant", "salvage_tech", "waste_preacher", "packmaster",
  "witch_hunter", "plague_doctor", "grave_knight", "penitent", "dirgesinger", "vermin_lord",
]);

function classPlate(classId: string, gender: PlaceholderGender): string | null {
  const id = String(classId ?? "").trim().toLowerCase().replace(/[\s-]/g, "_");
  if (SRD_CLASS_IDS.has(id)) {
    return `${id}-${gender}`;
  }
  if (GENRE_CLASS_IDS.has(id)) {
    return `${id}-${gender}`;
  }
  return null;
}

// ---- genres ----

// Genre ids are snake_case (src/lib/genres.ts) and plate ids are kebab, but
// some callers only have the preset's display name to hand: join-preview.ts
// sends "High fantasy" rather than high_fantasy. Spaces and underscores both
// fold to a hyphen so either spelling resolves.
function genreSlug(genre: string | null | undefined): string {
  return String(genre ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
}

// Only the settings whose raceHint says everyone is human got a styled lead,
// because the others accept any SRD race and so are served by the 66 race
// plates already.
const GENRE_LEADS = new Set(["mystery", "horror", "cyberpunk", "post-apocalyptic"]);

// ---- the resolvers ----

// `gender` is here because the creation payload has it (createSheetSchema)
// and the portrait prompt uses it, but a saved CharacterSheet does not carry
// it and no table stores it - so in practice every sheet resolves neutral
// today. Persisting it is what would make the masculine and feminine plates
// reachable; the field stays on the type so that change is one line here.
export type CharacterLook = {
  race?: string | null;
  class?: string | null;
  gender?: string | null;
  genre?: string | null;
};

// Class, then race, then the genre's own lead, then a plain adventurer. Class
// wins over race because the gear is what a player recognises their character
// by, and because a wizard reads as a wizard at 44 pixels where a half-elf
// does not read as a half-elf.
export function characterPlaceholder(look: CharacterLook): string {
  const gender = normalizeGender(look.gender);

  const byClass = look.class ? classPlate(look.class, gender) : null;
  if (byClass) {
    return `${BASE}/character-class/${byClass}.webp`;
  }

  const family = raceFamily(look.race);
  const slug = genreSlug(look.genre);
  // The wasteland's raceHint calls a half-orc a mutant (src/lib/genres.ts),
  // and a fantasy half-orc is the wrong picture for that; it has a lead of
  // its own.
  if (family === "half-orc" && slug === "post-apocalyptic") {
    return `${BASE}/character-genre/post-apocalyptic-mutant-${gender}.webp`;
  }
  if (family) {
    return `${BASE}/character-race/${family}-${gender}.webp`;
  }

  if (GENRE_LEADS.has(slug)) {
    return `${BASE}/character-genre/${slug}-${gender}.webp`;
  }

  return `${BASE}/character/${gender}.webp`;
}

// ---- NPC roles ----

// NPCs carry a role rather than a class or a race: what they do is what a
// silhouette can show. The ids are the plate file stems; the labels are what
// the cast editor's picker offers (src/app/workshop/cast/NpcEditorFields.tsx),
// and a role typed by hand that matches none of these still saves as text.
export type NpcRoleOption = { id: string; label: string };

// The twelve setting-neutral roles, offered at every table.
const GENERIC_NPC_ROLES: NpcRoleOption[] = [
  { id: "merchant", label: "Merchant" },
  { id: "guard", label: "Guard" },
  { id: "innkeeper", label: "Innkeeper" },
  { id: "noble", label: "Noble" },
  { id: "priest", label: "Priest" },
  { id: "scholar", label: "Scholar" },
  { id: "thief", label: "Thief" },
  { id: "soldier", label: "Soldier" },
  { id: "commoner", label: "Commoner" },
  { id: "mercenary", label: "Mercenary" },
  { id: "ruler", label: "Ruler" },
  { id: "outcast", label: "Outcast" },
];

// The faces a table meets in the genres the fantasy roles cannot stand in
// for, keyed by the genre slug so a cyberpunk cast is offered its fixer
// before its innkeeper.
const GENRE_NPC_ROLES: Record<string, NpcRoleOption[]> = {
  cyberpunk: [
    { id: "cyberpunk-fixer", label: "Fixer" },
    { id: "cyberpunk-corp-exec", label: "Corporate exec" },
    { id: "cyberpunk-street-doc", label: "Street doc" },
  ],
  steampunk: [
    { id: "steampunk-foreman", label: "Works foreman" },
    { id: "steampunk-airship-captain", label: "Airship captain" },
    { id: "steampunk-inventor", label: "Inventor" },
  ],
  "post-apocalyptic": [
    { id: "post-apocalyptic-elder", label: "Settlement elder" },
    { id: "post-apocalyptic-water-baron", label: "Water baron" },
    { id: "post-apocalyptic-caravan-guard", label: "Caravan guard" },
  ],
  horror: [
    { id: "horror-cult-elder", label: "Cult elder" },
    { id: "horror-priest", label: "Village priest" },
    { id: "horror-warden", label: "Asylum warden" },
  ],
  mystery: [
    { id: "mystery-inspector", label: "Inspector" },
    { id: "mystery-socialite", label: "Socialite" },
    { id: "mystery-informant", label: "Informant" },
  ],
};

const NPC_ROLES = new Set(
  [...GENERIC_NPC_ROLES, ...Object.values(GENRE_NPC_ROLES).flat()].map((role) => role.id),
);

// The picker's list for a table in `genre`: that setting's own roles first,
// then the twelve everyone gets. Every id here resolves to a plate.
export function npcRoleOptions(genre: string | null | undefined): NpcRoleOption[] {
  return [...(GENRE_NPC_ROLES[genreSlug(genre)] ?? []), ...GENERIC_NPC_ROLES];
}

// The label a stored role id shows on a card, or the text itself when it is
// one the catalog does not know (the editor accepts free text).
export function npcRoleLabel(role: string | null | undefined): string {
  const id = String(role ?? "").trim().toLowerCase().replace(/[\s_]/g, "-");
  const known = [...GENERIC_NPC_ROLES, ...Object.values(GENRE_NPC_ROLES).flat()].find(
    (entry) => entry.id === id,
  );
  return known ? known.label : String(role ?? "").trim();
}

// An NPC with no role recorded, or one the catalog does not know, draws one
// of the twelve neutral roles by a hash of their name. Guessing a role out of
// free text would be the same unreliable keyword-matching that made a
// creature type unusable; hashing gives a cast list twelve different faces
// that stay put per NPC, which reads better than twenty identical commoners
// and claims no more than a name already does.
export function npcPlaceholder(
  role: string | null | undefined,
  seed = "",
): string {
  const id = String(role ?? "").trim().toLowerCase().replace(/[\s_]/g, "-");
  if (NPC_ROLES.has(id)) {
    return `${BASE}/npc/${id}.webp`;
  }
  if (seed) {
    return `${BASE}/npc/${GENERIC_NPC_ROLES[hash(seed) % GENERIC_NPC_ROLES.length].id}.webp`;
  }
  return `${BASE}/npc/commoner.webp`;
}

// A monster draws its own creature family's plate when one is painted, else
// the genre's boss plate when it is the centrepiece of a fight, else its SRD
// creature type. Among the generic plates threat is checked first because a
// CR 18 humanoid warlord wants the boss plate, not the generic raider one;
// a painted family plate beats the boss plate because "this is a lich" says
// more than "this is the big one" (a CR 21 lich used to draw the genre boss).
export const BOSS_CR_FLOOR = 11;

const BOSS_GENRES = new Set([
  "high-fantasy", "dark-fantasy", "horror", "mystery",
  "cyberpunk", "steampunk", "post-apocalyptic",
]);

// The reskinned genres paint some creature types their own way: a construct
// in a cyberpunk world is a combat mech, not a stone golem, and the bestiary
// there really is full of reskinned constructs (src/lib/bestiary/*.json).
// Where a genre has two plates for one type the seed (the monster's slug or
// name) picks, so a roster of drones and mechs is not one picture repeated.
// Types not listed here draw the fantasy plate for the type, which is still
// the honest answer for a beast or an ooze in any setting.
const GENRE_TYPE_PLATES: Record<string, Record<string, string[]>> = {
  cyberpunk: {
    construct: ["cyberpunk-combat-mech", "cyberpunk-security-drone"],
    humanoid: ["cyberpunk-cyberpsycho"],
  },
  steampunk: {
    construct: ["steampunk-automaton", "steampunk-boiler-golem"],
    elemental: ["steampunk-aether-wraith"],
    undead: ["steampunk-aether-wraith"],
  },
  "post-apocalyptic": {
    humanoid: ["post-apocalyptic-feral-mutant"],
    monstrosity: ["post-apocalyptic-feral-mutant"],
    construct: ["post-apocalyptic-scrap-hound"],
    beast: ["post-apocalyptic-rad-swarm"],
  },
  horror: {
    undead: ["horror-revenant", "horror-wraith"],
    aberration: ["horror-flesh-thing"],
    monstrosity: ["horror-flesh-thing"],
  },
};

// ---- creature families ----

// Plates painted for one creature in particular, keyed by its SRD 5.1 /
// Open5e monster slug, which is what an encounter enemy and a bestiary entry
// both carry (EncounterEnemy.slug, BestiaryEntry.slug). The value is the
// plate's file stem under monster/. A key that is not its own value is an
// alias: a variant that is plainly the same creature and so shares the
// plate. Only add an alias when a player would call the picture right for
// it; a creature that merely sits in the same type (a winged kobold, a
// giant wolf spider, a brass dragon) keeps its type plate until it is
// painted. Enemy NPC roles (the bandit, the dark knight) sit in the same
// table: they are keyed by the role's own name and reached from the SRD NPC
// stat blocks that play the role.
export const MONSTER_FAMILIES: Readonly<Record<string, string>> = {
  // The first 24, one plate each.
  "animated-armor": "animated-armor",
  "brown-bear": "brown-bear",
  "earth-elemental": "earth-elemental",
  gargoyle: "gargoyle",
  "gelatinous-cube": "gelatinous-cube",
  ghoul: "ghoul",
  "giant-rat": "giant-rat",
  "giant-spider": "giant-spider",
  gnoll: "gnoll",
  "green-hag": "green-hag",
  "hell-hound": "hell-hound",
  hobgoblin: "hobgoblin",
  imp: "imp",
  kobold: "kobold",
  lich: "lich",
  mimic: "mimic",
  minotaur: "minotaur",
  mummy: "mummy",
  owlbear: "owlbear",
  "rust-monster": "rust-monster",
  stirge: "stirge",
  troll: "troll",
  werewolf: "werewolf",
  zombie: "zombie",
  // Aliases: the same creature under another SRD slug.
  ghast: "ghoul",
  "black-bear": "brown-bear",
  "polar-bear": "brown-bear",
  spider: "giant-spider",
  rat: "giant-rat",
  "mummy-lord": "mummy",
  // The second 24.
  "air-elemental": "air-elemental",
  ankheg: "ankheg",
  basilisk: "basilisk",
  bulette: "bulette",
  chuul: "chuul",
  cloaker: "cloaker",
  crocodile: "crocodile",
  "flesh-golem": "flesh-golem",
  ghost: "ghost",
  "giant-poisonous-snake": "giant-poisonous-snake",
  "giant-scorpion": "giant-scorpion",
  "giant-shark": "giant-shark",
  griffon: "griffon",
  harpy: "harpy",
  hydra: "hydra",
  "iron-golem": "iron-golem",
  otyugh: "otyugh",
  roper: "roper",
  "swarm-of-rats": "swarm-of-rats",
  treant: "treant",
  "vampire-spawn": "vampire-spawn",
  "water-elemental": "water-elemental",
  "will-o-wisp": "will-o-wisp",
  wyvern: "wyvern",
  // The later 72.
  androsphinx: "androsphinx",
  azer: "azer",
  "barbed-devil": "barbed-devil",
  "bearded-devil": "bearded-devil",
  "black-pudding": "black-pudding",
  boar: "boar",
  centaur: "centaur",
  "chain-devil": "chain-devil",
  chimera: "chimera",
  "cloud-giant": "cloud-giant",
  cockatrice: "cockatrice",
  darkmantle: "darkmantle",
  "death-dog": "death-dog",
  "dragon-turtle": "dragon-turtle",
  drider: "drider",
  dryad: "dryad",
  duergar: "duergar",
  "dust-mephit": "dust-mephit",
  ettercap: "ettercap",
  ettin: "ettin",
  "fire-giant": "fire-giant",
  "flying-sword": "flying-sword",
  "frost-giant": "frost-giant",
  "giant-bat": "giant-bat",
  "giant-eagle": "giant-eagle",
  "giant-octopus": "giant-octopus",
  glabrezu: "glabrezu",
  grick: "grick",
  "guardian-naga": "guardian-naga",
  gynosphinx: "gynosphinx",
  hezrou: "hezrou",
  hippogriff: "hippogriff",
  homunculus: "homunculus",
  "horned-devil": "horned-devil",
  "ice-devil": "ice-devil",
  kraken: "kraken",
  lamia: "lamia",
  marilith: "marilith",
  medusa: "medusa",
  merfolk: "merfolk",
  merrow: "merrow",
  nalfeshnee: "nalfeshnee",
  "night-hag": "night-hag",
  pegasus: "pegasus",
  "pit-fiend": "pit-fiend",
  pseudodragon: "pseudodragon",
  "purple-worm": "purple-worm",
  quasit: "quasit",
  rakshasa: "rakshasa",
  remorhaz: "remorhaz",
  roc: "roc",
  "saber-toothed-tiger": "saber-toothed-tiger",
  sahuagin: "sahuagin",
  satyr: "satyr",
  "sea-hag": "sea-hag",
  shrieker: "shrieker",
  "spirit-naga": "spirit-naga",
  "stone-giant": "stone-giant",
  "storm-giant": "storm-giant",
  "swarm-of-bats": "swarm-of-bats",
  "swarm-of-insects": "swarm-of-insects",
  "tyrannosaurus-rex": "tyrannosaurus-rex",
  unicorn: "unicorn",
  "violet-fungus": "violet-fungus",
  vrock: "vrock",
  warhorse: "warhorse",
  xorn: "xorn",
  "young-black-dragon": "young-black-dragon",
  "young-blue-dragon": "young-blue-dragon",
  "young-gold-dragon": "young-gold-dragon",
  "young-silver-dragon": "young-silver-dragon",
  "young-white-dragon": "young-white-dragon",
  // Aliases for the new families: the same creature under another SRD
  // slug, or the plain word a DM types for it.
  // Every age of a painted dragon colour shares its young plate. Green and
  // red already have theirs (the dragon type plate and the fantasy boss);
  // brass, bronze and copper are not painted yet.
  "black-dragon-wyrmling": "young-black-dragon",
  "adult-black-dragon": "young-black-dragon",
  "ancient-black-dragon": "young-black-dragon",
  "blue-dragon-wyrmling": "young-blue-dragon",
  "adult-blue-dragon": "young-blue-dragon",
  "ancient-blue-dragon": "young-blue-dragon",
  "gold-dragon-wyrmling": "young-gold-dragon",
  "adult-gold-dragon": "young-gold-dragon",
  "ancient-gold-dragon": "young-gold-dragon",
  "silver-dragon-wyrmling": "young-silver-dragon",
  "adult-silver-dragon": "young-silver-dragon",
  "ancient-silver-dragon": "young-silver-dragon",
  "white-dragon-wyrmling": "young-white-dragon",
  "adult-white-dragon": "young-white-dragon",
  "ancient-white-dragon": "young-white-dragon",
  // SRD 5.1 lists the beetle, centipede, spider and wasp swarms as variants
  // of the swarm of insects.
  "swarm-of-beetles": "swarm-of-insects",
  "swarm-of-centipedes": "swarm-of-insects",
  "swarm-of-spiders": "swarm-of-insects",
  "swarm-of-wasps": "swarm-of-insects",
  // One shark covers the reef, hunter and giant sharks.
  shark: "giant-shark",
  "reef-shark": "giant-shark",
  "hunter-shark": "giant-shark",
  bat: "giant-bat",
  eagle: "giant-eagle",
  octopus: "giant-octopus",
  scorpion: "giant-scorpion",
  "poisonous-snake": "giant-poisonous-snake",
  "giant-crocodile": "crocodile",
  "giant-boar": "boar",
  "awakened-tree": "treant",
  gryphon: "griffon",
  "t-rex": "tyrannosaurus-rex",
  merman: "merfolk",
  mermaid: "merfolk",
  sphinx: "androsphinx",
  // Enemy NPC roles, by the role's own name.
  bandit: "bandit",
  cultist: "cultist",
  assassin: "assassin",
  necromancer: "necromancer",
  "dark-knight": "dark-knight",
  archer: "archer",
  gladiator: "gladiator",
  pirate: "pirate",
  "battle-shaman": "battle-shaman",
  "alchemical-saboteur": "alchemical-saboteur",
  executioner: "executioner",
  houndmaster: "houndmaster",
  tyrant: "tyrant",
  // ...from the SRD NPC stat block that plays the role. A stat block maps
  // only where the role is plainly what it is: a mage, a priest, a veteran
  // or a berserker stays on the humanoid plate, since a hired mage is not a
  // necromancer nor a temple priest a battle shaman.
  "bandit-captain": "bandit",
  thug: "executioner",
  "cult-fanatic": "cultist",
  spy: "assassin",
  knight: "dark-knight",
  scout: "archer",
  druid: "battle-shaman",
  archmage: "tyrant",
  // ...and from the names a DM gives them.
  brigand: "bandit",
  highwayman: "bandit",
  "bandit-leader": "bandit",
  "cult-leader": "cultist",
  poisoner: "assassin",
  blackguard: "dark-knight",
  "death-knight": "dark-knight",
  "black-knight": "dark-knight",
  crossbowman: "archer",
  corsair: "pirate",
  "pirate-captain": "pirate",
  buccaneer: "pirate",
  shaman: "battle-shaman",
  alchemist: "alchemical-saboteur",
  saboteur: "alchemical-saboteur",
  torturer: "executioner",
  headsman: "executioner",
  "beast-handler": "houndmaster",
  beastmaster: "houndmaster",
  "kennel-master": "houndmaster",
  overlord: "tyrant",
};

// A name or slug as a family key: lowercase, words hyphenated, and the run
// number an encounter adds ("Ghoul 2", "Ghoul #2", src/lib/dm/encounter-logic.ts)
// and a parenthetical ("Imp (unbound)") dropped, so "Giant Rat 3" is
// giant-rat. Only ever looked up in MONSTER_FAMILIES, never trusted alone.
function familyKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+#?\d{1,3}$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function familyOf(value: string | null | undefined): string | null {
  const key = familyKey(value);
  return key ? (MONSTER_FAMILIES[key] ?? null) : null;
}

// The genres whose bestiaries (src/lib/bestiary/*.json) keep the SRD stat
// block and rename the creature: a cyberpunk giant-rat is a Sump Rat, a
// horror werewolf is The Good Doctor, a mystery mimic is The Locked Chest.
// A painted fantasy rat is the wrong picture for a sump rat, and in horror
// and mystery the plate would give away what the name is hiding. So in these
// genres the family plate is drawn only when the name on the card is the
// SRD creature itself (a DM who spawns a plain "Troll" gets the troll), and a
// reskin keeps the genre's own type plate. Dark fantasy renames too (a Plague
// Rat, The Hollow Saint), but its creatures are the fantasy creatures under
// grimmer names, so it draws family plates like high fantasy does.
const RESKIN_GENRES = new Set(["cyberpunk", "steampunk", "post-apocalyptic", "horror", "mystery"]);

// ---- genre enemy tokens ----

// Enemies painted for one genre in particular: a cyberpunk ganger, a
// steampunk sky pirate, a post-apocalyptic burrower. They are only ever
// looked up in their own genre, so a corporate squad never turns up in a
// fantasy dungeon. Within the genre a token is reached two ways:
//   names: the whole name on the card (the genre bestiary's reskin name, or
//          the plain words a DM would type), normalised like a family key
//          with a leading "The" dropped, so "The Poisoner" and "Poisoner 2"
//          both land. Never a word inside a longer name.
//   slugs: the SRD stat block, where that genre's bestiary
//          (src/lib/bestiary/<genre>.json) plays that block as exactly this
//          enemy, so an encounter that renames it still gets the token.
// A token beats the fantasy family plate, the boss plate and the genre's
// type plate: in its genre it is the most specific picture there is.
export type GenreEnemyTable = { names: Record<string, string[]>; slugs: Record<string, string> };

export const GENRE_ENEMY_TOKENS: Readonly<Record<string, GenreEnemyTable>> = {
  cyberpunk: {
    names: {
      "cyberpunk-corp-squad": [
        "Corpo Rent-a-Cop", "Corpo Enforcer", "Merc Trooper", "Corp Squad", "Corporate Tactical Squad",
        "Corporate Security", "Corp Security", "Security Trooper", "Tactical Squad",
      ],
      "cyberpunk-gang": ["Street Ganger", "Gang Boss", "Chromed Bruiser", "Ganger", "Gang Bruiser", "Gang Shooter", "Gang Member"],
      "cyberpunk-synth": ["Face-Dancer", "Synth", "Synthetic Infiltrator", "Android", "Replicant", "Combat Synth"],
      "cyberpunk-microdrone": ["Spy Microdrone", "Surveillance Microdrone", "Microdrone"],
      "cyberpunk-walking-turret": ["Walking Turret", "Mobile Gun Turret", "Autonomous Walking Turret"],
    },
    // guard is the Corpo Rent-a-Cop; bandit and bandit-captain are the
    // Street Ganger and the Gang Boss.
    slugs: { guard: "cyberpunk-corp-squad", bandit: "cyberpunk-gang", "bandit-captain": "cyberpunk-gang" },
  },
  steampunk: {
    names: {
      "steampunk-sky-pirate": ["Sky Pirate Captain", "Ironclad Marine", "Sky Pirate", "Air Pirate", "Boarding Marine"],
      "steampunk-surgeon": ["Rogue Surgeon", "Mad Doctor", "Galvanist", "Mad Scientist"],
      "steampunk-clockwork-spider": ["Clockwork Spider", "Brass Spider", "Clockwork Arachnid"],
      "steampunk-repair-swarm": ["Repair Swarm", "Clockwork Repair Swarm", "Repair Beetle Swarm"],
      "steampunk-galvanic-corpse": ["Galvanic Revenant", "Galvanic Corpse", "Reanimated Laborer", "Reanimated Labourer"],
      // Humanlike bosses, which the boiler-machine boss plate got wrong.
      "steampunk-magnate": [
        "The Colonial Magnate", "The Perpetual Chairman", "The Royal Society's Shadow", "The Opium Magnate",
        "Ice-Trade Baron", "Industrial Magnate", "Magnate", "Mastermind", "Tycoon", "Robber Baron",
      ],
    },
    // bandit-captain is the Sky Pirate Captain.
    slugs: { "bandit-captain": "steampunk-sky-pirate" },
  },
  "post-apocalyptic": {
    names: {
      "post-apocalyptic-raider": ["Road Raider", "Raid Boss", "Warlord's Enforcer", "Raider", "Marauder", "Armored Scavenger"],
      "post-apocalyptic-hazmat": ["Hazmat Trooper", "Hazmat Soldier", "Decon Trooper"],
      "post-apocalyptic-stalker": ["Rad-Feral", "Feral Cannibal", "Pit Feeder", "Contaminated Stalker", "Irradiated Ghoul", "Stalker"],
      "post-apocalyptic-burrower": ["Acid Burrower", "Road Shark", "Mutant Burrower", "Burrower"],
      "post-apocalyptic-ambush-plant": ["Compost Colossus", "Mutant Plant", "Ambush Plant"],
      "post-apocalyptic-predator": [
        "Rad-Rat", "Waste Hound", "Alpha Waste Hound", "Mutant Alpha", "Two-Headed Coyote", "Nuclear-Winter Wolf",
        "Wasteland Predator", "Mutant Quadruped",
      ],
    },
    // The bestiary's reskins of each block: the raiders, the corporeal
    // undead (rad-ferals and cannibals, not the shades and echoes), the two
    // burrowers, the shambling mound, and every four-legged hunter, which
    // otherwise drew the insect swarm the genre paints for beasts.
    slugs: {
      bandit: "post-apocalyptic-raider",
      "bandit-captain": "post-apocalyptic-raider",
      zombie: "post-apocalyptic-stalker",
      ghoul: "post-apocalyptic-stalker",
      ghast: "post-apocalyptic-stalker",
      ankheg: "post-apocalyptic-burrower",
      bulette: "post-apocalyptic-burrower",
      "shambling-mound": "post-apocalyptic-ambush-plant",
      "violet-fungus": "post-apocalyptic-ambush-plant",
      "giant-rat": "post-apocalyptic-predator",
      rat: "post-apocalyptic-predator",
      wolf: "post-apocalyptic-predator",
      worg: "post-apocalyptic-predator",
      "dire-wolf": "post-apocalyptic-predator",
      "winter-wolf": "post-apocalyptic-predator",
      "death-dog": "post-apocalyptic-predator",
      jackal: "post-apocalyptic-predator",
      hyena: "post-apocalyptic-predator",
      "giant-hyena": "post-apocalyptic-predator",
      mastiff: "post-apocalyptic-predator",
      panther: "post-apocalyptic-predator",
      lion: "post-apocalyptic-predator",
      tiger: "post-apocalyptic-predator",
      "saber-toothed-tiger": "post-apocalyptic-predator",
    },
  },
  // Horror goes by name only: its bestiary hides what a thing is behind its
  // name, and a stat block's token would give that away (a commoner is a
  // possessed villager only when the card says so).
  horror: {
    names: {
      "horror-possessed": ["Smiling Neighbor", "Possessed", "Possessed Villager", "Possessed Commoner"],
      "horror-doll": ["Doll", "Sinister Doll", "Porcelain Doll", "Haunted Doll"],
      "horror-fungal-host": ["Fungal Host", "Spore Host", "Infested Host"],
      "horror-parasite-swarm": ["The Skittering", "Parasite Swarm", "Crawling Parasite Swarm", "Crawling Swarm"],
    },
    slugs: {},
  },
  mystery: {
    names: {
      "mystery-hired-gun": ["Hired Rough", "Loan Shark's Muscle", "Foreign Legionnaire", "Hired Gun", "Gunman"],
      "mystery-burglar": ["The Unseen Burglar", "Burglar", "Masked Burglar", "Cat Burglar", "Cracksman"],
      "mystery-poisoner": ["Poisoner"],
      "mystery-occult-enforcer": ["Secret Society Member", "Society Grandmaster", "Occult Enforcer", "Occult Society Enforcer", "Society Enforcer"],
    },
    // bandit and thug are the Hired Rough and the Loan Shark's Muscle,
    // assassin is The Poisoner, cultist and cult-fanatic are the society.
    slugs: {
      bandit: "mystery-hired-gun",
      thug: "mystery-hired-gun",
      assassin: "mystery-poisoner",
      cultist: "mystery-occult-enforcer",
      "cult-fanatic": "mystery-occult-enforcer",
    },
  },
  // Dark fantasy draws the fantasy family plates (see RESKIN_GENRES), so its
  // tokens come by name only and a plain cultist stays a cultist.
  "dark-fantasy": {
    names: {
      "dark-fantasy-penitent": ["Flagellant Champion", "Penitent of the Pit", "Penitent", "Penitent Executioner", "Flagellant"],
      "dark-fantasy-plague-soldier": ["Plague Soldier", "Plague Trooper"],
    },
    slugs: {},
  },
};

// A token's English names as a table may write them: with and without "The"
// ("The Skittering", "Skittering", "the Burglar"), spelled on the table. The
// name a monster has is looked up as written.
function genreNameSpellings(name: string): string[] {
  const bare = familyKey(name).replace(/^the-/, "");
  return [familyKey(name), bare, `the-${bare}`];
}

const GENRE_ENEMY_LOOKUP: Record<string, { names: Map<string, string>; slugs: Record<string, string> }> =
  Object.fromEntries(
    Object.entries(GENRE_ENEMY_TOKENS).map(([genre, table]) => [
      genre,
      {
        names: new Map(
          Object.entries(table.names).flatMap(([plate, names]) =>
            names.flatMap((name) => genreNameSpellings(name).map((spelling) => [spelling, plate] as const)),
          ),
        ),
        slugs: table.slugs,
      },
    ]),
  );

// Which genre token, if any, this monster draws: its name first, then its
// stat block, and only in the genre that painted it.
function genreEnemyPlate(genre: string, slug: string | null | undefined, name: string | null | undefined): string | null {
  const table = GENRE_ENEMY_LOOKUP[genre];
  if (!table) {
    return null;
  }
  const byName = table.names.get(familyKey(name));
  if (byName) {
    return byName;
  }
  const key = familyKey(slug);
  return key && Object.prototype.hasOwnProperty.call(table.slugs, key) ? (table.slugs[key] ?? null) : null;
}

// Which family plate, if any, this monster draws. The slug is the real
// answer when the caller has it; a name only counts when the whole name is a
// family (a homebrew monster called "Owlbear"), never a word inside one.
function familyPlate(genre: string, slug: string | null | undefined, name: string | null | undefined): string | null {
  const fromName = familyOf(name);
  const family = familyOf(slug) ?? fromName;
  if (!family) {
    return null;
  }
  if (RESKIN_GENRES.has(genre) && fromName !== family) {
    return null;
  }
  return family;
}

export type MonsterLook = {
  cr?: number | null;
  genre?: string | null;
  // Keeps a monster on the same plate where a genre offers two.
  seed?: string | null;
  // The SRD / Open5e slug of the stat block it fights with (giant-rat for a
  // cyberpunk Sump Rat), when the caller has one.
  slug?: string | null;
  // The name the table sees, for the reskin guard and for a monster with no
  // slug at all.
  name?: string | null;
};

// Order: the genre's own enemy token (in that genre only), then the
// creature's own family plate, then the genre's boss plate at
// CR 11 and up, then the genre's plate for the type, then the type. A
// picture somebody supplied for this monster in particular (a world pack's
// art) beats all of these, and is applied by the caller (MonsterTile's
// `art`), since it is not a plate.
export function monsterPlaceholder(
  type: string | null | undefined,
  options: MonsterLook = {},
): string {
  const slug = genreSlug(options.genre);
  const token = genreEnemyPlate(slug, options.slug, options.name);
  if (token) {
    return `${BASE}/monster/${token}.webp`;
  }
  const family = familyPlate(slug, options.slug, options.name);
  if (family) {
    return `${BASE}/monster/${family}.webp`;
  }
  if (typeof options.cr === "number" && options.cr >= BOSS_CR_FLOOR && BOSS_GENRES.has(slug)) {
    return `${BASE}/monster/${slug}-boss.webp`;
  }
  const kind = normalizeCreatureType(type) ?? "monstrosity";
  const own = GENRE_TYPE_PLATES[slug]?.[kind];
  if (own?.length) {
    return `${BASE}/monster/${own[hash(options.seed || kind) % own.length]}.webp`;
  }
  return `${BASE}/monster/${kind}.webp`;
}

// ---- campaigns, maps and the workshop ----

// Three plates per genre, picked by a hash of the campaign id so a table keeps
// the same cover between renders and between clients rather than shuffling on
// every mount.
const COVER_VARIANTS = 3;

const COVER_GENRES = new Set([
  "high-fantasy", "dark-fantasy", "mystery", "horror",
  "cyberpunk", "steampunk", "post-apocalyptic", "custom",
]);

export function campaignPlaceholder(genre: string | null | undefined, seed = ""): string {
  const slug = genreSlug(genre);
  const known = COVER_GENRES.has(slug) ? slug : "custom";
  const variant = (hash(seed || known) % COVER_VARIANTS) + 1;
  return `${BASE}/campaign/${known}-${variant}.webp`;
}

// ---- maps ----

// A place's kind of scene (an ambience bed, src/lib/ambience/catalog.ts)
// picks its plate, whatever language the place was named in. A kind with
// several plates draws one by hash, so every plate stays reachable. A place
// with no kind, or a kind no plate shows, draws one of a reskinned genre's
// own plates, and in fantasy the journey plate, which says "somewhere on the
// road" and nothing more.
//
// A genre's own table runs before the shared one, so a mystery town is the
// back alley and not a fantasy village.
type ScenePlates = Partial<Record<string, string[]>>;

const SHARED_SCENE_PLATES: ScenePlates = {
  dungeon: ["dungeon"],
  cave: ["cavern"],
  mine: ["cavern"],
  crypt: ["crypt"],
  graveyard: ["crypt"],
  sewer: ["sewer"],
  ruins: ["ruins"],
  temple: ["temple"],
  forest: ["forest"],
  deep_forest: ["deep-forest"],
  jungle: ["deep-forest"],
  swamp: ["swamp"],
  desert: ["desert", "wasteland"],
  mountain: ["mountain-pass"],
  tundra: ["tundra"],
  coast: ["coast"],
  ship: ["ship-deck"],
  town: ["village"],
  city: ["city-gate"],
  market: ["market"],
  crowd: ["market", "arena"],
  tavern: ["tavern"],
  keep: ["castle-hall", "throne-room"],
  library: ["library"],
  forge: ["laboratory"],
  arcane: ["laboratory"],
};

const GENRE_SCENE_PLATES: Record<string, ScenePlates> = {
  cyberpunk: {
    town: ["cyberpunk-neon-alley"],
    city: ["cyberpunk-neon-alley"],
    market: ["cyberpunk-neon-alley"],
    crowd: ["cyberpunk-neon-alley"],
    keep: ["cyberpunk-arcology"],
    library: ["cyberpunk-server-farm"],
    arcane: ["cyberpunk-server-farm"],
    forge: ["cyberpunk-server-farm"],
    sewer: ["cyberpunk-undercity"],
    dungeon: ["cyberpunk-undercity"],
    mine: ["cyberpunk-undercity"],
    cave: ["cyberpunk-undercity"],
  },
  steampunk: {
    forge: ["steampunk-factory"],
    mine: ["steampunk-factory"],
    ship: ["steampunk-airship-dock"],
    coast: ["steampunk-airship-dock"],
    river: ["steampunk-airship-dock"],
    keep: ["steampunk-clockwork-vault"],
    library: ["steampunk-clockwork-vault"],
    arcane: ["steampunk-clockwork-vault"],
    dungeon: ["steampunk-clockwork-vault"],
    town: ["steampunk-gaslit-street"],
    city: ["steampunk-gaslit-street"],
    market: ["steampunk-gaslit-street"],
    crowd: ["steampunk-gaslit-street"],
  },
  "post-apocalyptic": {
    city: ["post-apocalyptic-overpass"],
    ruins: ["post-apocalyptic-overpass"],
    river: ["post-apocalyptic-overpass"],
    town: ["post-apocalyptic-scrap-market"],
    market: ["post-apocalyptic-scrap-market"],
    crowd: ["post-apocalyptic-scrap-market"],
    dungeon: ["post-apocalyptic-shelter"],
    keep: ["post-apocalyptic-shelter"],
    cave: ["post-apocalyptic-shelter"],
    mine: ["post-apocalyptic-shelter"],
    plains: ["post-apocalyptic-dead-highway"],
    desert: ["post-apocalyptic-dead-highway"],
  },
  horror: {
    keep: ["horror-manor"],
    library: ["horror-manor"],
    tavern: ["horror-manor"],
    dungeon: ["horror-asylum"],
    temple: ["horror-crypt-chapel"],
    crypt: ["horror-crypt-chapel"],
    graveyard: ["horror-graveyard"],
  },
  mystery: {
    dungeon: ["mystery-precinct"],
    keep: ["mystery-parlour"],
    library: ["mystery-parlour"],
    tavern: ["mystery-parlour"],
    town: ["mystery-back-alley"],
    city: ["mystery-back-alley"],
    sewer: ["mystery-back-alley"],
    crypt: ["mystery-morgue"],
    graveyard: ["mystery-morgue"],
  },
};

export type MapLook = {
  // The place's ambience bed, or nothing when it has none.
  scene?: string | null;
  genre?: string | null;
};

export function mapPlaceholder(look: MapLook, seed = ""): string {
  const slug = genreSlug(look.genre);
  const scene = look.scene ?? "";
  const own = GENRE_SCENE_PLATES[slug];
  const plates = (scene && (own?.[scene] ?? SHARED_SCENE_PLATES[scene])) || null;
  if (plates) {
    return `${BASE}/map/${plates[hash(seed || scene) % plates.length]}.webp`;
  }
  if (own) {
    const genrePlates = [...new Set(Object.values(own).flat())] as string[];
    return `${BASE}/map/${genrePlates[hash(seed || slug) % genrePlates.length]}.webp`;
  }
  return `${BASE}/misc/journey.webp`;
}

// ---- the workshop ----

const WORKSHOP_ROOMS = new Set([
  "workshop", "maps", "cast", "bestiary", "encounters",
  "lore", "storyboard", "tables", "rulesets",
  "region", "party", "factions", "homebrew", "plugin", "share",
]);

export function workshopPlaceholder(room: string | null | undefined): string {
  const id = String(room ?? "").trim().toLowerCase();
  return `${BASE}/workshop/${WORKSHOP_ROOMS.has(id) ? id : "workshop"}.webp`;
}

const MISC_TILES = new Set([
  "party", "quest", "faction", "treasure", "chapter", "session", "journey", "empty",
]);

export function miscPlaceholder(id: string | null | undefined): string {
  const key = String(id ?? "").trim().toLowerCase();
  return `${BASE}/misc/${MISC_TILES.has(key) ? key : "empty"}.webp`;
}

// The eight sigils a player can take as an avatar, picked by a hash of the
// user id so somebody who has never chosen one still looks like themselves
// everywhere they appear.
const AVATAR_SIGILS = ["wolf", "raven", "stag", "dragon", "tower", "oak", "ship", "flame"];

export function avatarPlaceholder(seed: string | null | undefined): string {
  const key = String(seed ?? "").trim();
  const sigil = AVATAR_SIGILS[hash(key || "wolf") % AVATAR_SIGILS.length];
  return `${BASE}/avatar/${sigil}.webp`;
}
