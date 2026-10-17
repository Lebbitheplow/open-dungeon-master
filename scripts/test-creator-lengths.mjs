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
// Each sheet is held to the schema at every door: the payload the builder
// sends, and the stored sheets (library and table) that joining a table, a
// lobby edit or a level-up sends back.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openCreation } from "./lib/enforce-creation.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";

const { test, finish } = suite("test-creator-lengths");
const { world, player, call, throughLibrary } = await openCreation();
const builder = await openBuilder();
const { createSheetSchema, patchSheetSchema, equipmentItemSchema, fitItemName, ITEM_NAME_MAX } = await import(
  "../src/lib/schemas/sheet.ts"
);
const content = await import("../src/lib/content/index.ts");
const { contentPackInstalled } = await import("../src/lib/content/db.ts");
const { packRaceOptions } = await import("../src/lib/content/race-options.ts");
const { mergedBackgroundOptions, packClassOptions, splitPurse } = await import("../src/lib/characters/options.ts");
const { expandBackgroundGear, gearAlternatives } = await import("../src/lib/srd/gear-choices.ts");
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
  const result = await throughLibrary(sheet, level ?? 1);
  assert.doesNotMatch(String(result.error ?? ""), /too big|too small|expected string/i, `${label}: ${result.error}`);
  for (const [door, stored] of [["library", result.character?.sheet], ["table", result.sheet]]) {
    if (stored) {
      assert.deepEqual(tooLong(createSheetSchema, stored), [], `${label}: the ${door} sheet sent back whole`);
      assert.deepEqual(tooLong(patchSheetSchema, stored), [], `${label}: the ${door} sheet sent back as a level-up`);
    }
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
    await holds(`background ${background.id}`, { race: human, class: fighter, background }, { server: true });
    for (const picks of kitPicks(background)) {
      await holds(`background ${background.id} ${picks}`, { race: human, class: fighter, background, backgroundGearPicks: picks });
    }
  }
});

await test("every bundled race and class, at levels 1, 3 and 20, fits the sheet", async () => {
  for (const race of builder.races) {
    await holds(`race ${race.id}`, { race, class: fighter, background: acolyte, racialTool: race.toolChoice?.from?.[0] ?? "" }, { server: true });
  }
  for (const klass of builder.classes) {
    for (const level of [1, 3, 20]) {
      await holds(`class ${klass.id} ${level}`, { race: human, class: klass, background: acolyte, level });
    }
  }
});

// Workshop entries saved through the real route, so each field is as long as
// the workshop's own normalizer lets it be (src/lib/homebrew/*-data.ts).
const brewRoute = await world.route("homebrew");
const prose = "the wandering cartographer of the shattered coast and drowned isles beyond the grey reach ".repeat(10);
const long = (count) => prose.slice(0, count).trim().replace(/^./, (first) => first.toUpperCase());
async function brew(kind, name, data) {
  world.signIn(player);
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
await brew("race", `${long(70)} prose`, {
  desc: "A species written in prose.",
  asi: [{ attributes: ["Wisdom"], value: 2 }],
  speed: { walk: 30 },
  languages: `You can speak, read, and write Common and ${long(250)}.`,
  traits: `***${long(90)}.*** ${long(300)}`,
});
await brew("archetype", long(80), { desc: long(400), classSlug: "fighter" });
await brew("feat", long(80), { desc: "You gain proficiency in one skill of your choice." });
await brew("spell", long(80), { desc: long(200), level: 0, school: "evocation", classes: ["wizard"] });
await brew("spell", long(79), { desc: long(200), level: 1, school: "evocation", classes: ["wizard"] });
const mine = { limit: 1000, userIds: [player.id] };
const brewed = (rows) => rows.filter((row) => String(row.slug ?? row.id).startsWith("homebrew:"));

await test("a workshop background at every limit fits the sheet, kit, tools and all", async () => {
  const backgrounds = brewed(mergedBackgroundOptions(content.listBackgrounds(mine)));
  assert.equal(backgrounds.length, 2);
  for (const background of backgrounds) {
    const { sheet } = await holds(`workshop background ${background.name}`, { race: human, class: fighter, background }, { server: true });
    assert.ok(sheet.equipment.every((item) => item.name.length <= ITEM_NAME_MAX));
    for (const picks of kitPicks(background)) {
      await holds(`workshop background ${picks}`, { race: human, class: fighter, background, backgroundGearPicks: picks }, { server: true });
    }
  }
  const kit = backgrounds.find((background) => background.name === long(80));
  const { sheet } = await holds("the pack's four lines", { race: human, class: fighter, background: kit });
  // A workshop kit is kept in the author's own case, untidied.
  for (const [, name] of PACK_LINES) {
    assert.ok(sheet.equipment.some((item) => item.name.toLowerCase() === name.toLowerCase()), name);
  }
});

await test("a workshop species at every limit fits the sheet", async () => {
  const races = brewed(packRaceOptions(content.listRaces(mine)));
  assert.equal(races.length, 2);
  for (const race of races) {
    await holds(`workshop species ${race.name}`, { race, class: fighter, background: acolyte }, { server: true });
  }
});

await test("a workshop subclass, feat and spells named at the workshop's 80 characters fit the sheet", async () => {
  const [subclass] = brewed(content.listArchetypes("fighter", mine));
  await holds("workshop subclass", { race: human, class: fighter, background: acolyte, level: 3, subclass: subclass.name }, { server: true });
  const [feat] = brewed(content.searchFeats({ ...mine, q: long(20) }));
  const key = feat.name.toLowerCase();
  await holds(
    "workshop feat",
    {
      race: variantHuman,
      class: fighter,
      background: acolyte,
      feats: [feat.name],
      featChoices: { [key]: { skills: ["athletics"] } },
      featDescs: { [key]: String(feat.data?.desc ?? "") },
    },
    { server: true },
  );
  const spells = brewed(content.searchSpells({ ...mine, q: long(20) }));
  const level = (spell) => Number(spell.data?.level ?? spell.level);
  await holds("workshop spells", {
    race: human,
    class: wizard,
    background: acolyte,
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
      await holds(`pack background ${background.id}`, { race: human, class: fighter, background }, { server: true });
      for (const picks of kitPicks(background)) {
        await holds(`pack background ${background.id} ${picks}`, { race: human, class: fighter, background, backgroundGearPicks: picks });
      }
    }
  });

  await test("every content pack race fits the sheet", async () => {
    for (const race of races) {
      await holds(`pack race ${race.id}`, { race, class: fighter, background: acolyte, racialTool: race.toolChoice?.from?.[0] ?? "" }, { server: true });
    }
  });

  await test("every content pack class and subclass fits the sheet", async () => {
    for (const klass of classes) {
      for (const level of [1, 3, 20]) {
        await holds(`pack class ${klass.id} ${level}`, { race: human, class: klass, background: acolyte, level });
      }
      for (const row of content.listArchetypes(klass.id, { limit: 1000 })) {
        await holds(`pack subclass ${row.name}`, { race: human, class: klass, background: acolyte, level: 20, subclass: row.name });
      }
    }
  });

  await test("every content pack feat fits the sheet", async () => {
    for (const feat of content.searchFeats({ limit: 2000 })) {
      const featDescs = { [feat.name.trim().toLowerCase()]: String(feat.data?.desc ?? "") };
      await holds(`pack feat ${feat.name}`, { race: variantHuman, class: fighter, background: acolyte, feats: [feat.name], featDescs });
    }
  });
}

finish();
