// Backgrounds, starting gear, the starting purse and starting hit points.
//
// SRD 5.1 has one background, the Acolyte: Insight and Religion, two
// languages, a holy symbol, a prayer book, five sticks of incense, vestments,
// common clothes and a pouch of 15 gp, and the feature Shelter of the
// Faithful. The 2014 rule every background follows: two skill proficiencies,
// and two tool proficiencies or languages between them, a kit, a purse and
// one feature. A 2014 background never raises an ability score and never
// grants a feat; those are the 2024 rules.
//
// Hit points: the hit die's maximum plus the Constitution modifier at 1st
// level; each level after adds the die's fixed value (half plus one) plus the
// modifier, and never less than 1.
//
// ODM's own rules, pinned: the twelve other Player's Handbook backgrounds are
// bundled under the SRD's name, and 36 setting backgrounds of ODM's writing
// beside them. Starting gear is the class's SRD 5.1 starting equipment with
// the choices the player made (src/lib/srd/starting-kit.ts; the kits
// themselves are pinned in scripts/test-enforce-starting-kit.mjs), then the
// background's kit, and the player may buy anything else from the purse.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite, abilityMod } from "./lib/enforce-harness.mjs";
import { openCreation } from "./lib/enforce-creation.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";

const { test, finish } = suite("test-enforce-backgrounds");
const { world, atTable } = await openCreation();
const builder = await openBuilder();
const srd = await import("../src/lib/srd/index.ts");
const { CUSTOM_BACKGROUNDS } = await import("../src/lib/backgrounds/index.ts");
const { backgroundMechanics } = await import("../src/lib/content/mechanics.ts");
const { listBackgrounds } = await import("../src/lib/content/index.ts");
const { contentPackInstalled } = await import("../src/lib/content/db.ts");
// CI has no content pack; what needs a pack row asks first.
const hasPack = contentPackInstalled();
const { builderMaxHp } = await import("../src/app/characters/builder/abilityDice.ts");
const { defaultArmor, suggestArmor } = await import("../src/lib/srd/armor.ts");
const { classKitFor, startingKitFor } = await import("../src/lib/srd/starting-kit.ts");
const { resolveBackgroundGear } = await import("../src/lib/srd/adventuring-gear.ts");

// SRD 5.1 (Acolyte) and the 2014 Player's Handbook: skills, how many tools,
// how many languages of choice, the purse in gold pieces, the feature.
const BACKGROUNDS = {
  acolyte: { skills: ["insight", "religion"], tools: 0, languages: 2, gold: 15, feature: "Shelter of the Faithful" },
  charlatan: { skills: ["deception", "sleight_of_hand"], tools: 2, languages: 0, gold: 15, feature: "False Identity" },
  criminal: { skills: ["deception", "stealth"], tools: 2, languages: 0, gold: 15, feature: "Criminal Contact" },
  entertainer: { skills: ["acrobatics", "performance"], tools: 2, languages: 0, gold: 15, feature: "By Popular Demand" },
  folk_hero: { skills: ["animal_handling", "survival"], tools: 2, languages: 0, gold: 10, feature: "Rustic Hospitality" },
  guild_artisan: { skills: ["insight", "persuasion"], tools: 1, languages: 1, gold: 15, feature: "Guild Membership" },
  hermit: { skills: ["medicine", "religion"], tools: 1, languages: 1, gold: 5, feature: "Discovery" },
  noble: { skills: ["history", "persuasion"], tools: 1, languages: 1, gold: 25, feature: "Position of Privilege" },
  outlander: { skills: ["athletics", "survival"], tools: 1, languages: 1, gold: 10, feature: "Wanderer" },
  sage: { skills: ["arcana", "history"], tools: 0, languages: 2, gold: 10, feature: "Researcher" },
  sailor: { skills: ["athletics", "perception"], tools: 2, languages: 0, gold: 10, feature: "Ship's Passage" },
  soldier: { skills: ["athletics", "intimidation"], tools: 2, languages: 0, gold: 10, feature: "Military Rank" },
  urchin: { skills: ["sleight_of_hand", "stealth"], tools: 2, languages: 0, gold: 10, feature: "City Secrets" },
};
const ACOLYTE_KIT = ["holy symbol", "prayer book", "5 sticks of incense", "vestments", "common clothes"];
const GRANT_KEYS = ["id", "name", "skills", "feature", "featureDesc", "tools", "languages", "equipment", "blurb", "genres"];
const purseOf = (background) => {
  const line = (background.equipment ?? []).map((item) => /^(\d+) gp$/.exec(item)).find(Boolean);
  return line ? Number(line[1]) : null;
};
const sorted = (list) => [...list].sort();

// A level 1 dragonborn wizard of the background: a race that grants no skill,
// tool or language choice, and a class whose skills no bundled background
// blocks both of, so every grant on the sheet is the background's to explain.
function buildBackground(backgroundId, fields = {}) {
  const background = builder.backgrounds.find((entry) => entry.id === backgroundId);
  const taken = new Set(background.skills);
  const book = ["Sleep", "Shield", "Identify", "Detect Magic", "Feather Fall", "Charm Person"];
  return builder.build({
    race: "dragonborn",
    class: "wizard",
    background: backgroundId,
    scores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    chosenSkills: ["arcana", "history", "insight", "investigation", "medicine", "religion"].filter((skill) => !taken.has(skill)).slice(0, 2),
    bonusLanguages: ["Giant", "Sylvan", "Abyssal"].slice(0, background.languages ?? 0),
    cantrips: ["Light", "Mage Hand", "Fire Bolt"],
    spells: book,
    bookPrepared: book.slice(0, 3),
    racialAncestry: "red",
    ...fields,
  });
}

// The tools a background's grant comes to on the sheet: what it names, then
// the builder's first pick for each "one gaming set" it leaves open.
const tools = await import("../src/lib/srd/tool-choices.ts");
function namedTools(grants) {
  const { fixed, choices } = tools.splitToolGrants(grants);
  return [...fixed, ...choices.flatMap((choice) => choice.from.slice(0, choice.count))];
}

await test("the Acolyte is the SRD's, item for item", () => {
  const acolyte = srd.findBackground("acolyte");
  assert.deepEqual(acolyte.skills, ["insight", "religion"]);
  assert.deepEqual(acolyte.tools, []);
  assert.equal(acolyte.languages, 2);
  assert.equal(acolyte.feature, "Shelter of the Faithful");
  assert.deepEqual(acolyte.equipment.filter((item) => !/ gp$/.test(item)), ACOLYTE_KIT);
  assert.equal(purseOf(acolyte), 15);
});

await test("the bundled backgrounds match the 2014 table: skills, tools, languages, purse, feature", () => {
  assert.deepEqual(sorted(srd.SRD_BACKGROUNDS.map((background) => background.id)), sorted(Object.keys(BACKGROUNDS)));
  for (const [id, rule] of Object.entries(BACKGROUNDS)) {
    const background = srd.findBackground(id);
    assert.deepEqual(background.skills, rule.skills, `${id} skills`);
    assert.equal(background.tools.length, rule.tools, `${id} tools`);
    assert.equal(background.languages, rule.languages, `${id} languages`);
    assert.equal(background.feature, rule.feature, `${id} feature`);
    assert.equal(purseOf(background), rule.gold, `${id} purse`);
    // Two skills, and two tools or languages between them.
    assert.equal(rule.tools + rule.languages, 2, id);
  }
});

await test("every background, ODM's own included, gives two real skills and nothing a 2014 background cannot", () => {
  assert.equal(CUSTOM_BACKGROUNDS.length, 36);
  const all = [...srd.SRD_BACKGROUNDS, ...CUSTOM_BACKGROUNDS];
  assert.equal(new Set(all.map((background) => background.id)).size, all.length);
  for (const background of all) {
    assert.equal(background.skills.length, 2, `${background.id} skills`);
    assert.notEqual(background.skills[0], background.skills[1], `${background.id} repeats a skill`);
    for (const skill of background.skills) {
      assert.ok(srd.findSkill(skill), `${background.id} grants ${skill}`);
    }
    assert.ok(background.feature.length > 0, `${background.id} has no feature`);
    assert.ok(background.equipment.length > 0, `${background.id} has no kit`);
    assert.ok(Number.isInteger(background.languages) && background.languages >= 0 && background.languages <= 2);
    // No ability scores, no feat, no spells: the row has nowhere to put them.
    for (const key of Object.keys(background)) {
      assert.ok(GRANT_KEYS.includes(key), `${background.id} carries "${key}"`);
    }
  }
});

await test("the stored sheet carries the background: skills, tools, languages, kit and feature", async () => {
  for (const background of [...srd.SRD_BACKGROUNDS, ...CUSTOM_BACKGROUNDS]) {
    const built = buildBackground(background.id);
    assert.equal(built.blocker, null, `${background.id}: ${built.blocker?.message}`);
    const { status, sheet, error } = await atTable(built.sheet);
    assert.equal(status, 201, `${background.id}: ${error}`);
    const profs = sheet.proficiencies;
    assert.equal(sheet.background, background.id);
    assert.equal(profs.skills.length, 4, `${background.id} skills: ${profs.skills}`);
    for (const skill of background.skills) {
      assert.ok(profs.skills.includes(skill), `${background.id} lacks ${skill}`);
    }
    // A wizard and a dragonborn bring no tools; Common and Draconic are the race's.
    assert.deepEqual(profs.tools, namedTools(background.tools), `${background.id} tools`);
    assert.equal(profs.languages.length, 2 + background.languages, `${background.id} languages`);
    // The kit arrives as catalog items, the way the class kit does: a pack
    // opened, "common clothes" as "Clothes, Common" (issue #113).
    const kit = sheet.equipment.map((item) => item.name);
    for (const item of resolveBackgroundGear(background.equipment).filter((entry) => !/ gp$/.test(entry))) {
      assert.ok(kit.includes(item), `${background.id} kit lacks ${item}`);
    }
    // The server grants the feature itself, once.
    const features = sheet.features.filter((feature) => feature.source === "background");
    assert.deepEqual(features.map((feature) => feature.name), [`${background.feature} (${background.name})`.slice(0, 80)], background.id);
    // The ability scores are the race's and the array's: a background adds none.
    assert.deepEqual(sheet.abilities, { str: 10, dex: 14, con: 13, int: 15, wis: 12, cha: 11 }, background.id);
    assert.deepEqual(sheet.feats, [], background.id);
  }
});

await test("a background kit's 'of your choice' line follows the tool the player picked, and an either-or line follows the gear pick, at the builder and at the table (issue #127)", async () => {
  if (!hasPack) {
    return;
  }
  const { mergedBackgroundOptions } = await import("../src/lib/characters/options.ts");
  const rows = mergedBackgroundOptions(listBackgrounds({ limit: 200 }));
  const withRow = (row, fields) => {
    // A background's own skill picks (Guildmember: "two of your choice") must
    // not be the class's, so each side picks around the other.
    const backgroundSkills = row.skillChoice ? row.skillChoice.from.filter((skill) => !row.skills.includes(skill)).slice(0, row.skillChoice.count) : [];
    const classSkills = ["acrobatics", "history", "insight", "perception", "survival"]
      .filter((skill) => !row.skills.includes(skill) && !backgroundSkills.includes(skill))
      .slice(0, 2);
    return builder.build({
      race: "human",
      class: "fighter",
      background: row,
      chosenSkills: classSkills,
      stylePicks: ["defense"],
      bonusLanguages: ["Elvish", "Dwarvish", "Giant"].slice(0, 1 + (row.languages ?? 0)),
      backgroundSkills,
      ...fields,
    });
  };
  // Court Servant: "A set of artisan's tools of your choice" is the tool
  // proficiency the class step asked for.
  const courtServant = rows.find((row) => row.name === "Court Servant");
  assert.ok(courtServant, "the pack's Court Servant");
  const servant = withRow(courtServant, { toolPicks: ["calligrapher's supplies"] });
  assert.equal(servant.blocker, null, servant.blocker?.message);
  const servantKit = servant.sheet.equipment.map((item) => item.name);
  assert.ok(servantKit.includes("Calligrapher's Supplies"), `kit: ${servantKit}`);
  assert.ok(!servantKit.some((name) => /of your choice/i.test(name)), `kit still carries the line: ${servantKit}`);
  const servantAt = await atTable(servant.sheet);
  assert.equal(servantAt.status, 201, servantAt.error);
  assert.ok(servantAt.sheet.equipment.some((item) => item.name === "Calligrapher's Supplies"));
  // The kit is free: the purse is the background's 20 gp, untouched.
  assert.equal(servantAt.sheet.gold, 20, "the filled tool was charged for");
  // Innkeeper: two either-or lines, the book's first until picked.
  const innkeeper = rows.find((row) => row.name === "Innkeeper");
  assert.ok(innkeeper, "the pack's Innkeeper");
  const first = withRow(innkeeper, {});
  assert.equal(first.blocker, null, first.blocker?.message);
  const firstKit = first.sheet.equipment.map((item) => item.name);
  assert.ok(firstKit.includes("Brewer's Supplies") && firstKit.includes("Dagger"), `kit: ${firstKit}`);
  assert.deepEqual(first.sheet.backgroundChoices.gear, ["Brewer's supplies", "Dagger"]);
  const picked = withRow(innkeeper, { backgroundGearPicks: ["Cook's utensils", "Light hammer"] });
  const pickedKit = picked.sheet.equipment.map((item) => item.name);
  assert.ok(pickedKit.includes("Cook's Utensils") && pickedKit.includes("Light Hammer"), `kit: ${pickedKit}`);
  assert.ok(!pickedKit.includes("Brewer's Supplies") && !pickedKit.some((name) => /\bor\b/.test(name)), `kit: ${pickedKit}`);
  assert.deepEqual(picked.sheet.backgroundChoices.gear, ["Cook's utensils", "Light hammer"]);
  const pickedAt = await atTable(picked.sheet);
  assert.equal(pickedAt.status, 201, pickedAt.error);
  assert.ok(pickedAt.sheet.equipment.some((item) => item.name === "Light Hammer"));
  assert.equal(pickedAt.sheet.gold, 20, "the picked alternative was charged for");
  // The table copy keeps the gear, not the builder's picks: those live on
  // the library copy, where an edit reopens with them.
  // A pick the line does not offer is refused at the table.
  const wrong = { ...picked.sheet, backgroundChoices: { ...picked.sheet.backgroundChoices, gear: ["Greatsword", "Light hammer"] } };
  const wrongAt = await atTable(wrong);
  assert.equal(wrongAt.status, 400, "an alternative the kit does not offer");
  assert.match(wrongAt.error, /brewer's supplies or cook's utensils/);
  // Guildmember (a5e): "One set of artisan's tools or one instrument", a
  // choice between two KINDS of tool with no tool proficiency to fill it
  // from (Smoebo's follow-up on #127). The kind's first until named, the
  // named tool when named, and a tool of neither kind refused.
  const guildmember = rows.find((row) => row.name === "Guildmember");
  assert.ok(guildmember, "the pack's Guildmember");
  const guild = withRow(guildmember, {});
  assert.equal(guild.blocker, null, guild.blocker?.message);
  const guildKit = guild.sheet.equipment.map((item) => item.name);
  assert.ok(guildKit.includes("Alchemist's Supplies"), `kit: ${guildKit}`);
  assert.ok(!guildKit.some((name) => /\bor\b/.test(name)), `kit still carries the line: ${guildKit}`);
  assert.deepEqual(guild.sheet.backgroundChoices.gear, ["Alchemist's Supplies"]);
  const drummer = withRow(guildmember, { backgroundGearPicks: ["Drum"] });
  const drummerKit = drummer.sheet.equipment.map((item) => item.name);
  assert.ok(drummerKit.includes("Drum") && !drummerKit.includes("Alchemist's Supplies"), `kit: ${drummerKit}`);
  assert.deepEqual(drummer.sheet.backgroundChoices.gear, ["Drum"]);
  const guildAt = await atTable(guild.sheet);
  assert.equal(guildAt.status, 201, guildAt.error);
  const drummerAt = await atTable(drummer.sheet);
  assert.equal(drummerAt.status, 201, drummerAt.error);
  assert.ok(drummerAt.sheet.equipment.some((item) => item.name === "Drum"));
  // The kit is free whichever tool is named: the same purse either way.
  assert.equal(drummerAt.sheet.gold, guildAt.sheet.gold, "the named instrument was charged for");
  const wrongTool = { ...drummer.sheet, backgroundChoices: { ...drummer.sheet.backgroundChoices, gear: ["Thieves' Tools"] } };
  const wrongToolAt = await atTable(wrongTool);
  assert.equal(wrongToolAt.status, 400, "a tool of neither kind");
  assert.match(wrongToolAt.error, /artisan's tools or instrument/);
});

await test("a background's feature is the server's grant: a request cannot swap it or stack another", async () => {
  const built = buildBackground("acolyte");
  const swapped = await atTable({ ...built.sheet, features: [{ name: "Position of Privilege (Noble)", source: "class" }] });
  const names = swapped.sheet.features.filter((feature) => feature.source === "background").map((feature) => feature.name);
  assert.deepEqual(names, ["Shelter of the Faithful (Acolyte)"]);
  // No background, no feature.
  // With the background go the skills, languages and kit it granted: a
  // sheet that kept them would have nothing to have them from.
  const none = await atTable({
    ...built.sheet,
    background: "",
    equipment: built.sheet.equipment.slice(0, 2),
    proficiencies: {
      ...built.sheet.proficiencies,
      skills: built.sheet.proficiencies.skills.filter((skill) => skill !== "insight" && skill !== "religion"),
      languages: ["Common", "Draconic"],
    },
  });
  assert.deepEqual(none.sheet.features.filter((feature) => feature.source === "background"), []);
});

await test("the content pack's backgrounds are read as 2014 backgrounds", () => {
  // Rows shaped like the pack's: v1 prose, and a v2 row whose benefits carry
  // an ability score increase (Level Up's backgrounds do), which a 2014
  // character must not receive.
  const prose = backgroundMechanics({
    skill_proficiencies: "Arcana, Religion",
    tool_proficiencies: "Thieves' tools",
    languages: "Two of your choice",
    equipment: "A bottle of black ink, a quill, a belt pouch containing 5 gp",
  });
  assert.deepEqual(prose.skills, ["arcana", "religion"]);
  assert.equal(prose.languages, 2);
  const levelUp = backgroundMechanics({
    benefits: [
      { type: "ability_score", desc: "+1 to Wisdom and one other ability score." },
      { type: "skill_proficiency", desc: "Religion, and either Arcana or Deception." },
      { type: "feat", desc: "Magic Initiate" },
      { type: "language", desc: "One of your choice." },
    ],
  });
  assert.deepEqual(sorted(Object.keys(levelUp)), ["equipment", "knownLanguages", "languages", "skillChoice", "skills", "tools"]);
  assert.deepEqual(levelUp.skills, ["religion"]);
  assert.deepEqual(levelUp.skillChoice, { count: 1, from: ["arcana", "deception"] });
  if (!hasPack) {
    return;
  }
  const rows = listBackgrounds({ limit: 200 });
  assert.ok(rows.length > 40);
  assert.deepEqual(rows.filter((row) => row.documentSlug === "srd-2024").map((row) => row.slug), [], "2024 backgrounds in the pack");
  for (const row of rows) {
    const grants = backgroundMechanics(row.data);
    assert.ok(grants.skills.length + (grants.skillChoice?.count ?? 0) <= 2, `${row.slug} grants more than two skills`);
  }
});

// ---- starting gear ----

await test("A new character starts with its class's SRD 5.1 starting equipment, the book's first choice on every line until the player picks another, then the background's kit.", () => {
  // The wizard's: (a) a quarterstaff, (a) a component pouch, (a) a
  // scholar's pack, a spellbook; the acolyte's kit after it.
  const sheet = buildBackground("acolyte").sheet;
  const names = sheet.equipment.map((item) => item.name);
  assert.deepEqual(names.slice(0, 3), ["Quarterstaff", "Component Pouch", "Backpack"]);
  assert.ok(names.includes("Spellbook"), names.join(", "));
  assert.equal(sheet.equipment.find((item) => item.name === "Parchment (one sheet)")?.qty, 10);
  // The acolyte's kit under its catalog names (issue #113): "holy symbol"
  // is the Holy Symbol, "common clothes" is Clothes, Common.
  for (const item of resolveBackgroundGear(ACOLYTE_KIT)) {
    assert.ok(names.includes(item), `${item} is missing: ${names.join(", ")}`);
  }
  assert.ok(names.indexOf("Spellbook") < names.indexOf("Holy Symbol"));
  // Nobody starts in plate (1,500 gp) or with anything magical, whatever
  // the choices.
  for (const klass of srd.SRD_CLASSES) {
    const kit = classKitFor(klass.id);
    assert.ok(kit, klass.id);
    const gear = kit.lines.flatMap((line) => line.options.flatMap((option) => option.items.map((item) => item.name)));
    assert.ok(!gear.some((name) => /plate|splint|\+\d/i.test(name)), `${klass.id}: ${gear}`);
  }
});

await test("Druids will not wear armor or use shields made of metal (SRD 5.1, Druid, Proficiencies); the SRD starts one in leather with a wooden shield.", () => {
  const kit = startingKitFor(srd.findClass("druid"), null);
  const gear = kit.items.map((item) => item.name);
  assert.ok(gear.includes("Leather") && gear.includes("Wooden Shield"), gear.join(", "));
  // SRD 5.1 armor table: the metal armors a druid's medium training reaches.
  for (const metal of ["Chain Shirt", "Scale Mail", "Breastplate", "Half Plate"]) {
    assert.ok(!gear.includes(metal), `a druid starts in ${metal}`);
  }
});

await test("A background's purse is its starting coin: 15 gp for an acolyte, 5 for a hermit, 25 for a noble.", () => {
  for (const [id, rule] of Object.entries(BACKGROUNDS)) {
    const sheet = buildBackground(id).sheet;
    assert.equal(sheet.gold, rule.gold, `${id} starts with ${sheet.gold} gp`);
    assert.ok(!sheet.equipment.some((item) => /^\d+ gp$/.test(item.name)), `${id} carries its purse as an item`);
  }
});

await test("A background gives two tool proficiencies or languages in all, in any mix (SRD 5.1, Customizing a Background).", () => {
  const off = CUSTOM_BACKGROUNDS.filter((background) => background.tools.length + background.languages !== 2).map((background) => background.id);
  assert.deepEqual(off, []);
});

await test("a druid is offered no metal armor, and still gets leather and a shield", () => {
  const training = srd.findClass("druid").armor;
  assert.deepEqual(defaultArmor(training).map((item) => item.name), ["Leather", "Shield"]);
  const offered = suggestArmor(training).map((item) => item.name);
  assert.ok(offered.includes("Hide") && offered.includes("Studded Leather"), offered.join(", "));
  for (const metal of ["Chain Shirt", "Scale Mail", "Breastplate", "Half Plate"]) {
    assert.ok(!offered.includes(metal), metal);
  }
  assert.ok(defaultArmor(srd.findClass("ranger").armor).some((item) => item.name === "Scale Mail"));
});

// ---- starting hit points ----

await test("hit points at every level, for every hit die and Constitution from 8 to 20", () => {
  const CLASS_BY_DIE = { 6: "wizard", 8: "rogue", 10: "fighter", 12: "barbarian" };
  for (const [die, classId] of Object.entries(CLASS_BY_DIE)) {
    const size = Number(die);
    // SRD 5.1: the fixed value is 4 for a d6, 5 for a d8, 6 for a d10, 7 for a d12.
    const fixed = { 6: 4, 8: 5, 10: 6, 12: 7 }[size];
    for (let con = 8; con <= 20; con += 1) {
      for (let level = 1; level <= 20; level += 1) {
        const expected = size + abilityMod(con) + (level - 1) * (fixed + abilityMod(con));
        assert.equal(srd.suggestedStartingHp(classId, "human", con, level), expected, `${classId} ${level}, CON ${con}`);
        assert.equal(builderMaxHp(size, "human", con, level), expected, `builder, d${size} ${level}, CON ${con}`);
        // Dwarven Toughness: one more for every level.
        assert.equal(srd.suggestedStartingHp(classId, "hill_dwarf", con, level), expected + level);
        assert.equal(srd.suggestedStartingHp(classId, "mountain_dwarf", con, level), expected);
      }
    }
  }
});

await test("a character has at least 1 hit point", () => {
  assert.equal(srd.suggestedStartingHp("wizard", "human", 1, 1), 1);
  assert.equal(srd.suggestedStartingHp("wizard", "human", 3, 1), 2);
  assert.equal(builderMaxHp(6, "human", 1, 1), 1);
  assert.equal(buildBackground("sage", { method: "roll", scores: { str: 8, dex: 14, con: 3, int: 15, wis: 12, cha: 10 } }).sheet.maxHp, 2);
});

await test("Each level gained adds the hit die's value plus the Constitution modifier, and never less than 1 hit point (SRD 5.1, Beyond 1st Level).", () => {
  for (const [classId, die, fixed] of [["wizard", 6, 4], ["rogue", 8, 5]]) {
    for (const con of [1, 3]) {
      for (const level of [2, 5, 20]) {
        const expected = Math.max(1, die + abilityMod(con)) + (level - 1) * Math.max(1, fixed + abilityMod(con));
        assert.equal(srd.suggestedStartingHp(classId, "human", con, level), expected, `${classId} ${level}, CON ${con}`);
      }
    }
  }
});

if (hasPack) {
  await test("Every background gives two skill proficiencies: a pack row that grants none is not offered.", () => {
    const short = listBackgrounds({ limit: 200 })
      .filter((row) => {
        const grants = backgroundMechanics(row.data);
        return grants.skills.length + (grants.skillChoice?.count ?? 0) !== 2;
      })
      .map((row) => row.slug);
    assert.deepEqual(short, []);
  });
}

world.close();
finish();
