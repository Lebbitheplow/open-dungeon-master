// What a feat grants beyond its ability point, read from its text and
// applied to the sheet's training (src/lib/srd/feat-grants.ts, issue #125):
// Linguist's three languages, Heavily Armored's armor, Skill Expert's skill
// and expertise, Weapon Master's four weapons, Tavern Brawler's improvised
// weapons, Chef's cook's utensils.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { applyFeatGrants, featGrantSpec, featGrantsAnything, featPicksOwed, withoutFeatPicks } = await import("../src/lib/srd/feat-grants.ts");
const { authoredFeatDesc } = await import("../src/lib/srd/feat-effects.ts");
const authored = (await import("../src/lib/srd/authored-feats.json", { with: { type: "json" } })).default.feats;

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const spec = (name) => featGrantSpec(authoredFeatDesc(name));
const base = { saves: ["str", "con"], skills: ["athletics", "perception"], expertise: [], languages: ["Common", "Elvish"], tools: [], armor: ["light", "medium", "shields"], weapons: ["simple", "martial"] };

test("the authored feats' grants are read from their text", () => {
  assert.equal(spec("Linguist").languages, 3);
  assert.equal(spec("Skill Expert").skills, 1);
  assert.equal(spec("Skill Expert").expertise, 1);
  assert.deepEqual(spec("Heavily Armored").armor, ["heavy"]);
  assert.deepEqual(spec("Moderately Armored").armor, ["medium", "shields"]);
  assert.deepEqual(spec("Lightly Armored").armor, ["light"]);
  assert.equal(spec("Weapon Master").weapons, 4);
  assert.deepEqual(spec("Tavern Brawler").fixedWeapons, ["improvised weapons"]);
  assert.deepEqual(spec("Chef").fixedTools, ["cook's utensils"]);
  assert.deepEqual(spec("Gunner").fixedWeapons, ["firearms"]);
  // Resilient's save and the half-feat points are another module's.
  assert.equal(featGrantsAnything(spec("Resilient")), false);
  assert.equal(featGrantsAnything(spec("Alert")), false);
  assert.equal(featGrantsAnything(spec("Tough")), false);
  // Every authored feat whose text names a grant of these kinds is read as one.
  const granting = authored.filter((feat) => /learn (one|two|three) languages|proficiency (in|with) (one|two|three|four) (skill|weapon)|expertise in one skill|proficiency with (light|medium|heavy) armor/i.test(feat.desc));
  for (const feat of granting) {
    assert.ok(featGrantsAnything(featGrantSpec(feat.desc)), `${feat.name} grants nothing: ${feat.desc}`);
  }
  assert.ok(granting.length >= 6, `only ${granting.length} granting feats found`);
});

test("a content pack's wording reads the same", () => {
  // Skilled's three are skills OR tools (issue #147): one shared count.
  const skilled = featGrantSpec("You gain proficiency in any combination of three skills or tools of your choice.");
  assert.equal(skilled.skills, 0);
  assert.equal(skilled.any, 3);
  assert.deepEqual(skilled.anyKinds, ["skills", "tools"]);
  const prodigy = featGrantSpec("You gain proficiency in one skill of your choice, proficiency with one tool of your choice, and fluency in one language of your choice. Choose one skill in which you have proficiency. You gain expertise with that skill.");
  assert.equal(prodigy.skills, 1);
  assert.equal(prodigy.tools, 1);
  assert.equal(prodigy.languages, 1);
  assert.equal(prodigy.expertise, 1);
  const artisan = featGrantSpec("You gain proficiency with one type of artisan's tools of your choice.");
  assert.equal(artisan.tools, 1);
  assert.ok(artisan.toolsFrom.includes("smith's tools") && !artisan.toolsFrom.includes("lute"));
});

test("what a feat still waits for is said in one sentence", () => {
  assert.equal(featPicksOwed("Linguist", spec("Linguist"), undefined), "Linguist: pick 3 languages.");
  assert.equal(featPicksOwed("Linguist", spec("Linguist"), { languages: ["Dwarvish", ""] }), "Linguist: pick 2 languages.");
  assert.equal(featPicksOwed("Linguist", spec("Linguist"), { languages: ["Dwarvish", "Giant", "Orc"] }), null);
  assert.equal(featPicksOwed("Skill Expert", spec("Skill Expert"), { skills: ["stealth"] }), "Skill Expert: pick expertise in 1 skill.");
  assert.equal(featPicksOwed("Heavily Armored", spec("Heavily Armored"), undefined), null);
});

test("the grants land on the sheet's training: fixed ones always, picks as recorded", () => {
  const feats = (...names) => names.map((name) => ({ name, desc: authoredFeatDesc(name) }));
  const linguist = applyFeatGrants({ proficiencies: base, feats: feats("Linguist"), choices: { linguist: { languages: ["Dwarvish", "Giant", "Orc"] } }, strict: true });
  assert.deepEqual(linguist.problems, []);
  assert.deepEqual(linguist.proficiencies.languages, ["Common", "Elvish", "Dwarvish", "Giant", "Orc"]);
  const armored = applyFeatGrants({ proficiencies: base, feats: feats("Heavily Armored", "Tavern Brawler", "Chef"), choices: {}, strict: true });
  assert.deepEqual(armored.problems, []);
  assert.deepEqual(armored.proficiencies.armor, ["light", "medium", "shields", "heavy"]);
  assert.deepEqual(armored.proficiencies.weapons, ["simple", "martial", "improvised weapons"]);
  assert.deepEqual(armored.proficiencies.tools, ["cook's utensils"]);
  const expert = applyFeatGrants({ proficiencies: base, feats: feats("Skill Expert"), choices: { "skill expert": { skills: ["stealth"], expertise: ["stealth"] } }, strict: true });
  assert.deepEqual(expert.problems, []);
  assert.deepEqual(expert.proficiencies.skills, ["athletics", "perception", "stealth"]);
  assert.deepEqual(expert.proficiencies.expertise, ["stealth"]);
  const master = applyFeatGrants({ proficiencies: base, feats: feats("Weapon Master"), choices: { "weapon master": { weapons: ["Longsword", "whip", "Net", "Blowgun"] } }, strict: true });
  assert.deepEqual(master.problems, []);
  assert.deepEqual(master.proficiencies.weapons, ["simple", "martial", "Longsword", "Whip", "Net", "Blowgun"]);
  // A feat with no text, or no grant, changes nothing.
  const quiet = applyFeatGrants({ proficiencies: base, feats: [{ name: "Alert", desc: authoredFeatDesc("Alert") }, { name: "Unknown Feat", desc: "" }], choices: {}, strict: true });
  assert.deepEqual(quiet.problems, []);
  assert.deepEqual(quiet.proficiencies, base);
});

test("held strictly, a pick is new to the character, one the feat offers, and all of them are made", () => {
  const feats = [{ name: "Linguist", desc: authoredFeatDesc("Linguist") }];
  const missing = applyFeatGrants({ proficiencies: base, feats, choices: {}, strict: true });
  assert.deepEqual(missing.problems, ["Linguist: pick 3 languages."]);
  assert.deepEqual(missing.proficiencies.languages, base.languages);
  const known = applyFeatGrants({ proficiencies: base, feats, choices: { linguist: { languages: ["Elvish", "Giant", "Orc"] } }, strict: true });
  assert.equal(known.problems.length, 1);
  assert.match(known.problems[0], /already speaks Elvish/);
  const expert = [{ name: "Skill Expert", desc: authoredFeatDesc("Skill Expert") }];
  const held = applyFeatGrants({ proficiencies: base, feats: expert, choices: { "skill expert": { skills: ["athletics"], expertise: ["athletics"] } }, strict: true });
  assert.match(held.problems[0], /already proficient in athletics/);
  const notSkill = applyFeatGrants({ proficiencies: base, feats: expert, choices: { "skill expert": { skills: ["juggling"], expertise: ["perception"] } }, strict: true });
  assert.match(notSkill.problems[0], /not a skill/);
  assert.deepEqual(notSkill.proficiencies.expertise, ["perception"]);
  const master = [{ name: "Weapon Master", desc: authoredFeatDesc("Weapon Master") }];
  const offTable = applyFeatGrants({ proficiencies: base, feats: master, choices: { "weapon master": { weapons: ["Lightsaber", "Longsword", "Whip", "Net"] } }, strict: true });
  assert.match(offTable.problems[0], /not a weapon on the table/);
  // Not strict: what fits is applied, nothing is said.
  const lenient = applyFeatGrants({ proficiencies: base, feats, choices: { linguist: { languages: ["Elvish", "Giant"] } }, strict: false });
  assert.deepEqual(lenient.problems, []);
  assert.deepEqual(lenient.proficiencies.languages, ["Common", "Elvish", "Giant"]);
});

test("an edit starts from the training without the old picks, so re-picking replaces rather than piles on", () => {
  const stored = { ...base, languages: ["Common", "Elvish", "Dwarvish", "Giant", "Orc"], skills: ["athletics", "perception", "stealth"], expertise: ["stealth"] };
  const stripped = withoutFeatPicks(stored, { linguist: { languages: ["Dwarvish", "Giant", "Orc"] }, "skill expert": { skills: ["stealth"], expertise: ["stealth"] } });
  assert.deepEqual(stripped.languages, ["Common", "Elvish"]);
  assert.deepEqual(stripped.skills, ["athletics", "perception"]);
  assert.deepEqual(stripped.expertise, []);
  assert.deepEqual(withoutFeatPicks(stored, undefined), stored);
});


// ---- issue #147: the Level Up and Tome of Heroes wordings, shared picks, choices ----

const { featAbilityIncreaseFrom, featSaveProficiency, featTwinOf, holdsFeat } = await import("../src/lib/srd/feat-effects.ts");
const { packFeatText } = await import("../src/lib/srd/feat-text.ts");
const { unmetPrerequisite } = await import("../src/lib/srd/legality/features.ts");
const { anyPicksMade, pickSlots } = await import("../src/lib/srd/feat-grants.ts");

test("a pack row's text is read wherever the pack keeps it: desc, benefits, effects_desc, or a prerequisite field holding the rules", () => {
  const a5e = packFeatText({ desc: "Your gift for languages borders on the supernatural.", prerequisite: null, effects_desc: ["Raise your Intelligence attribute by 1, up to the attribute cap of 20.", "Select three languages and gain the ability to read, write, and speak them."] });
  assert.match(a5e.desc, /^Your gift for languages .* Select three languages/);
  assert.equal(a5e.prerequisite, "");
  const toh = packFeatText({ desc: "You are an expert at hunting prey. You gain the following benefits:", prerequisite: "*N/A*", effects_desc: ["* You gain proficiency in the Stealth and Survival skills."] });
  assert.match(toh.desc, /benefits: You gain proficiency in the Stealth and Survival skills\.$/);
  assert.equal(toh.prerequisite, "*N/A*");
  const benefits = packFeatText({ benefits: [{ desc: "You learn two cantrips." }, { desc: "Choose a level 1 spell." }] });
  assert.equal(benefits.desc, "You learn two cantrips. Choose a level 1 spell.");
  // Level Up's Tenacious: empty desc, the rules in the prerequisite field.
  const tenacious = packFeatText({ desc: "", effects_desc: [], prerequisite: "Choose an attribute and raise it by 1, up to the attribute cap of 20, and become proficient with saving throws using the selected attribute." });
  assert.match(tenacious.desc, /^Choose an attribute/);
  assert.equal(tenacious.prerequisite, "");
});

test("the Level Up and Tome of Heroes wordings grant what they say", () => {
  const outfitted = featGrantSpec("You have learned to fight in heavy armor Raise your Strength attribute by 1, up to the attribute cap of 20. Learn the heavy armor proficiency.");
  assert.deepEqual(outfitted.armor, ["heavy"]);
  const moderately = featGrantSpec("Raise your Strength or Dexterity Attribute by 1, up to the attribute cap of 20. Learn the medium armor and shield proficiencies.");
  assert.deepEqual(moderately.armor, ["medium", "shields"]);
  const linguistics = featGrantSpec("Select three languages and gain the ability to read, write, and speak them.");
  assert.equal(linguistics.languages, 3);
  const specialist = featGrantSpec("Select and learn any four weapon proficiencies. Three of these must be a simple or martial weapons. The fourth choice can be a simple, martial, or rare weapon.");
  assert.equal(specialist.weapons, 4);
  assert.deepEqual(specialist.weaponsFrom, []);
  const crafting = featGrantSpec("You gain an expertise die on checks made to craft, maintain, and repair items. You gain proficiency with two tools of your choice.");
  assert.equal(crafting.tools, 2);
  const street = featGrantSpec("You can roll 1d4 in place of your normal damage for unarmed strikes. Learn the improvised weapons proficiency.");
  assert.deepEqual(street.fixedWeapons, ["improvised weapons"]);
  const surgical = featGrantSpec("You gain proficiency in Medicine. If you are already proficient, you instead gain an expertise die.");
  assert.deepEqual(surgical.fixedSkills, ["medicine"]);
  const stalker = featGrantSpec("You are an expert at hunting prey. * You gain proficiency in the Stealth and Survival skills.");
  assert.deepEqual(stalker.fixedSkills, ["stealth", "survival"]);
  const denizen = featGrantSpec("You can discern if a plant or fungal growth is safe to eat. You learn to speak, read, and write Sylvan.");
  assert.deepEqual(denizen.fixedLanguages, ["Sylvan"]);
  const florist = featGrantSpec("You learn Floriography, the language of flowers. Similar to Druidic and Thieves' Cant, Floriography is a secret language.");
  assert.deepEqual(florist.fixedLanguages, ["Floriography"]);
  // "considered proficient" in a conditional is not a grant.
  const giant = featGrantSpec("Whenever you make an Intelligence (History) check related to giants, you are considered proficient in the History skill.");
  assert.equal(featGrantsAnything(giant), false);
  // Maneuver "proficiency" is Level Up's own system, not a grant here.
  const deadeye = featGrantSpec("You gain proficiency with the Farshot Stance and Ricochet maneuvers, and do not have to spend exertion to activate them.");
  assert.equal(featGrantsAnything(deadeye), false);
});

test("a choice from a list is one pick among what the table knows of the list, never the first entry outright", () => {
  const covert = featGrantSpec("You gain proficiency with thieves' tools, the poisoner's kit, or a rare weapon with the stealthy property. You gain two skill tricks of your choice from the rogue class.");
  assert.equal(covert.tools, 1);
  assert.deepEqual(covert.toolsFrom, ["thieves' tools", "poisoner's kit"]);
  assert.deepEqual(covert.fixedTools, []);
  const woodcraft = featGrantSpec("You gain proficiency with the herbalism kit, navigator's kit, a simple ranged weapon, or a martial ranged weapon.");
  assert.equal(woodcraft.any, 1);
  assert.deepEqual(woodcraft.anyKinds, ["tools", "weapons"]);
  assert.deepEqual(woodcraft.toolsFrom, ["herbalism kit", "navigator's tools"]);
  assert.ok(woodcraft.weaponsFrom.includes("Longbow") && woodcraft.weaponsFrom.includes("Shortbow") && !woodcraft.weaponsFrom.includes("Longsword"));
  assert.deepEqual(woodcraft.fixedTools, []);
  const heraldic = featGrantSpec("You gain proficiency in your choice of one martial weapon, one rare weapon, or shields. You gain two divine lessons of your choice from the herald class.");
  assert.equal(heraldic.any, 1);
  assert.deepEqual(heraldic.anyKinds, ["weapons", "armor"]);
  assert.deepEqual(heraldic.armorFrom, ["shields"]);
  assert.ok(heraldic.weaponsFrom.includes("Longsword") && !heraldic.weaponsFrom.includes("Club"));
  // Weapon Master's "simple or martial" is still four of the whole table.
  assert.equal(spec("Weapon Master").weapons, 4);
  assert.equal(spec("Weapon Master").any, 0);
  // Chef's one tool, named outright, stays fixed.
  assert.deepEqual(spec("Chef").fixedTools, ["cook's utensils"]);
});

test("a shared count (Skilled's three skills or tools, Skillful's three skills, languages or tools) is one budget across its kinds", () => {
  const skilled = spec("Skilled");
  assert.equal(skilled.any, 3);
  assert.deepEqual(skilled.anyKinds, ["skills", "tools"]);
  assert.equal(featPicksOwed("Skilled", skilled, undefined), "Skilled: pick 3 skills or tools.");
  assert.equal(featPicksOwed("Skilled", skilled, { skills: ["arcana", "history"] }), "Skilled: pick 1 skill or tool.");
  assert.equal(featPicksOwed("Skilled", skilled, { skills: ["arcana", "history"], tools: ["thieves' tools"] }), null);
  assert.equal(anyPicksMade(skilled, { skills: ["arcana"], tools: ["thieves' tools"] }), 2);
  assert.equal(pickSlots(skilled, { skills: ["arcana"] }, "tools"), 2);
  assert.equal(pickSlots(skilled, { tools: ["thieves' tools", "disguise kit"] }, "skills"), 1);
  const mixed = applyFeatGrants({
    proficiencies: base,
    feats: [{ name: "Skilled", desc: authoredFeatDesc("Skilled") }],
    choices: { skilled: { skills: ["arcana", "history"], tools: ["thieves' tools"] } },
    strict: true,
  });
  assert.deepEqual(mixed.problems, []);
  assert.ok(mixed.proficiencies.skills.includes("arcana") && mixed.proficiencies.skills.includes("history"));
  assert.deepEqual(mixed.proficiencies.tools, ["thieves' tools"]);
  // A fourth pick is over the budget and left off.
  const over = applyFeatGrants({
    proficiencies: base,
    feats: [{ name: "Skilled", desc: authoredFeatDesc("Skilled") }],
    choices: { skilled: { skills: ["arcana", "history", "insight"], tools: ["thieves' tools"] } },
    strict: false,
  });
  assert.deepEqual(over.proficiencies.tools, []);
  const skillful = featGrantSpec("Learn three skills, languages, or tool proficiencies in any combination. If you already have proficiency in a chosen skill, you instead gain a skill specialty with that skill.");
  assert.equal(skillful.any, 3);
  assert.deepEqual(skillful.anyKinds, ["skills", "languages", "tools"]);
  assert.equal(featPicksOwed("Skillful", skillful, { languages: ["Orc"], skills: ["arcana"] }), "Skillful: pick 1 skill or language or tool.");
});

test("fixed skills and languages land, an armor pick is held to the list, and a weapon pick to the feat's part of the table", () => {
  const stalker = applyFeatGrants({
    proficiencies: base,
    feats: [{ name: "Stalker", desc: "* You gain proficiency in the Stealth and Survival skills." }],
    choices: {},
    strict: true,
  });
  assert.deepEqual(stalker.problems, []);
  assert.ok(stalker.proficiencies.skills.includes("stealth") && stalker.proficiencies.skills.includes("survival"));
  const sylvan = applyFeatGrants({ proficiencies: base, feats: [{ name: "Forest Denizen", desc: "You learn to speak, read, and write Sylvan." }], choices: {}, strict: true });
  assert.ok(sylvan.proficiencies.languages.includes("Sylvan"));
  const heraldicDesc = "You gain proficiency in your choice of one martial weapon, one rare weapon, or shields.";
  const noShields = { ...base, armor: ["light"] };
  const shields = applyFeatGrants({ proficiencies: noShields, feats: [{ name: "Heraldic Training", desc: heraldicDesc }], choices: { "heraldic training": { armor: ["shields"] } }, strict: true });
  assert.deepEqual(shields.problems, []);
  assert.ok(shields.proficiencies.armor.includes("shields"));
  const plate = applyFeatGrants({ proficiencies: noShields, feats: [{ name: "Heraldic Training", desc: heraldicDesc }], choices: { "heraldic training": { armor: ["heavy"] } }, strict: true });
  assert.match(plate.problems.join(" "), /not armor Heraldic Training offers/);
  const owedBoth = featPicksOwed("Heraldic Training", featGrantSpec(heraldicDesc), undefined);
  assert.equal(owedBoth, "Heraldic Training: pick 1 weapon or armor.");
  const club = applyFeatGrants({ proficiencies: { ...base, weapons: [] }, feats: [{ name: "Heraldic Training", desc: heraldicDesc }], choices: { "heraldic training": { weapons: ["Club"] } }, strict: true });
  assert.match(club.problems.join(" "), /Club is not a weapon Heraldic Training offers/);
  const sword = applyFeatGrants({ proficiencies: { ...base, weapons: [] }, feats: [{ name: "Heraldic Training", desc: heraldicDesc }], choices: { "heraldic training": { weapons: ["Longsword"] } }, strict: true });
  assert.deepEqual(sword.problems, []);
  assert.deepEqual(sword.proficiencies.weapons, ["Longsword"]);
  // An edit takes a picked armor off before the regrant, never a fixed one.
  const stripped = withoutFeatPicks({ ...base, armor: ["light", "heavy", "shields"] }, { "heraldic training": { armor: ["shields"] } });
  assert.deepEqual(stripped.armor, ["light", "heavy"]);
});

test("a feat's ability point is read from its text in every wording, and a pack feat's twin answers to ODM's name", () => {
  const from = (desc) => featAbilityIncreaseFrom(desc)?.from ?? null;
  assert.deepEqual(from("Increase your Charisma by 1, to a maximum of 20."), ["cha"]);
  assert.deepEqual(from("Increase your Strength or Dexterity by 1, to a maximum of 20."), ["str", "dex"]);
  assert.deepEqual(from("Increase one ability score by 1, to a maximum of 20."), ["str", "dex", "con", "int", "wis", "cha"]);
  assert.deepEqual(from("* Increase your Wisdom score by 1, up to a maximum of 20."), ["wis"]);
  assert.deepEqual(from("* Increase your Intelligence or Wisdom score by 1, to a maximum of 20."), ["int", "wis"]);
  assert.deepEqual(from("Raise your Strength attribute by 1, up to the attribute cap of 20."), ["str"]);
  assert.deepEqual(from("Raise your Strength or Dexterity Attribute by 1, to the attribute cap of 20."), ["str", "dex"]);
  assert.deepEqual(from("Your Strength or Dexterity score increases by 1, to a maximum of 20."), ["str", "dex"]);
  assert.deepEqual(from("Your Wisdom or Charisma score increases by 1."), ["wis", "cha"]);
  assert.deepEqual(from("An ability score of your choice increases by 1."), ["str", "dex", "con", "int", "wis", "cha"]);
  assert.deepEqual(from("Choose an attribute and raise it by 1, up to the attribute cap of 20, and become proficient with saving throws using the selected attribute."), ["str", "dex", "con", "int", "wis", "cha"]);
  // Not a point: speed, passive scores, exertion, hit points.
  assert.equal(from("Your Speed increases by 5 feet."), null);
  assert.equal(from("Increase your passive perception and investigation scores by +5."), null);
  assert.equal(from("Your exertion pool increases by 3."), null);
  assert.equal(from("Any form of movement you possess is increased by 10 feet."), null);
  // Tenacious is Resilient: the save follows the raised score.
  assert.equal(featSaveProficiency("Tenacious", "wis"), "wis");
  assert.equal(featSaveProficiency("Some Pack Feat", "con", "become proficient with saving throws using the selected attribute"), "con");
  assert.equal(featSaveProficiency("Athlete", "str"), null);
  assert.equal(featTwinOf("Hardy Adventurer"), "tough");
  assert.equal(featTwinOf("Attentive"), "alert");
  assert.equal(featTwinOf("Linguist"), "linguist");
  assert.equal(holdsFeat({ feats: ["Crossbow Expertise"] }, "Crossbow Expert"), true);
  assert.equal(holdsFeat({ feats: ["Battle Caster"] }, "War Caster"), false);
});

test("a prerequisite is checked in the packs' wordings: emphasis, Requires, several requirements, skills, weapons, level", () => {
  const who = { abilities: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 14 }, armor: ["light"], casts: false, raceId: "human", raceName: "Human", skills: ["survival"], tools: [], weapons: ["simple"], level: 4 };
  assert.equal(unmetPrerequisite("*Constitution 13 or higher*", who), "Constitution 13 or higher");
  assert.equal(unmetPrerequisite("*Charisma 13 or higher and the Sorcery Points class feature*", who), null);
  assert.equal(unmetPrerequisite("*Wisdom 13 or higher and the Ki class feature*", who), "Wisdom 13 or higher and the Ki class feature");
  assert.equal(unmetPrerequisite("Requires Dexterity 13 or higher", who), "Dexterity 13 or higher");
  assert.equal(unmetPrerequisite("Requires Charisma 13", who), null);
  assert.equal(unmetPrerequisite("Requires intelligence or Wisdom 13 or higher", who), "intelligence or Wisdom 13 or higher");
  assert.equal(unmetPrerequisite("Requires proficiency with medium armor.", who), "proficiency with medium armor");
  assert.equal(unmetPrerequisite("Requires the ability to cast one spell", who), "the ability to cast one spell");
  assert.equal(unmetPrerequisite("Requires the ability to cast one spell", { ...who, casts: true }), null);
  assert.equal(unmetPrerequisite("Prerequisite: Proficiency with Survival, 8th level or higher", who), "Proficiency with Survival, 8th level or higher");
  assert.equal(unmetPrerequisite("Prerequisite: Proficiency with Survival, 8th level or higher", { ...who, level: 8 }), null);
  assert.equal(unmetPrerequisite("*Proficiency in the Animal Handling skill*", who), "Proficiency in the Animal Handling skill");
  assert.equal(unmetPrerequisite("*Proficiency in one of the following skills: Arcana, History, or Nature*", { ...who, skills: ["history"] }), null);
  assert.equal(unmetPrerequisite("*Proficiency in one of the following skills: Arcana, History, or Nature*", who), "Proficiency in one of the following skills: Arcana, History, or Nature");
  assert.equal(unmetPrerequisite("Prerequisite: Proficiency with at least one martial weapon", who), "Proficiency with at least one martial weapon");
  assert.equal(unmetPrerequisite("Prerequisite: Proficiency with at least one martial weapon", { ...who, weapons: ["Longsword"] }), null);
  assert.equal(unmetPrerequisite("*Proficiency with a ranged weapon*", who), null);
  assert.equal(unmetPrerequisite("*Proficiency with a ranged weapon*", { ...who, weapons: ["Longsword"] }), "Proficiency with a ranged weapon");
  assert.equal(unmetPrerequisite("Prerequisite: Proficiency with a type of vehicle", who), "Proficiency with a type of vehicle");
  assert.equal(unmetPrerequisite("Prerequisite: Proficiency with a type of vehicle", { ...who, tools: ["vehicles (land)"] }), null);
  assert.equal(unmetPrerequisite("Prerequisite: 8th level or higher", who), "8th level or higher");
  // What the server cannot check is left to the table.
  assert.equal(unmetPrerequisite("*N/A*", who), null);
  assert.equal(unmetPrerequisite("Prerequisite: Prestige rating of 2 or higher", who), null);
  assert.equal(unmetPrerequisite("*A race or background from a cold climate and the ability to cast at least one spell*", { ...who, casts: true }), null);
  // A field holding the feat's rules asks nothing.
  assert.equal(unmetPrerequisite("Choose an attribute and raise it by 1, up to the attribute cap of 20, and become proficient with saving throws using the selected attribute.", who), null);
  // ODM's own wordings still hold.
  assert.equal(unmetPrerequisite("Strength 13 or higher", who), "Strength 13 or higher");
  assert.equal(unmetPrerequisite("Proficiency with medium armor", { ...who, armor: ["light", "medium"] }), null);
  assert.equal(unmetPrerequisite("Elf or half-elf", who), "Elf or half-elf");
});

console.log(`\ntest-feat-grants: ${passed} tests passed.`);
