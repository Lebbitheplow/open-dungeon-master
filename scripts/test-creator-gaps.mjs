// Issues 115 to 118 in the character creator: a third-party race under a
// bundled slug gets its own id (Tome of Heroes' Drow is not the SRD drow),
// a race the bundled documents print twice is offered once, every pack row
// names its book, Level Up rules this engine cannot play stay out of the
// 2014 spell list, racial cantrips do not count as class cantrips, and each
// step blocker says where its missing pick is.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { packRaceOptions, optionIdFor, srdRaceFor } = await import("../src/lib/content/race-options.ts");
const { servedSpellRows } = await import("../src/lib/content/spell-overrides.ts");
const { reconcilePicks } = await import("../src/app/characters/builder/reconcile.ts");
const { innateCantripsFor } = await import("../src/lib/srd/racial-grants.ts");
const { racialTraitsFor } = await import("../src/lib/srd/features.ts");
const { hpBonusPerLevel } = await import("../src/lib/srd/race-id.ts");
const { srdRaceOptions, srdClassOptions, srdBackgroundOptions } = await import("../src/lib/characters/options.ts");
const submit = await import("../src/app/characters/builder/submit.ts");

let failed = 0;
async function test(name, run) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`not ok - ${name}`);
    console.log(error);
  }
}

const srdDrow = {
  slug: "odm-drow",
  name: "Elf (Drow)",
  documentSlug: "odm-expanded",
  document: "Open Dungeon Master Expanded Options",
  data: { asi: [{ attributes: ["Dexterity"], value: 2 }, { attributes: ["Charisma"], value: 1 }], speed: { walk: 30 }, languages: "Common and Elvish." },
};
const tohDrow = {
  slug: "drow",
  name: "Drow",
  documentSlug: "toh",
  document: "Tome of Heroes",
  data: {
    asi: [{ attributes: ["Intelligence"], value: 2 }],
    speed: { walk: 25 },
    languages: "You can speak, read, and write Common and Elvish.",
    traits: "**_Fey Ancestry._** Charms.\n\n**_Mind of Steel._** Steel.\n\n**_Sunlight Sensitivity._** Sun.",
  },
};
const highElf = { slug: "high-elf", name: "High Elf", documentSlug: "wotc-srd", document: "5e Core Rules", data: { asi: [{ attributes: ["Intelligence"], value: 1 }], parent_slug: "elf" } };
const odmHighElf = { slug: "odm-high-elf", name: "Elf (High)", documentSlug: "odm-expanded", document: "Open Dungeon Master Expanded Options", data: { asi: [{ attributes: ["Dexterity"], value: 2 }, { attributes: ["Intelligence"], value: 1 }], speed: { walk: 30 } } };
const elf = { slug: "elf", name: "Elf", documentSlug: "wotc-srd", document: "5e Core Rules", data: { asi: [{ attributes: ["Dexterity"], value: 2 }], speed: { walk: 30 }, languages: "Common and Elvish." } };

await test("a third-party race under a bundled slug is its own race, under an id no SRD reader matches (issue 115)", () => {
  assert.equal(optionIdFor(tohDrow), "toh-drow");
  assert.equal(optionIdFor(srdDrow), "odm-drow");
  const options = packRaceOptions([elf, srdDrow, tohDrow]);
  const toh = options.find((entry) => entry.id === "toh-drow");
  assert.ok(toh, "the Tome of Heroes drow is offered");
  assert.deepEqual(toh.asi, { int: 2 });
  assert.equal(toh.speed, 25);
  assert.equal(toh.slug, "drow", "its pack row is still the slug the pack uses");
  assert.equal(toh.source, "Tome of Heroes");
  assert.equal(toh.traitsSummary, "Fey Ancestry · Mind of Steel · Sunlight Sensitivity");
  // Every reader that keys a race by srdRaceId now answers for the pack row
  // and not the SRD drow.
  assert.equal(srdRaceFor("toh-drow"), null);
  assert.deepEqual(innateCantripsFor("toh-drow", 5), []);
  assert.deepEqual(racialTraitsFor("toh-drow"), []);
  assert.equal(hpBonusPerLevel("toh-drow"), 0);
  // The SRD drow is untouched.
  const srd = options.find((entry) => entry.id === "odm-drow");
  assert.deepEqual(srd.asi, { dex: 2, cha: 1 });
  assert.deepEqual(innateCantripsFor("odm-drow", 1), ["Dancing Lights"]);
  assert.equal(srd.source, "Open Dungeon Master Expanded Options");
});

await test("a stored Tome of Heroes drow keeps its row in an edit, under whichever id it was saved", () => {
  const options = packRaceOptions([elf, srdDrow, tohDrow], ["toh-drow"]);
  assert.ok(options.find((entry) => entry.id === "toh-drow"));
  // A sheet saved before the prefix names the bare slug; it still edits
  // onto the Tome of Heroes row rather than falling to the first card.
  const legacy = packRaceOptions([elf, srdDrow, tohDrow], ["drow"]);
  const row = legacy.find((entry) => entry.id === "drow");
  assert.ok(row);
  assert.equal(row.speed, 25);
  assert.equal(legacy.some((entry) => entry.id === "toh-drow"), false);
});

await test("a race the bundled documents print twice is offered once, the SRD's copy (issue 116)", () => {
  const options = packRaceOptions([elf, highElf, odmHighElf, srdDrow]);
  const ids = options.map((entry) => entry.id);
  assert.ok(ids.includes("high-elf"), "the SRD's High Elf is offered");
  assert.ok(!ids.includes("odm-high-elf"), "the expanded pack's copy is not");
  assert.ok(ids.includes("odm-drow"), "a race only the expanded pack prints stays");
  // Unless a stored character sits on the copy.
  const kept = packRaceOptions([elf, highElf, odmHighElf], ["odm-high-elf"]).map((entry) => entry.id);
  assert.ok(kept.includes("odm-high-elf") && kept.includes("high-elf"));
});

await test("every pack row carries its book", () => {
  for (const option of packRaceOptions([elf, highElf, tohDrow])) {
    assert.ok(option.source, option.id);
    assert.ok(option.documentSlug, option.id);
  }
});

const spellRow = (name, documentSlug, desc, level = 0) => ({
  slug: `${documentSlug}-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`,
  name,
  documentSlug,
  level,
  school: "enchantment",
  classes: ["bard"],
  ritual: false,
  concentration: false,
  aliases: [],
  data: { desc, higher_level: "" },
});

await test("a Level Up spell written on an expertise die or a maneuver DC is not served; the SRD's row of the name is (issue 116)", () => {
  const served = servedSpellRows([
    spellRow("Friends", "a5e", "You gain an expertise die on Charisma checks."),
    spellRow("Guidance", "a5e", "The target gains an expertise die on one ability check."),
    spellRow("Guidance", "wotc-srd", "The target can roll a d4 and add the number rolled to one ability check."),
    spellRow("Mental Grip", "a5e", "The target must succeed on a save against your maneuver DC.", 2),
    spellRow("Befriend", "spells-that-dont-suck", "You have advantage on Charisma checks."),
    spellRow("Expertise Strike", "dmag", "Your expertise with the blade shows.", 1),
  ]);
  const names = served.map((row) => `${row.name}@${row.documentSlug}`);
  assert.ok(!names.includes("Friends@a5e"));
  assert.ok(!names.includes("Mental Grip@a5e"));
  assert.ok(!names.includes("Guidance@a5e"));
  assert.ok(names.includes("Guidance@wotc-srd"));
  assert.ok(names.includes("Befriend@spells-that-dont-suck"));
  assert.ok(names.includes("Expertise Strike@dmag"), "the word expertise alone is not the rule");
});

const races = srdRaceOptions();
const classes = srdClassOptions();
const backgrounds = srdBackgroundOptions();
const race = (id) => races.find((entry) => entry.id === id);
const klass = (id) => classes.find((entry) => entry.id === id);
const background = (id) => backgrounds.find((entry) => entry.id === id);

await test("a race's cantrip is not a class cantrip when a stored sheet is read back (issue 118)", () => {
  // The sheet lists the tiefling's Thaumaturgy with the cleric's (submit.ts
  // finalCantrips); reconciled, it is the race's again.
  const { picks, dropped } = reconcilePicks(
    { cantrips: ["Guidance", "Sacred Flame", "Thaumaturgy"] },
    { race: race("tiefling"), klass: klass("cleric"), background: background("acolyte"), level: 3 },
  );
  assert.deepEqual(picks.cantrips, ["Guidance", "Sacred Flame"]);
  assert.deepEqual(dropped, [], "the race's cantrip leaving the class list is not a dropped pick");
  // The high elf's pick likewise, under whichever name it was chosen.
  const elfWizard = reconcilePicks(
    { racialCantrip: "Fire Bolt", cantrips: ["Fire Bolt", "Mage Hand", "Prestidigitation"] },
    { race: race("high_elf"), klass: klass("wizard"), background: background("sage"), level: 1 },
  );
  assert.equal(elfWizard.picks.racialCantrip, "Fire Bolt");
  assert.deepEqual(elfWizard.picks.cantrips, ["Mage Hand", "Prestidigitation"]);
  // A forest gnome bard's Minor Illusion.
  const gnome = reconcilePicks(
    { cantrips: ["Minor Illusion", "Vicious Mockery"] },
    { race: race("forest_gnome"), klass: klass("bard"), background: background("entertainer"), level: 1 },
  );
  assert.deepEqual(gnome.picks.cantrips, ["Vicious Mockery"]);
});

await test("each step blocker names the block that holds the missing pick (issue 117)", () => {
  const state = {
    name: "", backgroundSkills: [], bonusLanguages: [], racialAsi: [], racialSkills: [], racialTool: "",
    racialCantrip: "", racialAncestry: "", repeatSkills: [], chosenSkills: [], subclass: "", stylePicks: [],
    expertisePicks: [], method: "standard", scores: {}, rollPool: [],
  };
  assert.deepEqual(submit.identityBlocker(state, background("acolyte")), { target: "name", message: "Give your character a name." });
  const named = { ...state, name: "Vex" };
  assert.equal(submit.identityBlocker(named, background("acolyte")), null);
  // An acolyte's two languages, picked on the ancestry step.
  const acolyte = submit.ancestryBlocker(named, race("half_orc"), background("acolyte"));
  assert.equal(acolyte.target, "languages");
  assert.equal(acolyte.message, "Pick 2 more languages first.");
  assert.equal(submit.ancestryBlocker({ ...named, bonusLanguages: ["Elvish", "Giant"] }, race("half_orc"), background("acolyte")), null);
  // A half-elf speaks one more tongue, then raises two scores, then picks
  // two skills: each hold names the block that collects it.
  assert.equal(submit.ancestryBlocker(named, race("half_elf"), background("soldier")).target, "languages");
  assert.equal(submit.ancestryBlocker({ ...named, bonusLanguages: ["Giant"] }, race("half_elf"), background("soldier")).target, "racialAsi");
  assert.equal(submit.ancestryBlocker({ ...named, bonusLanguages: ["Giant"], racialAsi: ["str", "con"] }, race("half_elf"), background("soldier")).target, "racialSkills");
  assert.equal(submit.ancestryBlocker(named, race("dragonborn"), background("soldier")).target, "ancestry");
  assert.equal(submit.ancestryBlocker({ ...named, bonusLanguages: ["Giant"] }, race("high_elf"), background("soldier")).target, "racialCantrip");
  assert.equal(submit.ancestryBlocker(named, race("hill_dwarf"), background("soldier")).target, "racialTool");
  assert.equal(submit.callingBlocker(undefined).target, "class");
  assert.equal(submit.ancestryBlocker(named, undefined).target, "race");
  assert.equal(submit.abilitiesBlocker({ abilities: null }).target, "scores");
  assert.equal(submit.gearBlocker({ purse: { problems: ["Over budget by 3 gp."] } }).message, "Over budget by 3 gp.");
  assert.equal(submit.gearBlocker({ purse: { problems: [] } }), null);
});

await test("the Core Rules acolyte asks for two languages, on top of the race's own", () => {
  assert.equal(background("acolyte").languages, 2);
  assert.equal(submit.bonusLanguageCount(race("half_orc"), background("acolyte")), 2);
  assert.equal(submit.bonusLanguageCount(race("human"), background("acolyte")), 3);
});

if (failed) {
  process.exit(1);
}
