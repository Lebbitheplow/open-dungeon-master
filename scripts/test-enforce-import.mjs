// A character or a workshop arriving as a file.
//
// A file is a request somebody wrote by hand, so an import is held to what
// the server holds a new character to, and to nothing less:
//   a character exported and imported again is the same character, every
//   rules field equal;
//   a file is somebody's own to export, and lands in the importer's library
//   and nowhere else;
//   a file that is too large, not JSON, of another kind or another version
//   is refused before anything is written;
//   what the builder's own door (POST /api/characters) refuses, the import
//   refuses: a level past 20, a score past the schema, negative gold, a
//   spell list the class tables forbid;
//   state the engine owns does not ride in on a file;
//   a workshop bundle's variant rules pass through the settings schema.
//
// The schema both doors share (createSheetSchema) bounds each number apart
// and knows no class table. What that lets a NEW character hold is recorded
// in test-enforce-creation-routes.mjs; the finding at the end of this file
// lists what a FILE may hold, because a file is the easier thing to edit.
import assert from "node:assert/strict";
import { call, settle, signOut } from "./lib/enforce-campaign.mjs";
import { heroInput, openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-import");
const world = await openWorld();
const { getDatabase } = await import("../src/lib/db/core.ts");
const characters = await import("../src/lib/db/characters.ts");
const { getCampaignById, joinByInviteCode } = await import("../src/lib/db/campaigns.ts");

const route = {
  characters: await world.route("characters"),
  exportOne: await world.route("characters/[characterId]/export"),
  importOne: await world.route("characters/import"),
  workshop: await world.route("workshops/import"),
  sheet: await world.route("campaigns/[campaignId]/sheet"),
};

const author = world.addUser("author");
const importer = world.addUser("importer");

// A one-pixel PNG: the file brings its own face, so none is painted.
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const FACE = { name: "face", type: "image/png", dataUrl: PIXEL };

const bundleOf = (sheet, level = 1, extra = {}) => ({
  kind: "odm.character",
  version: 1,
  exportedAt: "2026-01-01T00:00:00.000Z",
  name: sheet.name ?? "Filed",
  level,
  sheet,
  portrait: FACE,
  ...extra,
});

const library = (user) => characters.listCharactersForUser(user.id);

async function importAs(user, body, headers) {
  world.signIn(user);
  if (headers) {
    const request = new Request("http://test/", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    const response = await route.importOne.POST(request);
    return { status: response.status, json: await response.json() };
  }
  return call(route.importOne, "POST", body);
}

// ---- the round trip ----

const VETERAN = heroInput({
  name: "Maelis",
  race: "half_elf",
  class: "paladin",
  level: 7,
  subclass: "Oath of Devotion",
  background: "soldier",
  alignment: "LG",
  abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 18 },
  maxHp: 60,
  ac: 18,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d10", total: 7, spent: 0 },
  classes: [
    { id: "paladin", subclass: "Oath of Devotion", level: 5 },
    { id: "warlock", subclass: "The Fiend", level: 2 },
  ],
  hitDicePools: [
    { classId: "paladin", die: "d10", total: 5, spent: 0 },
    { classId: "warlock", die: "d8", total: 2, spent: 0 },
  ],
  proficiencies: {
    saves: ["wis", "cha"], skills: ["athletics", "persuasion"], expertise: [],
    languages: ["Common", "Elvish"], tools: [], armor: ["light", "medium", "heavy", "shields"],
    weapons: ["simple", "martial"],
  },
  equipment: [
    { name: "Chain Mail", qty: 1, equipped: true },
    { name: "Cloak of Protection", qty: 1, attuned: true, equipped: true },
    { name: "Tarnished locket", qty: 1, identified: false, weight: 0.2 },
  ],
  gold: 212,
  copper: 45,
  feats: ["Sentinel"],
  features: [{ name: "Blessing of the Tide", source: "story" }],
  asiChoices: [{ mode: "feat", feat: "Sentinel" }],
  racialChoices: { asi: ["str", "con"], skills: ["athletics", "persuasion"], cantrip: "", tool: "" },
  spellcasting: {
    ability: "cha",
    slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } },
    prepared: ["Searing Smite", "Thunderous Smite"],
    known: ["Hex", "Armor of Agathys"],
    cantrips: ["Eldritch Blast", "Minor Illusion"],
    casters: [
      { classId: "paladin", ability: "cha", known: [], prepared: ["Searing Smite", "Thunderous Smite"], cantrips: [] },
      { classId: "warlock", ability: "cha", known: ["Hex", "Armor of Agathys"], prepared: [], cantrips: ["Eldritch Blast", "Minor Illusion"] },
    ],
    pact: { level: 1, max: 2, used: 0 },
  },
  notes: "Owes the ferryman a favour.",
  backstory: "Held the bridge at Carrow.",
});

// A veteran in the author's library, as the server stores one: filed through
// the import door, so every value the server derives is already its own.
async function shelve(sheet, level) {
  const filed = await importAs(author, bundleOf(sheet, level));
  assert.equal(filed.status, 201, JSON.stringify(filed.json));
  return characters.getCharacter(filed.json.character.id);
}

await test("a character exported and imported again is the same character", async () => {
  const original = await shelve(VETERAN, 7);
  // What the file claimed and the server wrote for itself.
  assert.deepEqual(original.sheet.hitDicePools.map((pool) => [pool.die, pool.total]), [["d10", 5], ["d8", 2]]);
  assert.deepEqual(original.sheet.proficiencies.saves, ["wis", "cha"]);
  assert.ok(original.sheet.features.some((feature) => feature.name === "Blessing of the Tide"));
  world.signIn(author);
  const response = await route.exportOne.GET(new Request("http://test/"), {
    params: Promise.resolve({ characterId: original.id }),
  });
  assert.equal(response.status, 200);
  const file = await response.text();
  const bundle = JSON.parse(file);
  assert.equal(bundle.kind, "odm.character");
  assert.equal(bundle.level, 7);

  const arrived = await importAs(importer, { ...bundle, portrait: FACE });
  assert.equal(arrived.status, 201, JSON.stringify(arrived.json));
  const copy = characters.getCharacter(arrived.json.character.id);
  assert.equal(copy.userId, importer.id);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.level, original.level);
  assert.equal(copy.role, "pc");
  const rules = (sheet) => Object.fromEntries(Object.entries(sheet).filter(([key]) => key !== "portrait"));
  assert.deepEqual(rules(copy.sheet), rules(original.sheet));
  // The author's library is untouched and the importer has exactly the one.
  assert.equal(library(author).length, 1);
  assert.equal(library(importer).length, 1);
});

await test(
  "A character carries its experience with it: exported at 34,000 XP, it arrives with 34,000 XP.",
  async () => {
    const original = await shelve(
      { ...VETERAN, name: "Seasoned", classes: [{ ...VETERAN.classes[0], level: 6 }, VETERAN.classes[1]] },
      8,
    );
    getDatabase().prepare(`UPDATE library_characters SET xp = 34000 WHERE id = ?`).run(original.id);
    world.signIn(author);
    const response = await route.exportOne.GET(new Request("http://test/"), {
      params: Promise.resolve({ characterId: original.id }),
    });
    const arrived = await importAs(importer, { ...JSON.parse(await response.text()), portrait: FACE });
    assert.equal(arrived.status, 201);
    const xp = characters.getCharacter(arrived.json.character.id).xp;
    assert.equal(xp, 34000, `arrived with ${xp} XP`);
  },
);

await test("a character is exported by its owner and nobody else", async () => {
  const [mine] = library(author);
  const params = { params: Promise.resolve({ characterId: mine.id }) };
  world.signIn(importer);
  assert.equal((await route.exportOne.GET(new Request("http://test/"), params)).status, 404);
  signOut();
  assert.equal((await route.exportOne.GET(new Request("http://test/"), params)).status, 401);
  assert.equal((await call(route.importOne, "POST", bundleOf(heroInput()))).status, 401);
});

// ---- what is not a character file ----

await test("a file that is not a character file of this version is refused unread", async () => {
  const before = library(importer).length;
  const good = bundleOf(heroInput({ name: "Plain" }));
  for (const body of [
    "{ not json",
    "[]",
    "null",
    { ...good, kind: "odm.workshop" },
    { ...good, kind: undefined },
    { ...good, version: 2 },
    { ...good, version: "1" },
    { ...good, level: 0 },
    { ...good, level: 21 },
    { ...good, level: 25 },
    { ...good, level: 2.5 },
    { ...good, sheet: undefined },
    { ...good, portrait: { ...FACE, type: "image/jpeg" } },
    { ...good, portrait: { ...FACE, dataUrl: "data:text/html;base64,PGI+" } },
    { ...good, portrait: { ...FACE, dataUrl: "https://example.com/face.png" } },
  ]) {
    const response = await importAs(importer, body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 90));
  }
  const oversized = await importAs(importer, good, {
    "content-type": "application/json",
    "content-length": String(13 * 1024 * 1024),
  });
  assert.equal(oversized.status, 413);
  assert.equal(library(importer).length, before);
});

// ---- hostile sheets ----

// A level 1 fighter with Constitution 10 has 10 hit points, so the one thing
// wrong with each sheet below is the thing it names.
const sheet = (overrides) => heroInput({ name: "Edited", maxHp: 10, ...overrides });

// Each of these the builder's own door refuses.
const REFUSED = {
  "a negative purse": sheet({ gold: -50 }),
  "a hundred copper in the copper column": sheet({ copper: 100 }),
  "a score of 31": { ...sheet(), abilities: { ...sheet().abilities, str: 31 } },
  "a score of 0": { ...sheet(), abilities: { ...sheet().abilities, con: 0 } },
  "9999 hit points": sheet({ maxHp: 9999 }),
  "no hit points": sheet({ maxHp: 0 }),
  "armor class 40": sheet({ ac: 40 }),
  "a d20 hit die": sheet({ hitDice: { die: "d20", total: 1, spent: 0 } }),
  "four classes": sheet({
    classes: ["fighter", "rogue", "wizard", "cleric"].map((id) => ({ id, subclass: "", level: 1 })),
  }),
  "a class level of 25": sheet({ classes: [{ id: "fighter", subclass: "", level: 25 }] }),
  "sixty-one items": sheet({
    equipment: Array.from({ length: 61 }, (_, index) => ({ name: `Item ${index}`, qty: 1 })),
  }),
  "a portrait on another host": sheet({ portrait: { url: "https://example.com/x.png" } }),
  "no class at all": sheet({ class: "" }),
  "a tenth-level slot": sheet({
    class: "wizard",
    spellcasting: { ability: "int", slots: { 10: { max: 1, used: 0 } }, prepared: [], known: [], cantrips: [] },
  }),
};

await test("what the builder's door refuses, the import refuses", async () => {
  const before = library(importer).length;
  for (const [label, hostile] of Object.entries(REFUSED)) {
    world.signIn(importer);
    const made = await call(route.characters, "POST", { level: 1, sheet: { ...hostile, portrait: hostile.portrait ?? { url: "/uploads/enforce.png" } } });
    assert.equal(made.status, 400, `the builder's door took ${label}`);
    const filed = await importAs(importer, bundleOf(hostile));
    assert.equal(filed.status, 400, `the import took ${label}`);
  }
  assert.equal(library(importer).length, before);
});

await test("state the engine owns does not ride in on a file", async () => {
  const arrived = await importAs(
    importer,
    bundleOf({
      ...sheet({ name: "Smuggler", class: "barbarian", maxHp: 12 }),
      level: 20,
      xp: 355000,
      currentHp: 1,
      tempHp: 200,
      deathSaves: { successes: 3, failures: 0, stable: true, dead: false },
      resources: { rage: { max: 99, used: 0 } },
      conditions: ["invisible"],
      conditionMeta: { invisible: { rounds: 100 } },
      concentratingOn: "Haste",
      wildShape: { form: "Bear", beastHp: 300, beastMaxHp: 300, beastAc: 30 },
      exhaustion: 0,
      isCompanion: true,
      userId: author.id,
      id: library(author)[0].id,
    }),
  );
  assert.equal(arrived.status, 201, JSON.stringify(arrived.json));
  const stored = characters.getCharacter(arrived.json.character.id);
  assert.equal(stored.userId, importer.id);
  assert.equal(stored.level, 1);
  assert.equal(stored.xp, 0);
  for (const key of ["deathSaves", "resources", "conditions", "conditionMeta", "concentratingOn", "wildShape", "exhaustion", "currentHp", "tempHp", "isCompanion", "userId", "id", "level", "xp"]) {
    assert.equal(stored.sheet[key], undefined, `the library sheet holds ${key}`);
  }
  // Seated at a table, the sheet starts where the engine puts it.
  const table = await openWorld({ status: "lobby" });
  assert.ok(!("error" in joinByInviteCode(importer.id, table.campaign().inviteCode)));
  world.signIn(importer);
  const seated = await call(route.sheet, "POST", { libraryCharacterId: stored.id }, { campaignId: table.campaignId });
  assert.equal(seated.status, 201, JSON.stringify(seated.json));
  const [played] = table.sheets();
  assert.equal(played.level, 1);
  assert.equal(played.xp, 0);
  assert.equal(played.currentHp, played.maxHp);
  assert.equal(played.tempHp, 0);
  assert.deepEqual(played.conditions, []);
  assert.equal(played.deathSaves, null);
  assert.equal(played.wildShape, null);
  assert.equal(played.concentratingOn, null);
  // SRD barbarian table: two rages at 1st level.
  assert.deepEqual(played.resources.rage, { max: 2, used: 0 });
  assert.equal(played.isCompanion, false);
});

await test("a class feature of another class does not survive the import", async () => {
  const arrived = await importAs(
    importer,
    bundleOf(
      sheet({
        name: "Borrower",
        class: "wizard",
        maxHp: 6,
        features: [
          { name: "Rage", source: "class" },
          { name: "Sneak Attack", source: "class", level: 1 },
          { name: "Extra Attack", source: "class", classId: "fighter" },
        ],
      }),
    ),
  );
  assert.equal(arrived.status, 201, JSON.stringify(arrived.json));
  const names = characters.getCharacter(arrived.json.character.id).sheet.features.map((feature) => feature.name);
  for (const stolen of ["Rage", "Sneak Attack", "Extra Attack"]) {
    assert.ok(!names.includes(stolen), `${stolen} among ${names.join(", ")}`);
  }
  assert.ok(names.includes("Arcane Recovery"), names.join(", "));
});

await test(
  "An imported caster is held to the class tables like a new one: cantrips known, spells known or prepared, a wizard's starting book, and no spell above what its slots reach.",
  async () => {
    const hoarder = sheet({
      name: "Hoarder",
      class: "wizard",
      maxHp: 6,
      abilities: { int: 16 },
      spellcasting: {
        ability: "int",
        slots: { 1: { max: 2, used: 0 } },
        prepared: ["Wish", "Meteor Swarm", "Fireball", "Magic Missile"],
        known: [],
        cantrips: ["Fire Bolt", "Light", "Mage Hand", "Prestidigitation", "Ray of Frost", "Shocking Grasp"],
        spellbook: ["Wish", "Meteor Swarm", "Fireball", "Magic Missile"],
      },
    });
    world.signIn(importer);
    const made = await call(route.characters, "POST", { level: 1, sheet: { ...hoarder, portrait: { url: "/uploads/enforce.png" } } });
    assert.equal(made.status, 400, "the builder's door refuses this list");
    const filed = await importAs(importer, bundleOf(hoarder));
    const held = filed.json.character?.sheet.spellcasting;
    assert.equal(
      filed.status,
      400,
      `a level 1 wizard arrived with ${held?.prepared.join(", ")} prepared and ${held?.cantrips.length} cantrips`,
    );
  },
);

await test(
  "A character file is held to the rules a character is made under: scores to 20, hit points and hit dice that fit the level and class, three attuned items, a class the game has.",
  async () => {
    // Refused, or stored as the rule has it: either is the rule held. (As
    // written for the finding, this asked for a refusal alone; the server
    // now writes hit dice, attunement and the like itself, which holds the
    // rule as well as a refusal does.)
    const hostile = {
      "every score at 30": [{ ...sheet(), abilities: { str: 30, dex: 30, con: 30, int: 30, wis: 30, cha: 30 } }, (stored) => Object.values(stored.abilities).every((score) => score <= 20)],
      "500 hit points at level 1": [sheet({ maxHp: 500 }), (stored) => stored.maxHp === 10],
      "twenty d12 hit dice at level 1": [sheet({ class: "wizard", maxHp: 6, hitDice: { die: "d12", total: 20, spent: 0 } }), (stored) => stored.hitDice.die === "d6" && stored.hitDice.total === 1],
      "twelve attuned items": [
        sheet({ equipment: Array.from({ length: 12 }, (_, index) => ({ name: `Ring ${index}`, qty: 1, attuned: true })) }),
        (stored) => stored.equipment.filter((item) => item.attuned).length <= 3,
      ],
      "a class nobody wrote": [sheet({ class: "demigod" }), () => false],
      "a million gold": [sheet({ gold: 1000000 }), (stored) => stored.gold <= 225],
    };
    const taken = [];
    for (const [label, [body, legal]] of Object.entries(hostile)) {
      const filed = await importAs(importer, bundleOf(body));
      if (filed.status === 201 && !legal(characters.getCharacter(filed.json.character.id).sheet)) {
        taken.push(label);
      }
    }
    assert.deepEqual(taken, [], `stored as filed: ${taken.join("; ")}`);
  },
);

// ---- a workshop bundle ----

const workshopFile = (extra = {}) =>
  JSON.stringify({
    kind: "odm.workshop",
    version: 1,
    manifest: { name: "Borrowed Hall", blurb: "A hall.", inspiredBy: "nothing" },
    ...extra,
  });

await test("a bundle's variant rules pass through the settings schema", async () => {
  world.signIn(importer);
  const arrived = await call(route.workshop, "POST", {
    text: workshopFile({
      targetParty: { size: 4, level: 5 },
      variantRules: {
        flanking: "yes",
        encumbrance: true,
        restVariant: "epic",
        powerfulCritical: 1,
        homebrewCrits: true,
        __proto__: { polluted: true },
      },
    }),
  });
  assert.equal(arrived.status, 200, JSON.stringify(arrived.json));
  const workshop = getCampaignById(arrived.json.workshopId);
  assert.equal(workshop.kind, "workshop");
  assert.equal(workshop.ownerUserId, importer.id);
  assert.equal(workshop.startingLevel, 5);
  const rules = workshop.gameSettings.variantRules;
  assert.deepEqual(Object.keys(rules).sort(), [
    "ammunition", "criticalDamageMods", "criticalFumbles", "encumbrance", "flanking",
    "lingeringInjuries", "powerfulCritical", "restVariant",
  ]);
  assert.equal(rules.encumbrance, true);
  assert.equal(rules.flanking, false);
  assert.equal(rules.powerfulCritical, false);
  assert.equal(rules.restVariant, "standard");
});

await test("a bundle out of bounds writes nothing", async () => {
  world.signIn(importer);
  const owned = () =>
    getDatabase().prepare(`SELECT COUNT(*) AS n FROM campaigns WHERE owner_user_id = ?`).get(importer.id).n;
  const before = owned();
  const characterCount = library(importer).length;
  for (const text of [
    "{ not json",
    workshopFile({ kind: "odm.character" }),
    workshopFile({ version: 2 }),
    workshopFile({ manifest: { name: "", blurb: "x", inspiredBy: "y" } }),
    workshopFile({ targetParty: { size: 4, level: 21 } }),
    workshopFile({ pregens: [{ name: "Tall", level: 25, sheet: heroInput() }] }),
    workshopFile({ pregens: [{ name: "Rich", level: 1, sheet: heroInput({ gold: -1 }) }] }),
    workshopFile({ pregens: Array.from({ length: 13 }, () => ({ name: "Crowd", level: 1, sheet: heroInput() })) }),
    workshopFile({ homebrew: [{ kind: "monster", name: "Smuggled", data: {} }] }),
  ]) {
    const response = await call(route.workshop, "POST", { text });
    assert.equal(response.status, 400, text.slice(0, 90));
  }
  signOut();
  assert.equal((await call(route.workshop, "POST", { text: workshopFile() })).status, 401);
  assert.equal(owned(), before);
  assert.equal(library(importer).length, characterCount);
});

await test("a preview reads a bundle and writes nothing", async () => {
  world.signIn(importer);
  const before = getDatabase().prepare(`SELECT COUNT(*) AS n FROM campaigns`).get().n;
  const preview = await call(route.workshop, "POST", {
    preview: true,
    text: workshopFile({ houseRulesText: "No resting in the hall.", pregens: [{ name: "Guide", level: 3, sheet: heroInput() }] }),
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.counts.pregens, 1);
  assert.equal(preview.json.houseRules, true);
  assert.equal(getDatabase().prepare(`SELECT COUNT(*) AS n FROM campaigns`).get().n, before);
});

await settle();
world.close();
finish();
