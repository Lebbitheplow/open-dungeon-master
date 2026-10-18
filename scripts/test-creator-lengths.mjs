// Every name the character creator hands a sheet fits the sheet.
//
// A player finishing a character met "Too big: expected string to have <=80
// characters". The content pack's Lyceum Student, Con Artist, Destined and
// Diplomat carry kit lines the catalog has no item for, kept as the book
// wrote them ("A writing kit (small pouch with a quill, ink, folded
// parchment, and a small penknife)"), and a sheet holds an item name of 80.
// The pack druid's armor sentence (<=40, PR #72) was the same fault in
// another field, and a workshop entry could reach three more: a tool of up
// to 120 characters against a sheet's 60, a subclass name of 80 against 60,
// and a kit line of 200.
//
// So this builds what the builder offers: every bundled race, class and
// background, every alternative of every kit choice, the content pack's when
// it is installed, and workshop entries at the longest each field saves as.
// Every payload is held to the schema. The races, the backgrounds' first kit
// choices and the workshop entries are also saved, as a player would send
// them with every pick made: each must be stored in the library and at the
// table, and those stored sheets held to the schema too, since joining a
// table, a lobby edit or a level-up sends them back. Clipping a name is not
// enough on its own: a clipped language or tool must still be the grant it
// was cut from, or the server reads it as a pick (a tongue the species
// grants refused as a language the player chose). Classes, subclasses, pack
// feats and the other kit alternatives are checked as payloads only.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openCreation } from "./lib/enforce-creation.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";

const { test, finish } = suite("test-creator-lengths");
const { world, player, call, throughLibrary, atTable } = await openCreation();
const builder = await openBuilder();
const { createSheetSchema, patchSheetSchema, equipmentItemSchema, fitItemName, fitName, ITEM_NAME_MAX, LANGUAGE_NAME_MAX, TOOL_NAME_MAX } = await import(
  "../src/lib/schemas/sheet.ts"
);
const content = await import("../src/lib/content/index.ts");
const { contentPackInstalled } = await import("../src/lib/content/db.ts");
const { packRaceOptions } = await import("../src/lib/content/race-options.ts");
const { mergedBackgroundOptions, packClassOptions, splitPurse } = await import("../src/lib/characters/options.ts");
const { expandBackgroundGear, gearAlternatives } = await import("../src/lib/srd/gear-choices.ts");
const { racialFeatCount } = await import("../src/lib/srd/race-id.ts");
const { repeatedGrants, takesDraconicAncestry } = await import("../src/lib/srd/racial-grants.ts");
const { STANDARD_LANGUAGES } = await import("../src/lib/content/mechanics.ts");
const { SRD_SKILLS } = await import("../src/lib/srd/index.ts");
const { bonusLanguageCount } = await import("../src/app/characters/builder/submit.ts");
const hasPack = contentPackInstalled();

// Every length the schema refuses, by path, with the value refused.
function tooLong(schema, sheet) {
  const parsed = schema.safeParse(sheet);
  if (parsed.success) {
    return [];
  }
  return parsed.error.issues
    .filter((issue) => issue.code === "too_big" && issue.origin === "string")
    .map((issue) => {
      const value = issue.path.reduce((at, key) => at?.[key], sheet);
      return `${issue.path.join(".")} <=${issue.maximum}: ${String(value).slice(0, 120)}`;
    });
}

// The builder's payload, refused for no length; then, with `server`, the
// same character through the library onto the table, stored, and its stored
// sheets refused for no length either.
async function holds(label, fields, { server = false } = {}) {
  const { sheet, level } = builder.build(fields);
  assert.ok(sheet, `${label}: the builder made no sheet`);
  assert.deepEqual(tooLong(createSheetSchema, sheet), [], `${label}: the builder's payload`);
  if (!server) {
    return { sheet, result: null };
  }
  const { blocker } = builder.build(fields);
  assert.equal(blocker, null, `${label}: the builder would not let this through: ${blocker?.message}`);
  const result = await throughLibrary(sheet, level ?? 1);
  assert.ok(result.status < 400, `${label}: refused ${result.status}: ${result.error}`);
  for (const [door, stored] of [["library", result.character?.sheet], ["table", result.sheet]]) {
    assert.ok(stored, `${label}: no ${door} sheet was stored`);
    assert.deepEqual(tooLong(createSheetSchema, stored), [], `${label}: the ${door} sheet sent back whole`);
    assert.deepEqual(tooLong(patchSheetSchema, stored), [], `${label}: the ${door} sheet sent back as a level-up`);
  }
  return { sheet, result };
}

// Each alternative of each either-or kit line, the others at the book's first.
function kitPicks(background) {
  const lines = (background.equipment ?? []).map((line) => gearAlternatives(line)).filter(Boolean);
  return lines.flatMap((alternatives, at) =>
    alternatives.slice(1).map((alternative) => lines.map((each, index) => (index === at ? alternative.label : each[0].label))),
  );
}

const fighter = builder.classes.find((entry) => entry.id === "fighter");
const wizard = builder.classes.find((entry) => entry.id === "wizard");
const human = builder.races.find((entry) => entry.id === "human");
const variantHuman = builder.races.find((entry) => entry.id === "variant_human");
const acolyte = builder.backgrounds.find((entry) => entry.id === "acolyte");
// The picks the identity and ancestry steps owe before Continue lets a
// player on (src/app/characters/builder/submit.ts), each answered with the
// first choice offered, so a case reaches the server as a player would send
// it and a refusal there is the server's, not a missing pick.
const skillKey = (skill) => String(skill).trim().toLowerCase().replace(/\s+/g, "_");
const CANTRIPS = { wizard: "Fire Bolt", sorcerer: "Fire Bolt", cleric: "Guidance", druid: "Druidcraft", bard: "Vicious Mockery", warlock: "Eldritch Blast" };
function picksFor(race, background = acolyte, klass = fighter) {
  const spoken = new Set([...(race.languages ?? []), ...(background.knownLanguages ?? [])].map((name) => name.toLowerCase()));
  const languages = [...new Set([...(race.languageChoice?.from ?? []), ...STANDARD_LANGUAGES])]
    .filter((name) => !spoken.has(name.toLowerCase()))
    .slice(0, bonusLanguageCount(race, background));
  const held = new Set([...(race.skills ?? []), ...(background.skills ?? [])].map(skillKey));
  const take = (count, from = SRD_SKILLS.map((skill) => skill.id)) => {
    const picked = from.map(skillKey).filter((skill) => !held.has(skill)).slice(0, count);
    picked.forEach((skill) => held.add(skill));
    return picked;
  };
  const backgroundSkills = background.skillChoice ? take(background.skillChoice.count, background.skillChoice.from) : [];
  const racialSkills = race.skillChoice ? take(race.skillChoice.count, race.skillChoice.from) : [];
  const repeatSkills = take(repeatedGrants(background.skills, race.skills).length);
  const chosenSkills = klass.skillChoices ? take(klass.skillChoices.count, klass.skillChoices.from) : [];
  return {
    race,
    background,
    class: klass,
    chosenSkills,
    stylePicks: klass.id === "fighter" ? ["Defense"] : [],
    bonusLanguages: languages,
    backgroundSkills,
    racialSkills,
    repeatSkills,
    // Never one the race already raises, as the builder's reconcile drops.
    racialAsi: race.asiChoice
      ? (race.asiChoice.from ?? ["str", "dex", "con", "int", "wis", "cha"]).filter((ability) => !race.asi?.[ability]).slice(0, race.asiChoice.count)
      : [],
    racialTool: race.toolChoice?.from?.[0] ?? "",
    racialCantrip: race.cantripChoice ? (CANTRIPS[race.cantripChoice.list] ?? "Light") : "",
    racialAncestry: takesDraconicAncestry(race.id) ? "red" : "",
    feats: racialFeatCount(race.id) ? ["Alert"] : [],
  };
}

// The content pack's four, as its rows write them.
const PACK_LINES = [
  [
    "a writing kit (small pouch with a quill, ink, folded parchment, and a small penknife)",
    "A writing kit",
  ],
  [
    "tools for your typical con (such as bottles full of colored water, a set of weighted dice, a deck of marked or filed cards, or a seal from an imaginary-or real-noble)",
    "Tools for your typical con",
  ],
  [
    "a memento of your destiny (a keepsake from your betrothed, the seal of your destined office, your family signet ring, or similar)",
    "A memento of your destiny",
  ],
  [
    "a letter of passage from a local minor authority or traveling papers that signify you as a traveling diplomat",
    "A letter of passage from a local minor authority",
  ],
];

await test("a kit line longer than an item name loses its detail, then its other alternatives, then its last words", () => {
  for (const [line, name] of PACK_LINES) {
    assert.deepEqual(expandBackgroundGear(splitPurse([line]).equipment, { tools: [], backgroundTools: [], picks: [] }).names, [name]);
  }
  assert.equal(fitItemName("Hempen rope"), "Hempen rope");
  const words = fitItemName(`A ${"very ".repeat(30)}long thing`);
  assert.ok(words.length <= ITEM_NAME_MAX && words.endsWith("very…"), words);
  const unbroken = fitItemName("x".repeat(200));
  assert.equal(unbroken.length, ITEM_NAME_MAX);
});

await test("an app built before the fit sends the line whole, and the sheet takes the name the server's kit gives", () => {
  for (const [line, name] of PACK_LINES) {
    const sent = splitPurse([line]).equipment[0];
    assert.ok(sent.length > ITEM_NAME_MAX, sent);
    assert.equal(equipmentItemSchema.parse({ name: sent }).name, name);
  }
});

await test("a portrait's file name is clipped, never refused", () => {
  const sheet = builder.build({ race: "human", class: "fighter", background: "acolyte" }).sheet;
  const portrait = { id: "p1", name: `${"a".repeat(240)}.png`, type: "image/png", url: "/uploads/p1.png" };
  const parsed = createSheetSchema.parse({ ...sheet, portrait });
  assert.equal(parsed.portrait.name.length, 120);
});

await test("the upload names a file within what a sheet's portrait holds", async () => {
  const route = await world.route("upload");
  world.signIn(player);
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const response = await call(route, "POST", { dataUrl: `data:image/png;base64,${png}`, name: `${"b".repeat(300)}.png`, type: "image/png" });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(response.json.name.length, 120);
});

await test("every bundled background, with every alternative of its kit, fits the sheet", async () => {
  for (const background of builder.backgrounds) {
    await holds(`background ${background.id}`, { ...picksFor(human, background), class: fighter }, { server: true });
    for (const picks of kitPicks(background)) {
      await holds(`background ${background.id} ${picks}`, { ...picksFor(human, background), class: fighter, backgroundGearPicks: picks });
    }
  }
});

await test("every bundled race and class, at levels 1, 3 and 20, fits the sheet", async () => {
  for (const race of builder.races) {
    await holds(`race ${race.id}`, { ...picksFor(race), class: fighter }, { server: true });
  }
  for (const klass of builder.classes) {
    for (const level of [1, 3, 20]) {
      await holds(`class ${klass.id} ${level}`, { ...picksFor(human, acolyte), class: klass, level });
    }
  }
});

// Workshop entries saved through the real route, so each field is as long as
// the workshop's own normalizer lets it be (src/lib/homebrew/*-data.ts).
const brewRoute = await world.route("homebrew");
const prose = "the wandering cartographer of the shattered coast and drowned isles beyond the grey reach ".repeat(10);
const long = (count) => prose.slice(0, count).trim().replace(/^./, (first) => first.toUpperCase());
async function brew(kind, name, data, user = player) {
  world.signIn(user);
  const response = await call(brewRoute, "POST", { kind, name, data });
  assert.equal(response.status, 201, `${kind}: ${JSON.stringify(response.json)}`);
}
await brew("background", long(80), {
  desc: "A background at every limit.",
  grants: {
    skills: ["history", "insight"],
    tools: [long(120)],
    languages: 1,
    knownLanguages: [long(30)],
    equipment: [...PACK_LINES.map(([line]) => line), long(200), `A dagger or ${long(150)}`],
    purse: 10,
  },
  feature: long(80),
  feature_desc: long(400),
});
await brew("background", `${long(70)} prose`, {
  desc: "A background written in prose, as one saved before the pickers.",
  skill_proficiencies: "History, Insight",
  tool_proficiencies: long(200),
  languages: `${long(120)}, and one of your choice`,
  equipment: `${long(200)}, a belt pouch containing 10 gp`,
  feature: long(80),
  feature_desc: long(400),
});
await brew("race", long(80), {
  desc: "A species at every limit.",
  asi: [{ attributes: ["Constitution"], value: 2 }],
  speed: { walk: 30 },
  languages: [long(30), "Common"],
  bonusLanguages: 1,
  tools: [long(40)],
  armor: [long(40)],
  weapons: [long(40)],
  traits: `***${long(200)}.*** ${long(300)}\n\n***${long(60)}.*** ${long(300)}`,
});
// A tongue is read out of prose only as capitalised words
// (src/lib/content/mechanics.ts), so the long one is written that way.
const TONGUE = "Ancient Celestial Courtly Tongue Of The Secluded Northern Celestial Kingdom";
await brew("race", `${long(70)} prose`, {
  desc: "A species written in prose.",
  asi: [{ attributes: ["Wisdom"], value: 2 }],
  speed: { walk: 30 },
  languages: `You can speak, read, and write Common and ${`${TONGUE} `.repeat(4).slice(0, 250).trim()}.`,
  traits: `***${long(90)}.*** ${long(300)}`,
});
// A species whose one tongue past a sheet's 40 characters leaves no language
// to choose, beside a background that grants none either: the clipped copy a
// sheet keeps must still be the grant, not a pick there is no slot for.
// Each is written twice: on the player's shelf for the library, and on the
// owner's for the table, which counts only the workshop of whoever runs it.
const SPEAKER = {
  desc: "A species speaking a long-named tongue.",
  asi: [{ attributes: ["Charisma"], value: 2 }],
  speed: { walk: 30 },
  languages: `You can speak, read, and write Common and ${TONGUE}.`,
};
// The same for a tool: a workshop background's tool runs to 120 characters,
// a sheet's to 60, and an open grant beside it reads every other tool sent as
// its pick.
const HERALD = {
  desc: "A background granting a long-named tool beside an open one.",
  grants: { skills: ["history", "persuasion"], tools: [long(120), "one type of gaming set"], languages: 0, equipment: ["A signet ring"], purse: 10 },
  feature: "Herald",
  feature_desc: "Doors open.",
};
for (const user of [player, world.owner]) {
  await brew("race", "Courtly Speaker", SPEAKER, user);
  await brew("background", "Courtly Herald", HERALD, user);
}
await brew("archetype", long(80), { desc: long(400), classSlug: "fighter" });
await brew("feat", long(80), { desc: "You gain proficiency in one skill of your choice." });
await brew("spell", long(80), { desc: long(200), level: 0, school: "evocation", classes: ["wizard"] });
await brew("spell", long(79), { desc: long(200), level: 1, school: "evocation", classes: ["wizard"] });
const mine = { limit: 1000, userIds: [player.id] };
const theTables = { limit: 1000, userIds: [world.owner.id] };
const brewed = (rows) => rows.filter((row) => String(row.slug ?? row.id).startsWith("homebrew:"));

await test("a workshop background at every limit fits the sheet, kit, tools and all", async () => {
  const backgrounds = brewed(mergedBackgroundOptions(content.listBackgrounds(mine))).filter((entry) => entry.name !== "Courtly Herald");
  assert.equal(backgrounds.length, 2);
  for (const background of backgrounds) {
    const { sheet } = await holds(`workshop background ${background.name}`, { ...picksFor(human, background), class: fighter }, { server: true });
    assert.ok(sheet.equipment.every((item) => item.name.length <= ITEM_NAME_MAX));
    for (const picks of kitPicks(background)) {
      await holds(`workshop background ${picks}`, { ...picksFor(human, background), class: fighter, backgroundGearPicks: picks }, { server: true });
    }
  }
  const kit = backgrounds.find((background) => background.name === long(80));
  const { sheet } = await holds("the pack's four lines", { ...picksFor(human, kit), class: fighter });
  // A workshop kit is kept in the author's own case, untidied.
  for (const [, name] of PACK_LINES) {
    assert.ok(sheet.equipment.some((item) => item.name.toLowerCase() === name.toLowerCase()), name);
  }
});

await test("a workshop species at every limit fits the sheet", async () => {
  const races = brewed(packRaceOptions(content.listRaces(mine))).filter((race) => race.name !== "Courtly Speaker");
  assert.equal(races.length, 2);
  for (const race of races) {
    await holds(`workshop species ${race.name}`, { ...picksFor(race), class: fighter }, { server: true });
  }
  // The prose was read as a tongue, not passed over.
  const prose = races.find((race) => race.name.endsWith(" prose"));
  assert.ok(prose.languages.some((language) => language.startsWith("Ancient Celestial")), prose.languages.join(", "));
});

// One name, once: the stored copy of a long grant is the name the grant
// itself fits to.
function holdsOnce(list, name, label) {
  assert.equal(list.filter((entry) => entry.toLowerCase() === name.toLowerCase()).length, 1, `${label}: ${list.join(", ")}`);
}

await test("a long tongue a workshop species grants is its grant at every door: library, table, an edit, an old app's whole name", async () => {
  const race = brewed(packRaceOptions(content.listRaces(mine))).find((entry) => entry.name === "Courtly Speaker");
  const soldier = builder.backgrounds.find((entry) => entry.id === "soldier");
  const fitted = fitName(TONGUE, LANGUAGE_NAME_MAX);
  assert.ok(fitted.length <= LANGUAGE_NAME_MAX && fitted.endsWith("…"), fitted);
  assert.deepEqual(race.languages, ["Common", fitted], "the grant is the name a sheet keeps");
  assert.equal(bonusLanguageCount(race, soldier), 0, "nothing left to choose");
  const fields = { ...picksFor(race, soldier), class: fighter };
  const built = builder.build(fields);
  assert.equal(built.blocker, null, built.blocker?.message);
  assert.deepEqual(createSheetSchema.parse(built.sheet).proficiencies.languages, ["Common", fitted]);

  const library = await holds("long tongue, library", fields, { server: true });
  holdsOnce(library.result.character.sheet.proficiencies.languages, fitted, "library");
  holdsOnce(library.result.sheet.proficiencies.languages, fitted, "table copy");

  const tableRace = brewed(packRaceOptions(content.listRaces(theTables))).find((entry) => entry.name === "Courtly Speaker");
  const atTheTable = builder.build({ ...picksFor(tableRace, soldier), class: fighter });
  assert.equal(atTheTable.blocker, null, atTheTable.blocker?.message);
  const table = await atTable(atTheTable.sheet);
  assert.equal(table.status, 201, table.error);
  holdsOnce(table.sheet.proficiencies.languages, fitted, "made at the table");

  // An app built before the fit names the tongue whole.
  const whole = { ...built.sheet, proficiencies: { ...built.sheet.proficiencies, languages: ["Common", TONGUE] } };
  const old = await throughLibrary(whole, 1);
  assert.ok(old.status < 400, old.error);
  holdsOnce(old.character.sheet.proficiencies.languages, fitted, "sent whole");

  // The stored sheet sent back as an edit, and the builder's own edit.
  const editRoute = await world.route("characters/[characterId]");
  const stored = library.result.character;
  for (const [label, sheet] of [
    ["stored sheet", { ...stored.sheet, name: "Renamed" }],
    ["builder edit", { ...builder.build({ ...fields, name: "Renamed Again" }).sheet, portrait: stored.sheet.portrait }],
  ]) {
    world.signIn(player);
    const saved = await call(editRoute, "PATCH", { level: 1, sheet }, { characterId: stored.id });
    assert.equal(saved.status, 200, `${label}: ${saved.json.error}`);
    holdsOnce(saved.json.character.sheet.proficiencies.languages, fitted, label);
  }
});

await test("a long tool a workshop background grants beside an open one is its grant, not a pick: library, table, an edit", async () => {
  const herald = brewed(mergedBackgroundOptions(content.listBackgrounds(mine))).find((entry) => entry.name === "Courtly Herald");
  const fitted = fitName(long(120), TOOL_NAME_MAX);
  const fields = { ...picksFor(human, herald), class: fighter };
  const built = builder.build(fields);
  assert.equal(built.blocker, null, built.blocker?.message);
  const library = await holds("long tool, library", fields, { server: true });
  for (const [label, sheet] of [["library", library.result.character.sheet], ["table copy", library.result.sheet]]) {
    holdsOnce(sheet.proficiencies.tools, fitted, label);
    assert.ok(!sheet.proficiencies.tools.some((tool) => /one type of gaming set/i.test(tool)), `${label}: the pick replaces the grant's words`);
  }
  const tableHerald = brewed(mergedBackgroundOptions(content.listBackgrounds(theTables))).find((entry) => entry.name === "Courtly Herald");
  const atTheTable = builder.build({ ...picksFor(human, tableHerald), class: fighter });
  assert.equal(atTheTable.blocker, null, atTheTable.blocker?.message);
  const table = await atTable(atTheTable.sheet);
  assert.equal(table.status, 201, table.error);
  holdsOnce(table.sheet.proficiencies.tools, fitted, "made at the table");
  const editRoute = await world.route("characters/[characterId]");
  const stored = library.result.character;
  world.signIn(player);
  const saved = await call(editRoute, "PATCH", { level: 1, sheet: { ...stored.sheet, name: "Renamed" } }, { characterId: stored.id });
  assert.equal(saved.status, 200, saved.json.error);
  holdsOnce(saved.json.character.sheet.proficiencies.tools, fitted, "edited");
});

await test("a workshop subclass, feat and spells named at the workshop's 80 characters fit the sheet", async () => {
  const [subclass] = brewed(content.listArchetypes("fighter", mine));
  await holds("workshop subclass", { ...picksFor(human, acolyte), class: fighter, level: 3, subclass: subclass.name }, { server: true });
  const [feat] = brewed(content.searchFeats({ ...mine, q: long(20) }));
  const key = feat.name.toLowerCase();
  await holds(
    "workshop feat",
    {
      ...picksFor(variantHuman, acolyte),
      class: fighter,
      feats: [feat.name],
      featChoices: { [key]: { skills: ["athletics"] } },
      featDescs: { [key]: String(feat.data?.desc ?? "") },
    },
    { server: true },
  );
  const spells = brewed(content.searchSpells({ ...mine, q: long(20) }));
  const level = (spell) => Number(spell.data?.level ?? spell.level);
  await holds("workshop spells", {
    ...picksFor(human, acolyte),
    class: wizard,
    cantrips: spells.filter((spell) => level(spell) === 0).map((spell) => spell.name),
    spells: spells.filter((spell) => level(spell) !== 0).map((spell) => spell.name),
  });
});

if (hasPack) {
  const races = packRaceOptions(content.listRaces({ limit: 1000 }));
  const classes = packClassOptions(content.listClasses({ limit: 1000 }));
  const backgrounds = mergedBackgroundOptions(content.listBackgrounds({ limit: 1000 }));

  await test("every content pack background, with every alternative of its kit, fits the sheet", async () => {
    for (const background of backgrounds) {
      await holds(`pack background ${background.id}`, { ...picksFor(human, background), class: fighter }, { server: true });
      for (const picks of kitPicks(background)) {
        await holds(`pack background ${background.id} ${picks}`, { ...picksFor(human, background), class: fighter, backgroundGearPicks: picks });
      }
    }
  });

  await test("every content pack race fits the sheet", async () => {
    for (const race of races) {
      await holds(`pack race ${race.id}`, { ...picksFor(race), class: fighter }, { server: true });
    }
  });

  await test("every content pack class and subclass fits the sheet", async () => {
    for (const klass of classes) {
      for (const level of [1, 3, 20]) {
        await holds(`pack class ${klass.id} ${level}`, { ...picksFor(human, acolyte), class: klass, level });
      }
      for (const row of content.listArchetypes(klass.id, { limit: 1000 })) {
        await holds(`pack subclass ${row.name}`, { ...picksFor(human, acolyte), class: klass, level: 20, subclass: row.name });
      }
    }
  });

  await test("every content pack feat fits the sheet", async () => {
    for (const feat of content.searchFeats({ limit: 2000 })) {
      const featDescs = { [feat.name.trim().toLowerCase()]: String(feat.data?.desc ?? "") };
      await holds(`pack feat ${feat.name}`, { ...picksFor(variantHuman, acolyte), class: fighter, feats: [feat.name], featDescs });
    }
  });
}

finish();
