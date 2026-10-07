// The character builder's picks after an earlier step changes.
//
// The rule this file guards: a pick is only kept while the choice it hangs
// off still offers it. Changing the background, race, class, subclass or
// level re-checks every dependent pick (reconcile.ts), and the server drops
// "choice" features no class on the sheet has slots for. Before this a sheet
// could carry Battle Master maneuvers under a Champion, an acolyte's two
// languages under a criminal, and four expertise skills at level 1 (issue #37).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));

const { reconcilePicks, grantedSkillSources, grantingTrait } = await import("../src/app/characters/builder/reconcile.ts");
const { subclassGate, subclassNamesFor } = await import("../src/lib/srd/features.ts");
const { srdRaceOptions, srdClassOptions, srdBackgroundOptions } = await import(
  "../src/app/characters/builder/useBuilderOptions.ts"
);
const { populateFeaturesForClasses } = await import("../src/lib/srd/features.ts");
const { backgroundMechanics } = await import("../src/lib/content/mechanics.ts");
const { packRaceOptions } = await import("../src/lib/content/race-options.ts");

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

// Content-pack rows, verbatim (scripts/test-pack-rows.mjs holds their parsing).
const packRows = JSON.parse(readFileSync(path.join(here, "fixtures", "open5e-pack-rows.json"), "utf8"));
const packBackground = (slug) => {
  const row = packRows.backgrounds.find((entry) => entry.slug === slug);
  return { id: row.slug, name: row.name, ...backgroundMechanics(row.data) };
};
const packRaces = packRaceOptions(packRows.races);
const packRace = (id) => packRaces.find((entry) => entry.id === id);

test("a pack background's skill pick is held to its list, slot by slot", () => {
  const artisan = packBackground("artisan");
  const context = { race: race("human"), klass: klass("rogue"), background: artisan, level: 1 };
  assert.deepEqual(reconcilePicks({ ...empty, backgroundSkills: ["insight"] }, context).picks.backgroundSkills, ["insight"]);
  // Arcana is not one of "either Insight or History"; Persuasion is granted outright.
  assert.deepEqual(reconcilePicks({ ...empty, backgroundSkills: ["arcana"] }, context).picks.backgroundSkills, [""]);
  assert.deepEqual(reconcilePicks({ ...empty, backgroundSkills: ["persuasion"] }, context).picks.backgroundSkills, [""]);
});

test("a background change drops the old background's skill pick, and names it", () => {
  const { picks, dropped } = reconcilePicks(
    { ...empty, backgroundSkills: ["insight"] },
    { race: race("human"), klass: klass("rogue"), background: background("criminal"), level: 1 },
  );
  assert.deepEqual(picks.backgroundSkills, []);
  assert.deepEqual(dropped, ["background skill: insight"]);
});

test("a class skill the background's pick already took is dropped", () => {
  const { picks } = reconcilePicks(
    { ...empty, backgroundSkills: ["insight"], chosenSkills: ["insight", "perception"] },
    { race: race("human"), klass: klass("rogue"), background: packBackground("artisan"), level: 1 },
  );
  assert.deepEqual(picks.chosenSkills, ["perception"]);
  assert.deepEqual(picks.backgroundSkills, ["insight"]);
});

test("a language the background names is spoken, not a pick", () => {
  // Forest dweller names Sylvan; a human picks one language of their own.
  const { picks } = reconcilePicks(
    { ...empty, bonusLanguages: ["Sylvan"] },
    { race: race("human"), klass: klass("fighter"), background: packBackground("forest-dweller"), level: 1 },
  );
  assert.deepEqual(picks.bonusLanguages, [""]);
});

test("a pack race's 'Any' increases follow the existing pick rule", () => {
  const humanChassis = reconcilePicks(
    { ...empty, racialAsi: ["str", "str", "dex"] },
    { race: packRace("human-chassis"), klass: klass("fighter"), background: background("soldier"), level: 1 },
  );
  assert.deepEqual(humanChassis.picks.racialAsi, ["str", "", "dex"]);
  // The dwarf chassis raises Constitution itself, so it is not a pick.
  const dwarfChassis = reconcilePicks(
    { ...empty, racialAsi: ["con", "wis"] },
    { race: packRace("dwarf-chassis"), klass: klass("fighter"), background: background("soldier"), level: 1 },
  );
  assert.deepEqual(dwarfChassis.picks.racialAsi, ["", "wis"]);
});

test("an either-or racial increase takes one of its two abilities only", () => {
  const context = { race: packRace("delver"), klass: klass("fighter"), background: background("soldier"), level: 1 };
  assert.deepEqual(reconcilePicks({ ...empty, racialAsi: ["dex"] }, context).picks.racialAsi, ["dex"]);
  // Constitution is neither Strength nor Dexterity; Intelligence the delver already raises.
  assert.deepEqual(reconcilePicks({ ...empty, racialAsi: ["con"] }, context).picks.racialAsi, [""]);
  assert.deepEqual(reconcilePicks({ ...empty, racialAsi: ["int"] }, context).picks.racialAsi, [""]);
});

// ---- issue #109: every race, class and background, every level ----
//
// The reporter asked for a running table of which combinations have been
// checked. This is it, run on every change: for every class skill of every
// class against every race and every background, the skills reconcile
// refuses are exactly the ones the class step greys and labels; and for
// every class at every level, the subclass menu is shut exactly when the
// rules would drop a pick.

test("a wood elf ranger: Perception is greyed as the race's, Survival as the background's", () => {
  const sources = grantedSkillSources({ race: race("wood_elf"), background: background("outlander") });
  assert.equal(sources.get("perception"), "race");
  assert.equal(sources.get("survival"), "background");
  assert.equal(sources.get("stealth"), undefined);
  // A half-elf's two chosen skills count as the race's too.
  const half = grantedSkillSources({ race: race("half_elf"), racialSkills: ["insight", ""] });
  assert.equal(half.get("insight"), "race");
  // The trait behind the grant, named for the pill's explanation.
  assert.equal(grantingTrait("wood_elf", "Perception"), "Keen Senses");
  assert.equal(grantingTrait("half_orc", "Intimidation"), "Menacing");
  assert.equal(grantingTrait("human", "Perception"), null);
});

test("the races the follow-up on #109 listed each grey their granted skill as the race's", () => {
  const expected = {
    high_elf: ["perception"],
    wood_elf: ["perception"],
    drow: ["perception"],
    tabaxi: ["perception", "stealth"],
    half_orc: ["intimidation"],
    goliath: ["athletics"],
    tortle: ["survival"],
    bugbear: ["stealth"],
  };
  for (const [raceId, skills] of Object.entries(expected)) {
    const r = race(raceId);
    assert.ok(r, `${raceId} is in the race list`);
    const sources = grantedSkillSources({ race: r });
    for (const skill of skills) {
      assert.equal(sources.get(skill), "race", `${raceId} ${skill}`);
    }
  }
  // The half-orc barbarian the follow-up reproduced on: Intimidation is in
  // the barbarian's pool, refused by reconcile, and labelled.
  const { picks } = reconcilePicks({ ...empty, chosenSkills: ["intimidation", "athletics"] }, { race: race("half_orc"), klass: klass("barbarian"), level: 1 });
  assert.deepEqual(picks.chosenSkills, ["athletics"]);
  assert.equal(grantedSkillSources({ race: race("half_orc") }).get("intimidation"), "race");
});

test("every race x class: the class skills the engine refuses are exactly the greyed ones, each labelled race", () => {
  let combos = 0;
  for (const r of races) {
    for (const k of classes) {
      const pool = k.skillChoices?.from ?? [];
      if (!pool.length) continue;
      const sources = grantedSkillSources({ race: r });
      for (const skill of pool) {
        const { picks } = reconcilePicks({ ...empty, chosenSkills: [skill] }, { race: r, klass: k, level: 1 });
        const refused = !picks.chosenSkills.includes(skill);
        assert.equal(refused, sources.has(skill), `${r.id} ${k.id} ${skill}: refused ${refused}, greyed ${sources.has(skill)}`);
        if (refused) assert.equal(sources.get(skill), "race", `${r.id} ${k.id} ${skill}`);
      }
      combos += 1;
    }
  }
  assert.ok(combos > 100, `only ${combos} race/class pairs checked`);
  console.log(`  (${races.length} races x ${classes.length} classes)`);
});

test("every background x class: the class skills the engine refuses are exactly the greyed ones, each labelled background", () => {
  const human = race("human");
  for (const b of backgrounds) {
    for (const k of classes) {
      const pool = k.skillChoices?.from ?? [];
      const sources = grantedSkillSources({ race: human, background: b });
      for (const skill of pool) {
        const { picks } = reconcilePicks({ ...empty, chosenSkills: [skill] }, { race: human, klass: k, background: b, level: 1 });
        const refused = !picks.chosenSkills.includes(skill);
        assert.equal(refused, sources.has(skill), `${b.id} ${k.id} ${skill}`);
        if (refused) assert.equal(sources.get(skill), "background", `${b.id} ${k.id} ${skill}`);
      }
    }
  }
});

test("every class at every level: the subclass menu is shut exactly when a pick would be dropped", () => {
  for (const k of classes) {
    const name = subclassNamesFor(k.id)[0] ?? "Some Archetype";
    for (let level = 1; level <= 20; level += 1) {
      const gate = subclassGate(k.id, level);
      const { picks } = reconcilePicks({ ...empty, subclass: name }, { race: race("human"), klass: k, background: background("acolyte"), level });
      assert.equal(picks.subclass === "", gate.locked, `${k.id} level ${level}: dropped ${picks.subclass === ""}, locked ${gate.locked}`);
      if (gate.locked) assert.ok(gate.pickLevel > level, `${k.id} level ${level}`);
    }
    // A pack-only archetype is dropped below the pick level too, so the
    // menu must not offer it there either (what issue #109 saw).
    if (subclassGate(k.id, 1).locked) {
      const early = reconcilePicks({ ...empty, subclass: "Forest Warden" }, { race: race("human"), klass: k, background: background("acolyte"), level: 1 });
      assert.equal(early.picks.subclass, "", `${k.id}: a pack archetype survived level 1`);
    }
  }
  // A class outside the tables is never locked.
  assert.deepEqual(subclassGate("no-such-class", 1), { pickLevel: null, locked: false });
  // The follow-up on #109 counted the classes the open menu misled: every
  // one whose subclass level is above 1 (all SRD classes but the cleric,
  // sorcerer and warlock).
  const lockedAtOne = classes.filter((k) => subclassGate(k.id, 1).locked).map((k) => k.id);
  for (const id of ["barbarian", "bard", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "wizard"]) {
    assert.ok(lockedAtOne.includes(id), `${id} locked at level 1`);
  }
  for (const id of ["cleric", "sorcerer", "warlock"]) {
    assert.ok(!lockedAtOne.includes(id), `${id} open at level 1`);
  }
  console.log(`  (${lockedAtOne.length} of ${classes.length} classes shut at level 1)`);
});

console.log(`\ntest-builder-reconcile: ${passed} tests passed.`);
