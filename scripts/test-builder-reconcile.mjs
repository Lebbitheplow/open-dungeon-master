// The character builder's picks after an earlier step changes.
//
// The rule this file guards: a pick is only kept while the choice it hangs
// off still offers it. Changing the background, race, class, subclass or
// level re-checks every dependent pick (reconcile.ts), and the server drops
// "choice" features no class on the sheet has slots for. Before this a sheet
// could carry Battle Master maneuvers under a Champion, an acolyte's two
// languages under a criminal, and four expertise skills at level 1 (issue #37).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { reconcilePicks } = await import("../src/app/characters/builder/reconcile.ts");
const { srdRaceOptions, srdClassOptions, srdBackgroundOptions } = await import(
  "../src/app/characters/builder/useBuilderOptions.ts"
);
const { populateFeaturesForClasses } = await import("../src/lib/srd/features.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const races = srdRaceOptions();
const classes = srdClassOptions();
const backgrounds = srdBackgroundOptions();
const race = (id) => races.find((entry) => entry.id === id);
const klass = (id) => classes.find((entry) => entry.id === id);
const background = (id) => backgrounds.find((entry) => entry.id === id);

const empty = {
  chosenSkills: [], racialSkills: [], racialAsi: [], racialCantrip: "", racialTool: "",
  bonusLanguages: [], subclass: "", expertisePicks: [], stylePicks: [], optionPicks: [],
  spells: [], bookPrepared: [], cantrips: [],
};

test("a class skill the new background grants outright is dropped, and named", () => {
  // Criminal grants deception and stealth; the rogue picked stealth as a class skill.
  const before = { ...empty, chosenSkills: ["stealth", "insight", "perception", "acrobatics"] };
  const { picks, dropped } = reconcilePicks(before, {
    race: race("human"), klass: klass("rogue"), background: background("criminal"), level: 1,
  });
  assert.deepEqual(picks.chosenSkills, ["insight", "perception", "acrobatics"]);
  assert.deepEqual(dropped, ["class skill: stealth"]);
});

test("an acolyte's two languages do not survive a change to a background with none", () => {
  const before = { ...empty, bonusLanguages: ["Elvish", "Dwarvish", "Giant"] };
  const human = race("human");
  const acolyte = reconcilePicks(before, { race: human, klass: klass("fighter"), background: background("acolyte"), level: 1 });
  assert.deepEqual(acolyte.picks.bonusLanguages, ["Elvish", "Dwarvish", "Giant"]);
  const criminal = reconcilePicks(before, { race: human, klass: klass("fighter"), background: background("criminal"), level: 1 });
  assert.deepEqual(criminal.picks.bonusLanguages, ["Elvish"]);
});

test("a language the race already speaks is blanked in its slot, not shifted", () => {
  const before = { ...empty, bonusLanguages: ["Elvish", "Giant"] };
  const { picks } = reconcilePicks(before, { race: race("high_elf"), klass: klass("fighter"), background: background("acolyte"), level: 1 });
  assert.deepEqual(picks.bonusLanguages, ["", "Giant"]);
});

test("a short-list language slot only accepts what the list offers", () => {
  const derro = { ...race("human"), languages: ["Dwarvish"], bonusLanguages: 1, languageChoice: { count: 1, from: ["Common", "Undercommon"] } };
  const { picks } = reconcilePicks({ ...empty, bonusLanguages: ["Elvish"] }, { race: derro, klass: klass("fighter"), background: background("criminal"), level: 1 });
  assert.deepEqual(picks.bonusLanguages, [""]);
  const ok = reconcilePicks({ ...empty, bonusLanguages: ["Undercommon"] }, { race: derro, klass: klass("fighter"), background: background("criminal"), level: 1 });
  assert.deepEqual(ok.picks.bonusLanguages, ["Undercommon"]);
});

test("Battle Master maneuvers do not follow a fighter into the Champion", () => {
  const maneuvers = ["Maneuver: Riposte", "Maneuver: Trip Attack", "Maneuver: Precision Attack"];
  const before = { ...empty, subclass: "Battle Master", optionPicks: maneuvers };
  const battle = reconcilePicks(before, { race: race("human"), klass: klass("fighter"), background: background("soldier"), level: 3 });
  assert.deepEqual(battle.picks.optionPicks, maneuvers);
  const champion = reconcilePicks({ ...before, subclass: "Champion" }, { race: race("human"), klass: klass("fighter"), background: background("soldier"), level: 3 });
  assert.deepEqual(champion.picks.optionPicks, []);
  assert.equal(champion.dropped.length, 3);
});

test("a subclass picked at 3 is not kept at level 1, and comes back only by picking again", () => {
  const { picks } = reconcilePicks({ ...empty, subclass: "Champion" }, { race: race("human"), klass: klass("fighter"), background: background("soldier"), level: 1 });
  assert.equal(picks.subclass, "");
});

test("a rogue lowered from 6 to 1 keeps two expertise picks, not four", () => {
  const before = { ...empty, chosenSkills: ["stealth", "insight", "perception", "acrobatics"], expertisePicks: ["stealth", "insight", "perception", "acrobatics"] };
  const six = reconcilePicks(before, { race: race("human"), klass: klass("rogue"), background: background("sage"), level: 6 });
  assert.equal(six.picks.expertisePicks.length, 4);
  const one = reconcilePicks(before, { race: race("human"), klass: klass("rogue"), background: background("sage"), level: 1 });
  assert.deepEqual(one.picks.expertisePicks, ["stealth", "insight"]);
});

test("expertise in a skill the character is no longer proficient in goes", () => {
  const before = { ...empty, chosenSkills: ["stealth"], expertisePicks: ["stealth", "religion"] };
  const { picks } = reconcilePicks(before, { race: race("human"), klass: klass("rogue"), background: background("criminal"), level: 1 });
  assert.deepEqual(picks.expertisePicks, ["stealth"]);
  const fighter = reconcilePicks(before, { race: race("human"), klass: klass("fighter"), background: background("criminal"), level: 1 });
  assert.deepEqual(fighter.picks.expertisePicks, []);
});

test("a wizard lowered to level 1 loses the 3rd-level spell the spell book can no longer show", () => {
  const before = { ...empty, cantrips: ["Fire Bolt"], spells: ["Magic Missile", "Fireball", "Shield"], bookPrepared: ["Fireball", "Shield"] };
  const five = reconcilePicks(before, { race: race("human"), klass: klass("wizard"), background: background("sage"), level: 5 });
  assert.deepEqual(five.picks.spells, ["Magic Missile", "Fireball", "Shield"]);
  const one = reconcilePicks(before, { race: race("human"), klass: klass("wizard"), background: background("sage"), level: 1 });
  assert.deepEqual(one.picks.spells, ["Magic Missile", "Shield"]);
  assert.deepEqual(one.picks.bookPrepared, ["Shield"]);
  assert.ok(one.dropped.includes("spell: Fireball"));
});

test("a non-caster keeps no spells, and a level 1 paladin no cantrips", () => {
  const before = { ...empty, cantrips: ["Light"], spells: ["Cure Wounds"] };
  const fighter = reconcilePicks(before, { race: race("human"), klass: klass("fighter"), background: background("soldier"), level: 1 });
  assert.deepEqual([fighter.picks.spells, fighter.picks.cantrips], [[], []]);
  const paladin = reconcilePicks(before, { race: race("human"), klass: klass("paladin"), background: background("soldier"), level: 2 });
  assert.deepEqual([paladin.picks.spells, paladin.picks.cantrips], [["Cure Wounds"], []]);
});

test("racial choices belong to the race that offers them", () => {
  const before = { ...empty, racialSkills: ["perception", "stealth"], racialAsi: ["str", "dex"], racialTool: "smith's tools", racialCantrip: "Fire Bolt" };
  const halfElf = reconcilePicks(before, { race: race("half_elf"), klass: klass("fighter"), background: background("soldier"), level: 1 });
  assert.deepEqual(halfElf.picks.racialSkills, ["perception", "stealth"]);
  assert.deepEqual(halfElf.picks.racialAsi, ["str", "dex"]);
  assert.equal(halfElf.picks.racialTool, "");
  assert.equal(halfElf.picks.racialCantrip, "");
  const highElf = reconcilePicks(before, { race: race("high_elf"), klass: klass("fighter"), background: background("soldier"), level: 1 });
  assert.deepEqual(highElf.picks.racialSkills, []);
  assert.deepEqual(highElf.picks.racialAsi, []);
  assert.equal(highElf.picks.racialCantrip, "Fire Bolt");
  const hillDwarf = reconcilePicks(before, { race: race("hill_dwarf"), klass: klass("fighter"), background: background("soldier"), level: 1 });
  assert.equal(hillDwarf.picks.racialTool, "smith's tools");
});

test("a half-elf's chosen bump cannot be Charisma, which the race raises already", () => {
  const { picks } = reconcilePicks({ ...empty, racialAsi: ["cha", "dex"] }, { race: race("half_elf"), klass: klass("bard"), background: background("entertainer"), level: 1 });
  assert.deepEqual(picks.racialAsi, ["", "dex"]);
});

test("fighting styles are held to the slots the class and level open", () => {
  const before = { ...empty, subclass: "Champion", stylePicks: ["defense", "dueling"] };
  const ten = reconcilePicks(before, { race: race("human"), klass: klass("fighter"), background: background("soldier"), level: 10 });
  assert.deepEqual(ten.picks.stylePicks, ["defense", "dueling"]);
  const one = reconcilePicks(before, { race: race("human"), klass: klass("fighter"), background: background("soldier"), level: 1 });
  assert.deepEqual(one.picks.stylePicks, ["defense"]);
});

test("the server's regrant drops choice features no class on the sheet has slots for", () => {
  const stored = [
    { name: "Maneuver: Riposte", source: "choice" },
    { name: "Maneuver: Trip Attack", source: "choice" },
    { name: "Fighting Style: Defense", source: "choice" },
    { name: "Boon of the Mountain", source: "story" },
  ];
  const champion = populateFeaturesForClasses(stored, [{ id: "fighter", subclass: "Champion", level: 3 }], "human");
  const names = champion.map((feature) => feature.name);
  assert.ok(!names.includes("Maneuver: Riposte"));
  assert.ok(!names.includes("Maneuver: Trip Attack"));
  assert.ok(names.includes("Fighting Style: Defense"));
  assert.ok(names.includes("Boon of the Mountain"));
  const battle = populateFeaturesForClasses(stored, [{ id: "fighter", subclass: "Battle Master", level: 3 }], "human");
  assert.ok(battle.map((feature) => feature.name).includes("Maneuver: Riposte"));
});

test("a warlock adapted down to level 1 keeps no invocations, and at 2 keeps two", () => {
  const stored = ["Agonizing Blast", "Devil's Sight", "Eldritch Sight"].map((name) => ({ name: `Invocation: ${name}`, source: "choice" }));
  const one = populateFeaturesForClasses(stored, [{ id: "warlock", subclass: "", level: 1 }], "human");
  assert.equal(one.filter((feature) => feature.name.startsWith("Invocation:")).length, 0);
  const two = populateFeaturesForClasses(stored, [{ id: "warlock", subclass: "", level: 2 }], "human");
  assert.equal(two.filter((feature) => feature.name.startsWith("Invocation:")).length, 2);
});

console.log(`\ntest-builder-reconcile: ${passed} tests passed.`);
