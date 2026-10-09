// What a race gives a level 1 character, and whether the sheet can use it.
//
// The first table below is SRD 5.1's nine races, written out: ability score
// increases, speed, size, darkvision, languages, and the proficiencies and
// resistances their traits grant. The second is the 2014 Player's Handbook
// subraces ODM also bundles (they are not in the SRD, but they are 2014 rules
// and ODM names them "enforced" in docs/rules-coverage.md). Both are held
// against src/lib/srd/races.json, against the sheet the builder makes, and
// against that sheet as the table stores it.
//
// A trait that is only a name on the sheet enforces nothing, so each grant is
// read where an engine reads it: darkvision from the light model's senses
// (src/lib/battlemap/view.ts sheetSenses), resistances from the list the
// damage engine halves by (src/lib/dm/condition-logic.ts pcResistances),
// size from sizeForRace, limited-use traits from the sheet's counters.
// Whether the damage engine then halves the damage is another suite's.
//
// ODM's own rules, pinned: nineteen more lineages written by ODM (aasimar to
// lizardfolk) are bundled beside these, and a race the server has no table
// for keeps the trait names the builder sent.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite, abilityMod } from "./lib/enforce-harness.mjs";
import { openCreation } from "./lib/enforce-creation.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";

const { test, finish } = suite("test-enforce-races");
const { world, atTable } = await openCreation();
const builder = await openBuilder();
const srd = await import("../src/lib/srd/index.ts");
const { populateFeatures } = await import("../src/lib/srd/features.ts");
const { populateResources, RESOURCE_DEFS } = await import("../src/lib/srd/class-resources.ts");
const { isWeaponProficient, SRD_WEAPONS } = await import("../src/lib/srd/weapons.ts");
const { sheetSenses } = await import("../src/lib/battlemap/view.ts");
const { pcResistances } = await import("../src/lib/dm/condition-logic.ts");
const { packRaceOptions } = await import("../src/lib/content/race-options.ts");
const { listRaces, searchFeats } = await import("../src/lib/content/index.ts");
const { contentPackInstalled } = await import("../src/lib/content/db.ts");
// CI has no content pack; what needs a pack row asks first.
const hasPack = contentPackInstalled();

const DWARF_WEAPONS = ["battleaxes", "handaxes", "light hammers", "warhammers"];
const ELF_WEAPONS = ["longswords", "shortswords", "shortbows", "longbows"];
const DWARF_TOOLS = ["smith's tools", "brewer's supplies", "mason's tools"];

// SRD 5.1, "Races". `vision` is darkvision in feet; `extra` is languages of
// the player's choice; `pick` is abilities of the player's choice at +1.
const SRD_RACES = {
  hill_dwarf: { asi: { con: 2, wis: 1 }, speed: 25, size: "Medium", vision: 60, languages: ["Common", "Dwarvish"], weapons: DWARF_WEAPONS, toolFrom: DWARF_TOOLS, resists: ["poison"], hpPerLevel: 1 },
  high_elf: { asi: { dex: 2, int: 1 }, speed: 30, size: "Medium", vision: 60, languages: ["Common", "Elvish"], extra: 1, skills: ["perception"], weapons: ELF_WEAPONS, cantrip: "wizard" },
  lightfoot_halfling: { asi: { dex: 2, cha: 1 }, speed: 25, size: "Small", vision: 0, languages: ["Common", "Halfling"] },
  human: { asi: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }, speed: 30, size: "Medium", vision: 0, languages: ["Common"], extra: 1 },
  dragonborn: { asi: { str: 2, cha: 1 }, speed: 30, size: "Medium", vision: 0, languages: ["Common", "Draconic"] },
  rock_gnome: { asi: { int: 2, con: 1 }, speed: 25, size: "Small", vision: 60, languages: ["Common", "Gnomish"], tools: ["tinker's tools"] },
  half_elf: { asi: { cha: 2 }, pick: 2, speed: 30, size: "Medium", vision: 60, languages: ["Common", "Elvish"], extra: 1, skillPicks: 2 },
  half_orc: { asi: { str: 2, con: 1 }, speed: 30, size: "Medium", vision: 60, languages: ["Common", "Orc"], skills: ["intimidation"] },
  tiefling: { asi: { int: 1, cha: 2 }, speed: 30, size: "Medium", vision: 60, languages: ["Common", "Infernal"], resists: ["fire"] },
};
// Player's Handbook (2014), the subraces the SRD leaves out.
const PHB_RACES = {
  mountain_dwarf: { asi: { str: 2, con: 2 }, speed: 25, size: "Medium", vision: 60, languages: ["Common", "Dwarvish"], weapons: DWARF_WEAPONS, toolFrom: DWARF_TOOLS, armor: ["light", "medium"], resists: ["poison"] },
  wood_elf: { asi: { dex: 2, wis: 1 }, speed: 35, size: "Medium", vision: 60, languages: ["Common", "Elvish"], skills: ["perception"], weapons: ELF_WEAPONS },
  drow: { asi: { dex: 2, cha: 1 }, speed: 30, size: "Medium", vision: 120, languages: ["Common", "Elvish"], skills: ["perception"], weapons: ["rapiers", "shortswords", "hand crossbows"] },
  stout_halfling: { asi: { dex: 2, con: 1 }, speed: 25, size: "Small", vision: 0, languages: ["Common", "Halfling"], resists: ["poison"] },
  forest_gnome: { asi: { int: 2, dex: 1 }, speed: 25, size: "Small", vision: 60, languages: ["Common", "Gnomish"] },
  variant_human: { asi: {}, pick: 2, speed: 30, size: "Medium", vision: 0, languages: ["Common"], extra: 1, skillPicks: 1 },
};
const RULEBOOK = { ...SRD_RACES, ...PHB_RACES };
const BASE = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
const sorted = (list) => [...(list ?? [])].sort();

// A level 1 soldier fighter of the race, every choice the race offers made.
function buildRace(raceId, fields = {}) {
  const race = builder.races.find((entry) => entry.id === raceId);
  const taken = new Set(["athletics", "intimidation", ...(race.skills ?? [])]);
  const classSkills = ["acrobatics", "history", "insight", "perception", "survival"].filter((skill) => !taken.has(skill)).slice(0, 2);
  const free = ["arcana", "deception", "medicine", "nature"];
  return builder.build({
    race: raceId,
    class: "fighter",
    background: "soldier",
    scores: BASE,
    chosenSkills: classSkills,
    stylePicks: ["defense"],
    bonusLanguages: ["Giant", "Sylvan", "Abyssal"].slice(0, race.bonusLanguages ?? 0),
    racialAsi: ["str", "dex", "con"].slice(0, race.asiChoice?.count ?? 0),
    racialSkills: free.slice(0, race.skillChoice?.count ?? 0),
    racialTool: race.toolChoice?.from[0] ?? "",
    racialCantrip: race.cantripChoice ? "Prestidigitation" : "",
    // A dragonborn chooses an ancestry; a race that repeats one of the
    // soldier's skills chooses another in its place.
    racialAncestry: raceId === "dragonborn" ? "red" : "",
    repeatSkills: (race.skills ?? []).filter((skill) => ["athletics", "intimidation"].includes(skill)).map((_, index) => ["religion", "investigation"][index]),
    // The variant human's feat, a racial choice like the rest (issue #124).
    feats: raceId === "variant_human" ? ["Alert"] : [],
    ...fields,
  });
}
// The sheet as the table holds it, once per race.
const stored = new Map();
async function seated(raceId) {
  if (!stored.has(raceId)) {
    const built = buildRace(raceId);
    assert.equal(built.blocker, null, `${raceId}: ${built.blocker?.message}`);
    const outcome = await atTable(built.sheet);
    assert.equal(outcome.status, 201, `${raceId}: ${outcome.error}`);
    stored.set(raceId, outcome.sheet);
  }
  return stored.get(raceId);
}

await test("the bundled race table matches the rulebook: bonuses, speed, size, languages", () => {
  for (const [raceId, rule] of Object.entries(RULEBOOK)) {
    const race = srd.findRace(raceId);
    assert.ok(race, raceId);
    assert.deepEqual(race.asi, rule.asi, `${raceId} ability bonuses`);
    assert.equal(race.asiChoice?.count ?? 0, rule.pick ?? 0, `${raceId} free ability bonuses`);
    assert.equal(race.asiChoice?.amount ?? 1, 1);
    assert.equal(race.speed, rule.speed, `${raceId} speed`);
    assert.equal(race.size, rule.size, `${raceId} size`);
    assert.equal(srd.sizeForRace(raceId), rule.size);
    assert.deepEqual(race.languages.filter((entry) => !/choice/i.test(entry)), rule.languages, `${raceId} languages`);
    assert.equal(race.bonusLanguages ?? 0, rule.extra ?? 0, `${raceId} extra languages`);
    assert.deepEqual(race.skills ?? [], rule.skills ?? [], `${raceId} skills`);
    assert.equal(race.skillChoice?.count ?? 0, rule.skillPicks ?? 0, `${raceId} skill picks`);
    assert.deepEqual(race.tools ?? [], rule.tools ?? [], `${raceId} tools`);
    assert.deepEqual(race.toolChoice?.from ?? [], rule.toolFrom ?? [], `${raceId} tool choice`);
    assert.deepEqual(race.armor ?? [], rule.armor ?? [], `${raceId} armor`);
    assert.equal(race.cantripChoice?.list, rule.cantrip, `${raceId} cantrip`);
  }
  // Every SRD race raises abilities by three points in all, humans by six.
  for (const [raceId, rule] of Object.entries(SRD_RACES)) {
    const total = Object.values(rule.asi).reduce((sum, bonus) => sum + bonus, 0) + (rule.pick ?? 0);
    assert.equal(total, raceId === "human" ? 6 : raceId === "half_elf" ? 4 : 3, raceId);
  }
});

await test("every bundled race is well formed, and none lowers a score", () => {
  assert.equal(srd.SRD_RACES.length, 31);
  assert.equal(new Set(srd.SRD_RACES.map((race) => race.id)).size, 31);
  for (const race of srd.SRD_RACES) {
    assert.ok([25, 30, 35].includes(race.speed), `${race.id} speed ${race.speed}`);
    assert.ok(["Small", "Medium"].includes(race.size), `${race.id} size`);
    assert.ok(race.languages.includes("Common"), `${race.id} speaks no Common`);
    assert.ok(race.traits.length > 0, `${race.id} has no traits`);
    for (const [ability, bonus] of Object.entries(race.asi)) {
      assert.ok(["str", "dex", "con", "int", "wis", "cha"].includes(ability));
      assert.ok(bonus === 1 || bonus === 2, `${race.id} ${ability} ${bonus}`);
    }
    for (const skill of race.skills ?? []) {
      assert.ok(srd.findSkill(skill), `${race.id} grants ${skill}`);
    }
  }
});

await test("the stored sheet carries the race: scores, speed, languages, skills, training, traits", async () => {
  for (const race of srd.SRD_RACES) {
    const rule = RULEBOOK[race.id];
    const sheet = await seated(race.id);
    const bonus = { ...(rule?.asi ?? race.asi) };
    for (const ability of ["str", "dex", "con"].slice(0, rule?.pick ?? race.asiChoice?.count ?? 0)) {
      bonus[ability] = (bonus[ability] ?? 0) + 1;
    }
    const expected = Object.fromEntries(Object.entries(BASE).map(([ability, score]) => [ability, score + (bonus[ability] ?? 0)]));
    assert.deepEqual(sheet.abilities, expected, `${race.id} abilities`);
    assert.equal(sheet.speed, rule?.speed ?? race.speed, `${race.id} speed`);
    const extra = rule?.extra ?? race.bonusLanguages ?? 0;
    const spoken = sheet.proficiencies.languages.filter((entry) => !/choice/i.test(entry));
    assert.deepEqual(sorted(spoken), sorted([...(rule?.languages ?? race.languages), ...["Giant", "Sylvan", "Abyssal"].slice(0, extra)]), `${race.id} languages`);
    // Two fighter skills, the soldier's Athletics and Intimidation, and the
    // race's. A skill the race and the soldier both give is replaced by
    // another of the player's choice, so every grant counts.
    const fixed = rule?.skills ?? race.skills ?? [];
    const racial = fixed.length + (rule?.skillPicks ?? race.skillChoice?.count ?? 0);
    assert.equal(sheet.proficiencies.skills.length, 4 + racial, `${race.id} skills: ${sheet.proficiencies.skills}`);
    assert.equal(new Set(sheet.proficiencies.skills).size, sheet.proficiencies.skills.length, `${race.id} repeats a skill`);
    for (const skill of rule?.skills ?? race.skills ?? []) {
      assert.ok(sheet.proficiencies.skills.includes(skill), `${race.id} lacks ${skill}`);
    }
    for (const tool of [...(rule?.tools ?? race.tools ?? []), ...(race.toolChoice ? [race.toolChoice.from[0]] : [])]) {
      assert.ok(sheet.proficiencies.tools.includes(tool), `${race.id} lacks ${tool}`);
    }
    for (const armor of rule?.armor ?? race.armor ?? []) {
      assert.ok(sheet.proficiencies.armor.includes(armor), `${race.id} lacks ${armor} armor`);
    }
    // The race's traits, and a dragonborn's chosen ancestry beside them.
    const traits = sheet.features
      .filter((feature) => feature.source === "race" && !/^draconic ancestry:/i.test(feature.name))
      .map((feature) => feature.name);
    assert.deepEqual(traits, race.traits, `${race.id} traits`);
    assert.equal(
      sheet.features.some((feature) => /^draconic ancestry: red/i.test(feature.name)),
      race.id === "dragonborn",
      `${race.id} ancestry`,
    );
    // 10 (fighter) + CON, and Dwarven Toughness's one more.
    assert.equal(sheet.maxHp, 10 + abilityMod(sheet.abilities.con) + (race.id === "hill_dwarf" ? 1 : 0), `${race.id} hit points`);
  }
});

await test("darkvision reaches the light model at the race's range", async () => {
  for (const [raceId, rule] of Object.entries(RULEBOOK)) {
    const senses = sheetSenses(await seated(raceId));
    // The map counts in 5-foot tiles.
    assert.equal(senses.darkvision, rule.vision / 5, `${raceId} darkvision`);
  }
});

await test("resistances the traits name reach the list the damage engine reads", async () => {
  for (const [raceId, rule] of Object.entries(RULEBOOK)) {
    if (raceId === "dragonborn") {
      continue;
    }
    const held = pcResistances(await seated(raceId)).split(", ").filter(Boolean);
    assert.deepEqual(sorted(held), sorted(rule.resists), `${raceId} resistances`);
  }
  // ODM's own lineages name theirs in the trait.
  const authored = { aasimar: ["necrotic", "radiant"], fire_genasi: ["fire"], water_genasi: ["acid"], air_genasi: ["lightning"] };
  for (const [raceId, types] of Object.entries(authored)) {
    assert.deepEqual(sorted(pcResistances(await seated(raceId)).split(", ")), sorted(types), raceId);
  }
});

await test("limited-use traits are counters: Relentless Endurance, and a breath that grows", async () => {
  const halfOrc = await seated("half_orc");
  assert.deepEqual(halfOrc.resources.relentless_endurance, { max: 1, used: 0 });
  const dragonborn = await seated("dragonborn");
  assert.deepEqual(dragonborn.resources.breath_weapon, { max: 1, used: 0 });
  for (const raceId of Object.keys(RULEBOOK)) {
    const resources = Object.keys((await seated(raceId)).resources);
    const racial = resources.filter((id) => id !== "second_wind");
    assert.deepEqual(racial, raceId === "half_orc" ? ["relentless_endurance"] : raceId === "dragonborn" ? ["breath_weapon"] : [], raceId);
  }
  // SRD 5.1: 2d6, then 3d6 at 6th level, 4d6 at 11th and 5d6 at 16th; once
  // per short or long rest.
  const breath = RESOURCE_DEFS.find((entry) => entry.id === "breath_weapon");
  assert.equal(breath.recharge, "short");
  for (let level = 1; level <= 20; level += 1) {
    const dice = level >= 16 ? "5d6" : level >= 11 ? "4d6" : level >= 6 ? "3d6" : "2d6";
    assert.equal(breath.effect.dice(level), dice, `breath at level ${level}`);
    const features = populateFeatures([], "fighter", "", "dragonborn", level);
    assert.deepEqual(populateResources(features, level, { con: 1 }).breath_weapon, { max: 1, used: 0 });
  }
});

await test("race-taught weapons count as training when the class has none", async () => {
  const weapon = (name) => SRD_WEAPONS.find((entry) => entry.name === name);
  const cases = { wood_elf: ["Longsword", "Shortsword", "Shortbow", "Longbow"], drow: ["Rapier", "Shortsword", "Hand Crossbow"] };
  for (const [raceId, names] of Object.entries(cases)) {
    const wizard = buildRace(raceId, { class: "wizard", stylePicks: [], chosenSkills: ["arcana", "history"], cantrips: ["Light", "Mage Hand", "Fire Bolt"], spells: ["Sleep", "Shield", "Identify", "Detect Magic", "Feather Fall", "Charm Person"], bookPrepared: ["Sleep", "Shield"] });
    assert.equal(wizard.blocker, null, wizard.blocker?.message);
    for (const name of names) {
      assert.equal(isWeaponProficient(wizard.sheet.proficiencies.weapons, weapon(name)), true, `${raceId} wizard with a ${name}`);
    }
    assert.equal(isWeaponProficient(wizard.sheet.proficiencies.weapons, weapon("Greatsword")), false);
  }
});

await test("the builder asks for every choice the race offers", () => {
  assert.equal(buildRace("half_elf", { racialAsi: ["str"] }).blocker?.kind, "error");
  assert.equal(buildRace("half_elf", { racialSkills: ["arcana"] }).blocker?.kind, "error");
  assert.equal(buildRace("half_elf", { bonusLanguages: [] }).blocker?.kind, "error");
  assert.equal(buildRace("hill_dwarf", { racialTool: "" }).blocker?.kind, "error");
  assert.equal(buildRace("high_elf", { racialCantrip: "" }).blocker?.kind, "error");
  assert.equal(buildRace("variant_human", { racialSkills: [] }).blocker?.kind, "error");
  assert.equal(buildRace("human", { bonusLanguages: [] }).blocker?.kind, "error");
});

await test("a variant human leaves the builder with its feat, and the table refuses one without (issue #124)", async () => {
  const noFeat = buildRace("variant_human", { feats: [] });
  assert.equal(noFeat.blocker?.kind, "error");
  assert.match(noFeat.blocker.message, /feat/i);
  // The server holds the same rule for a character made at the table.
  const sent = { ...buildRace("variant_human").sheet, feats: [] };
  const refused = await atTable(sent);
  assert.equal(refused.status, 400, "a variant human with no feat was seated");
  assert.match(refused.error, /starts with a feat/);
  // With the feat, both doors open and the feat is on the sheet.
  const made = buildRace("variant_human");
  assert.equal(made.blocker, null, made.blocker?.message);
  assert.deepEqual(made.sheet.feats, ["Alert"]);
  const seated = await atTable(made.sheet);
  assert.equal(seated.status, 201, seated.error);
  assert.deepEqual(seated.sheet.feats, ["Alert"]);
});

await test("a racial skill also taken as a class skill is asked for again, not lost (issue #124)", () => {
  // Perception as the variant human's skill and as a fighter skill: the
  // sheet would carry four skills where the race gave five.
  const overlap = buildRace("variant_human", { racialSkills: ["perception"], chosenSkills: ["perception", "survival"] });
  assert.equal(overlap.blocker?.kind, "error");
  assert.match(overlap.blocker.message, /skill/i);
  const apart = buildRace("variant_human", { racialSkills: ["arcana"], chosenSkills: ["perception", "survival"] });
  assert.equal(apart.blocker, null, apart.blocker?.message);
  assert.equal(apart.sheet.proficiencies.skills.length, 5);
});

await test("with the content pack, the SRD's races come through its rows unchanged", () => {
  // Without a pack the bundled rows above are the same check.
  if (!hasPack) {
    return;
  }
  const options = packRaceOptions(listRaces({ limit: 200 }));
  const slugs = {
    "hill-dwarf": "hill_dwarf", "high-elf": "high_elf", lightfoot: "lightfoot_halfling", human: "human", dragonborn: "dragonborn",
    "rock-gnome": "rock_gnome", "half-elf": "half_elf", "half-orc": "half_orc", tiefling: "tiefling",
    "mountain-dwarf": "mountain_dwarf", "wood-elf": "wood_elf", "odm-drow": "drow", "stout-halfling": "stout_halfling",
  };
  for (const [slug, raceId] of Object.entries(slugs)) {
    const option = options.find((entry) => entry.id === slug);
    const rule = RULEBOOK[raceId];
    assert.ok(option, `the pack offers no ${slug}`);
    assert.deepEqual(option.asi, rule.asi, `${slug} ability bonuses`);
    assert.equal(option.asiChoice?.count ?? 0, rule.pick ?? 0, `${slug} free bonuses`);
    assert.equal(option.speed, rule.speed, `${slug} speed`);
    assert.deepEqual(option.languages, rule.languages, `${slug} languages`);
    assert.equal(option.bonusLanguages, rule.extra ?? 0, `${slug} extra languages`);
    assert.deepEqual(option.skills ?? [], rule.skills ?? [], `${slug} skills`);
    // The server grants traits by the bundled id the slug stands for.
    assert.equal(populateFeatures([], "fighter", "", slug, 1).filter((feature) => feature.source === "race").length, srd.findRace(raceId).traits.length, slug);
  }
  // A bare parent whose rules require a subrace is not offered.
  for (const parent of ["dwarf", "elf", "halfling", "gnome"]) {
    assert.ok(!options.some((entry) => entry.id === parent), parent);
  }
});

// ---- where the sheet falls short of the rulebook ----

await test("Dwarven Combat Training: every dwarf is proficient with the battleaxe, handaxe, light hammer and warhammer (SRD 5.1, Dwarf).", async () => {
  const weapon = (name) => SRD_WEAPONS.find((entry) => entry.name === name);
  for (const raceId of ["hill_dwarf", "mountain_dwarf"]) {
    assert.deepEqual(sorted(srd.findRace(raceId).weapons), sorted(RULEBOOK[raceId].weapons), raceId);
    const stored = await seated(raceId);
    const wizard = buildRace(raceId, { class: "wizard", stylePicks: [], chosenSkills: ["arcana", "history"], cantrips: ["Light", "Mage Hand", "Fire Bolt"], spells: ["Sleep", "Shield", "Identify", "Detect Magic", "Feather Fall", "Charm Person"], bookPrepared: ["Sleep", "Shield"] });
    assert.equal(wizard.blocker, null, wizard.blocker?.message);
    for (const name of ["Battleaxe", "Handaxe", "Light Hammer", "Warhammer"]) {
      assert.equal(isWeaponProficient(wizard.sheet.proficiencies.weapons, weapon(name)), true, `${raceId} wizard with a ${name}`);
      assert.equal(isWeaponProficient(stored.proficiencies.weapons, weapon(name)), true, `${raceId} stored with a ${name}`);
    }
    assert.equal(isWeaponProficient(wizard.sheet.proficiencies.weapons, weapon("Greataxe")), false);
  }
});

await test("Elf Weapon Training: a high elf is proficient with the longsword, shortsword, shortbow and longbow (SRD 5.1, High Elf).", () => {
  assert.deepEqual(sorted(srd.findRace("high_elf").weapons), sorted(ELF_WEAPONS));
  const weapon = (name) => SRD_WEAPONS.find((entry) => entry.name === name);
  const wizard = buildRace("high_elf", { class: "wizard", stylePicks: [], chosenSkills: ["arcana", "history"], cantrips: ["Light", "Mage Hand", "Fire Bolt"], spells: ["Sleep", "Shield", "Identify", "Detect Magic", "Feather Fall", "Charm Person"], bookPrepared: ["Sleep", "Shield"] });
  for (const name of ["Longsword", "Shortsword", "Shortbow", "Longbow"]) {
    assert.equal(isWeaponProficient(wizard.sheet.proficiencies.weapons, weapon(name)), true, `high elf wizard with a ${name}`);
  }
});

const grants = await import("../src/lib/srd/racial-grants.ts");

await test("the draconic ancestry table is the SRD's: each dragon's damage type, breath shape and save, and the feature it writes resists that type", () => {
  const table = Object.fromEntries(grants.DRACONIC_ANCESTRIES.map((entry) => [entry.id, [entry.damageType, entry.save]]));
  assert.deepEqual(table, {
    black: ["acid", "dex"], blue: ["lightning", "dex"], brass: ["fire", "dex"], bronze: ["lightning", "dex"], copper: ["acid", "dex"],
    gold: ["fire", "dex"], green: ["poison", "con"], red: ["fire", "dex"], silver: ["cold", "con"], white: ["cold", "con"],
  });
  assert.equal(grants.takesDraconicAncestry("dragonborn"), true);
  assert.equal(grants.takesDraconicAncestry("half_orc"), false);
  for (const ancestry of grants.DRACONIC_ANCESTRIES) {
    const feature = grants.draconicAncestryFeature(ancestry);
    assert.equal(pcResistances({ race: "dragonborn", features: [feature] }), ancestry.damageType, ancestry.id);
    assert.equal(grants.ancestryOf([feature])?.id, ancestry.id);
  }
  const green = grants.findDraconicAncestry("green");
  assert.deepEqual(grants.breathWeaponFor(green, 6, 2, 3), { dice: "3d6", damageType: "poison", save: "con", dc: 13, area: "15 ft. cone" });
  assert.equal(grants.ancestryOf([{ name: "Draconic Ancestry" }]), null);
});

const { aoeSpendFor } = await import("../src/lib/srd/aoe-spend.ts");

await test("A dragonborn's Breath Weapon deals its ancestry's damage type against its ancestry's save (Dexterity or Constitution): 2d6, 3d6 at 6th level, 4d6 at 11th, 5d6 at 16th, DC 8 + Constitution modifier + proficiency bonus. One stored without an ancestry keeps the Dexterity save.", async () => {
  const breath = RESOURCE_DEFS.find((entry) => entry.id === "breath_weapon");
  // The spend, through use_resource, for a green (poison, CON) and a red
  // (fire, DEX) dragonborn with Constitution 14.
  for (const [ancestryId, damageType, save] of [["green", "poison", "con"], ["red", "fire", "dex"], ["silver", "cold", "con"]]) {
    const ancestry = grants.findDraconicAncestry(ancestryId);
    // A table of its own: four heroes to a table, one per breath size.
    const breathers = await openWorld();
    for (const [level, dice, proficiency] of [[1, "2d6", 2], [6, "3d6", 3], [11, "4d6", 4], [16, "5d6", 5]]) {
      const hero = breathers.addHero({
        class: "fighter",
        race: "dragonborn",
        level,
        abilities: { con: 14 },
        racialChoices: { ancestry: ancestryId },
        features: [grants.draconicAncestryFeature(ancestry)],
      });
      const spent = await breathers.invoke("use_resource", { characterId: hero.id, resource: "Breath Weapon" });
      assert.equal(spent.ok, true, spent.error);
      assert.equal(spent.result.dice, dice, `${ancestryId} at ${level}`);
      assert.equal(spent.result.damageType, damageType, `${ancestryId} at ${level}`);
      assert.equal(spent.result.saveAbility, save, `${ancestryId} at ${level}`);
      assert.equal(spent.result.dc, 8 + 2 + proficiency, `${ancestryId} at ${level}`);
    }
    breathers.close();
  }
  // The ancestry is read from the stored choice when the feature is absent.
  const byChoice = aoeSpendFor(breath, { features: [], racialChoices: { ancestry: "white" } }, 11, { proficiencyBonus: 4, abilityMods: { con: 3 } });
  assert.deepEqual(byChoice, { dice: "4d6", saveAbility: "con", dc: 15, damageType: "cold", area: "15 ft. cone" });
  // No ancestry: today's breath, a Dexterity save and no damage type.
  const unknown = aoeSpendFor(breath, { features: [{ name: "Breath Weapon" }] }, 6, { proficiencyBonus: 3, abilityMods: { con: 1 } });
  assert.deepEqual(unknown, { dice: "3d6", saveAbility: "dex", dc: 12 });
  // The dragonborn made at the table (red) breathes fire.
  const seatedRed = await seated("dragonborn");
  const red = aoeSpendFor(breath, seatedRed, seatedRed.level, { proficiencyBonus: 2, abilityMods: { con: abilityMod(seatedRed.abilities.con) } });
  assert.equal(red.damageType, "fire");
  assert.equal(red.saveAbility, "dex");
});

await test("innate racial spells arrive by level: a cantrip at 1st, a once-a-day spell at 3rd and at 5th", () => {
  const names = (raceId, level) => grants.innateSpellsFor(raceId, level).map((spell) => spell.name);
  assert.deepEqual(names("tiefling", 1), ["Thaumaturgy"]);
  assert.deepEqual(names("tiefling", 3), ["Thaumaturgy", "Hellish Rebuke"]);
  assert.deepEqual(names("tiefling", 5), ["Thaumaturgy", "Hellish Rebuke", "Darkness"]);
  assert.deepEqual(names("drow", 5), ["Dancing Lights", "Faerie Fire", "Darkness"]);
  assert.equal(grants.innateSpellsFor("tiefling", 3)[1].castAt, 2);
  assert.deepEqual(grants.innateCantripsFor("forest_gnome", 1), ["Minor Illusion"]);
  assert.equal(grants.innateSpellAbility("tiefling"), "cha");
  assert.deepEqual(grants.innateSpellCounters("tiefling", 2), {});
  assert.deepEqual(grants.innateSpellCounters("tiefling", 5, { racial_hellish_rebuke: { max: 1, used: 1 } }), {
    racial_hellish_rebuke: { max: 1, used: 1 }, racial_darkness: { max: 1, used: 0 },
  });
  assert.deepEqual(grants.innateSpellsFor("human", 20), []);
});

await test("a proficiency two fixed grants both give is found, once per repeat", () => {
  assert.deepEqual(grants.repeatedGrants(["intimidation"], ["athletics", "Intimidation"]), ["intimidation"]);
  assert.deepEqual(grants.repeatedGrants(["perception"], ["insight", "religion"]), []);
  assert.deepEqual(grants.repeatedGrants(["thieves' tools"], ["thieves' tools", "disguise kit"]), ["thieves' tools"]);
});

await test("A half-elf speaks Common, Elvish and one language of the player's choice: three languages.", async () => {
  const sheet = await seated("half_elf");
  assert.deepEqual(sorted(sheet.proficiencies.languages), ["Common", "Elvish", "Giant"]);
});

await test("A character who would gain the same proficiency from two sources chooses a different one of the same kind instead (SRD 5.1, Backgrounds, Proficiencies).", async () => {
  const sheet = await seated("half_orc");
  assert.equal(sheet.proficiencies.skills.length, 5, `a half-orc soldier fighter with ${sheet.proficiencies.skills}`);
});

await test("A dragonborn chooses a draconic ancestry, which sets the damage type of its breath, the save against it (Dexterity or Constitution) and the damage it resists.", async () => {
  const sheet = await seated("dragonborn");
  assert.notEqual(pcResistances(sheet), "", "a dragonborn resists no damage type");
});

await test("Infernal Legacy: a tiefling knows thaumaturgy, casts hellish rebuke once a day from 3rd level and darkness from 5th. Drow Magic is dancing lights, then faerie fire and darkness.", () => {
  const spells = ["Sleep", "Shield", "Identify", "Detect Magic", "Feather Fall", "Charm Person", "Mage Armor", "Magic Missile", "Burning Hands", "Thunderwave"];
  const tiefling = buildRace("tiefling", {
    class: "wizard", level: 5, subclass: "School of Evocation", stylePicks: [], chosenSkills: ["arcana", "history"],
    asiChoices: [{ mode: "plus2", ability: "int" }],
    cantrips: ["Light", "Mage Hand", "Fire Bolt", "Ray of Frost"], spells, bookPrepared: spells.slice(0, 7),
  });
  assert.ok(tiefling.sheet.spellcasting.cantrips.includes("Thaumaturgy"), "no thaumaturgy among the cantrips");
  const features = populateFeatures([], "wizard", "", "tiefling", 5);
  const counters = Object.keys(populateResources(features, 5, { cha: 1 }));
  assert.ok(counters.some((id) => /infernal|rebuke|legacy/.test(id)), `no daily casting among ${counters}`);
});

await test("a dragonborn without an ancestry, or with one that is no dragon, is refused at the table and nothing is stored", async () => {
  for (const racialAncestry of ["", "purple"]) {
    const built = buildRace("dragonborn", { racialAncestry });
    assert.ok(built.blocker, "the builder let a dragonborn through without an ancestry");
    const outcome = await atTable({ ...built.sheet, racialChoices: { ...built.sheet.racialChoices, ancestry: racialAncestry } });
    assert.equal(outcome.status, 400, `ancestry "${racialAncestry}" was stored`);
    assert.match(outcome.error, /draconic ancestry/);
  }
});

await test("the skill chosen in place of a repeated one must be a real skill the character does not already have", async () => {
  const built = buildRace("half_orc");
  const doubled = { ...built.sheet, proficiencies: { ...built.sheet.proficiencies, skills: [...built.sheet.proficiencies.skills, "stealth"] } };
  const outcome = await atTable(doubled);
  assert.equal(outcome.status, 400, "a sixth skill was stored for a half-orc soldier");
});

await test("ODM's engine is the 2014 rules: a 2024 species (no ability score increase, languages by the 2024 rule) is not offered beside the 2014 races.", () => {
  // The pack's row, cut to what the builder reads.
  const orc = {
    slug: "orc", name: "Orc", documentSlug: "srd-2024",
    data: {
      key: "srd-2024_orc",
      traits: [
        { name: "Size", desc: "Medium (about 6-7 feet tall)", type: "SIZE" },
        { name: "Speed", desc: "30 feet", type: "SPEED" },
        { name: "Adrenaline Rush", desc: "You can take the Dash action as a Bonus Action.", type: null },
        { name: "Darkvision", desc: "You have Darkvision with a range of 120 feet.", type: null },
        { name: "Relentless Endurance", desc: "When you are reduced to 0 Hit Points but not killed outright, you can drop to 1 Hit Point instead.", type: null },
      ],
    },
  };
  const [option] = packRaceOptions([orc]);
  if (!option) {
    return;
  }
  const raised = Object.values(option.asi).reduce((sum, bonus) => sum + bonus, 0) + (option.asiChoice?.count ?? 0);
  assert.ok(raised >= 3, "a species offered with no ability score increase");
  assert.equal(option.bonusLanguages, 0, "two free languages by the 2024 rule");
});

if (hasPack) {
  await test("The feat a player reads is the feat the engine applies: the srd-2024 feats (the 2024 Alert among them) are not offered to a 2014 character.", () => {
    const modern = searchFeats({ limit: 200 }).filter((feat) => feat.documentSlug === "srd-2024").map((feat) => feat.name);
    assert.deepEqual(modern, [], "srd-2024 feats offered to a 2014 character");
  });
}

world.close();
finish();
