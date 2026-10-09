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

import { normalizeCreatureType } from "@/lib/bestiary/statblock";

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
  deep_gnome: "gnome",
  half_elf: "half-elf",
  half_orc: "half-orc",
  tiefling: "tiefling",
  aasimar: "aasimar",
  goliath: "goliath",
  firbolg: "firbolg",
  tabaxi: "tabaxi",
  kenku: "kenku",
  tortle: "tortle",
  fire_genasi: "genasi",
  water_genasi: "genasi",
  air_genasi: "genasi",
  earth_genasi: "genasi",
  changeling: "changeling",
  warforged: "warforged",
  goblin: "goblin",
  bugbear: "bugbear",
  lizardfolk: "lizardfolk",
};

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

// A monster draws its SRD creature type, or the genre's boss plate when it is
// the centrepiece of a fight. Threat is checked first because a CR 18
// humanoid warlord wants the boss plate, not the generic raider one.
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

export function monsterPlaceholder(
  type: string | null | undefined,
  options: { cr?: number | null; genre?: string | null; seed?: string | null } = {},
): string {
  const slug = genreSlug(options.genre);
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
