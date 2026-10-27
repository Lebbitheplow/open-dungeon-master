// A species whose player picks one of several packages (issue #538): a
// Half-Dragon of the DM's own whose player picks its ancestry. The options
// here are this table's own, not any book's: Ashen breathes fire in a cone
// against a Dexterity save and resists fire; Mirrorscale breathes psychic
// energy in a line against a Wisdom save, resists psychic damage, and knows
// Insight and Draconic.
//
// What is held here, without a database (src/lib/content/species-variants.ts):
//   every limit of the choice is refused by name, through the save and the
//   editor's findings alike, and nothing is cut to fit;
//   an option is folded into the race once, and a second pick replaces it;
//   every feature name it writes fits on a sheet, and an option's own name
//   never reads as a resistance;
//   its breath is spent as the Dragonborn's scales, with its own type, save
//   and shape;
//   the builder sets aside a racial pick the new option covers, and an
//   option the species no longer offers;
//   "resistance" in any form, in the label or an option's name, is refused;
//   a label or option the table would read as a feature it runs (Second
//   Wind, Dwarven Resilience, a Fighting Style, wings) is refused on the
//   server, and the choices it was made for are not;
//   what an option gave is taken off from the sheet's own record of it, even
//   after the workshop changed the option or removed it;
//   a replacement skill that no longer replaces anything is set aside;
//   the line of choices left names the species' own choice.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  BREATH_AREAS,
  checkSpeciesVariants,
  uniqueVariantId,
  variantFeatureNames,
  variantSummary,
  withHeldVariant,
  withSpeciesVariant,
} = await import("../src/lib/content/species-variants.ts");
const { withoutOldVariant } = await import("../src/lib/srd/legality/species-variant.ts");
const { normalizeHomebrewForSave } = await import("../src/lib/homebrew/species-choice-server.ts");
const { ancestryBlocks } = await import("../src/app/characters/builder/submit.ts");
const { owedPicks } = await import("../src/app/characters/builder/owed.ts");
const { normalizeHomebrewData } = await import("../src/lib/homebrew/gear.ts");
const { speciesFindings } = await import("../src/lib/rulesets/validate-options.ts");
const { packRaceOptions } = await import("../src/lib/content/race-options.ts");
const { variantBreathOf } = await import("../src/lib/srd/racial-grants.ts");
const { RESOURCE_DEFS, populateResources } = await import("../src/lib/srd/class-resources.ts");
const { aoeSpendFor } = await import("../src/lib/srd/aoe-spend.ts");
const { pcResistances } = await import("../src/lib/dm/pc-defenses.ts");
const { reconcilePicks } = await import("../src/app/characters/builder/reconcile.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const ASHEN = {
  id: "ashen",
  name: "Ashen",
  description: "Grey scales, and a breath of cinders.",
  asi: { con: 1 },
  resistances: ["fire"],
  breath: { damageType: "fire", save: "dex", shape: "cone" },
};
const MIRRORSCALE = {
  id: "mirrorscale",
  name: "Mirrorscale",
  asi: { wis: 1 },
  resistances: ["psychic"],
  skills: ["insight"],
  languages: ["Draconic"],
  breath: { damageType: "psychic", save: "wis", shape: "line" },
};
const choice = (options, label = "Draconic ancestry") => ({ label, options });
const species = (variants, extra = {}) => ({
  desc: "",
  size: "Medium",
  speed: { walk: 30 },
  asi: [{ attributes: ["Strength"], value: 2 }],
  asiChoice: { count: 1, amount: 1 },
  languages: ["Common"],
  traits: "**_Scaled Hide._** Your scales turn the first blow of a fight.",
  variants,
  ...extra,
});
const saved = (data) => normalizeHomebrewData("race", data, "Scalekin");
const raceOf = (data) => {
  const normalized = saved(data);
  assert.ok("data" in normalized, normalized.error);
  return packRaceOptions([{ slug: "homebrew:scalekin", name: "Scalekin", documentSlug: "homebrew", document: "Homebrew", data: normalized.data }], ["homebrew:scalekin"])[0];
};

test("a choice of two options saves whole, ids and all, and the builder's race offers it", () => {
  const normalized = saved(species(choice([ASHEN, MIRRORSCALE])));
  assert.ok("data" in normalized, normalized.error);
  assert.deepEqual(normalized.data.variants, choice([ASHEN, MIRRORSCALE]));
  const race = raceOf(species(choice([ASHEN, MIRRORSCALE])));
  assert.deepEqual(race.variants.options.map((option) => option.id), ["ashen", "mirrorscale"]);
  assert.deepEqual(speciesFindings(species(choice([ASHEN, MIRRORSCALE]))).filter((finding) => finding.level === "error"), []);
});

test("an option sent without an id takes one from its name, once, clear of every id the others hold", () => {
  const checked = checkSpeciesVariants(choice([{ name: "Fire Opal" }, { id: "fire-opal-2", name: "Ember" }, { name: "Fire  opal!" }]));
  // The third is a repeat of the first's name and is refused as one.
  assert.match(checked.error, /Two options are called "Fire {2}opal!"/);
  const ids = checkSpeciesVariants(choice([{ name: "Fire Opal" }, { id: "fire-opal", name: "Ember" }])).group.options.map((option) => option.id);
  assert.deepEqual(ids, ["fire-opal-2", "fire-opal"]);
  assert.equal(uniqueVariantId("Fire Opal", ["fire-opal", "fire-opal-2"]), "fire-opal-3");
  assert.equal(uniqueVariantId("x".repeat(60), []).length, 40);
});

// Every limit, refused by the save and named by the editor in the same words.
const long = (count) => "x".repeat(count);
const REFUSED = [
  ["one option", choice([ASHEN]), /A choice holds 2 to 16 options; this one has 1\./],
  ["seventeen options", choice(Array.from({ length: 17 }, (_, at) => ({ name: `Scale ${at + 1}` }))), /this one has 17\./],
  ["a repeated id", choice([ASHEN, { ...MIRRORSCALE, id: "ashen" }]), /share the id "ashen"/],
  ["an id that is not lower case and dashes", choice([ASHEN, { ...MIRRORSCALE, id: "Mirror Scale" }]), /its id "Mirror Scale" is not lower-case letters/],
  ["a 41-character name", choice([ASHEN, { ...MIRRORSCALE, name: long(41) }]), /is a name of 41 characters; an option's name holds 40\./],
  ["a 31-character label", choice([ASHEN, MIRRORSCALE], long(31)), /The choice's label is 31 characters; it holds 30\./],
  ["a name in brackets", choice([ASHEN, { ...MIRRORSCALE, name: "Mirrorscale (old)" }]), /an option's name cannot hold brackets, a colon, "resistance" or "breath weapon"/],
  ["a label naming a resistance", choice([ASHEN, MIRRORSCALE], "Fire Resistance"), /The choice's label cannot hold brackets/],
  ["a label naming the breath", choice([ASHEN, MIRRORSCALE], "Breath Weapon"), /The choice's label cannot hold brackets/],
  // The damage engine finds "resistance" anywhere in a name, plural or not.
  ["a label naming resistances", choice([ASHEN, MIRRORSCALE], "Elemental Resistances"), /The choice's label cannot hold brackets, a colon, "resistance"/],
  ["a name naming resistances", choice([ASHEN, { ...MIRRORSCALE, name: "Fire Resistances" }]), /"Fire Resistances": an option's name cannot hold brackets, a colon, "resistance"/],
  ["a name calling itself resistant", choice([ASHEN, { ...MIRRORSCALE, name: "Cold-RESISTANT" }]), /"Cold-RESISTANT": an option's name cannot hold/],
  ["a label naming breath weapons", choice([ASHEN, MIRRORSCALE], "Breath Weapons"), /The choice's label cannot hold brackets/],
  ["a damage type the table does not know", choice([ASHEN, { ...MIRRORSCALE, resistances: ["plasma"] }]), /"plasma" is not a damage type the table knows/],
  ["+4 in all", choice([ASHEN, { ...MIRRORSCALE, asi: { wis: 2, cha: 2 } }]), /raises scores by \+4 in all; an option gives at most \+3\./],
  ["+3 to one score", choice([ASHEN, { ...MIRRORSCALE, asi: { wis: 3 } }]), /an increase is \+1 or \+2 to str, dex, con, int, wis or cha\./],
  ["four resistances", choice([ASHEN, { ...MIRRORSCALE, resistances: ["acid", "cold", "fire", "thunder"] }]), /resists 4 damage types; an option resists 3 at most\./],
  ["three skills", choice([ASHEN, { ...MIRRORSCALE, skills: ["insight", "arcana", "history"] }]), /grants 3 skills; an option grants 2 at most\./],
  ["a skill that is not one", choice([ASHEN, { ...MIRRORSCALE, skills: ["dragonlore"] }]), /"dragonlore" is not a skill\./],
  ["a breath shaped like a sphere", choice([ASHEN, { ...MIRRORSCALE, breath: { damageType: "psychic", save: "wis", shape: "sphere" } }]), /breath weapon is a cone \(15 ft\. cone\) or a line \(5 by 30 ft\. line\)\./],
  ["1,001 characters of words", choice([ASHEN, { ...MIRRORSCALE, description: long(1001) }]), /words run to 1,001 characters; an option's words hold 1,000\./],
];

for (const [what, variants, expected] of REFUSED) {
  test(`the save refuses ${what} by name, and the editor says the same`, () => {
    const normalized = saved(species(variants));
    assert.ok("error" in normalized, `${what} was saved`);
    assert.match(normalized.error, expected);
    const errors = speciesFindings(species(variants)).filter((finding) => finding.level === "error").map((finding) => finding.text);
    assert.ok(errors.includes(normalized.error), `the editor did not say: ${normalized.error}`);
  });
}

test("a choice beside the Draconic Ancestry trait is refused: two picks would each write a breath and a resistance", () => {
  const data = species(choice([ASHEN, MIRRORSCALE]), { traits: "**_Draconic Ancestry._** You have draconic ancestry. Choose one type of dragon." });
  const normalized = saved(data);
  assert.match(normalized.error, /already asks for a published dragon through its Draconic Ancestry trait/);
  assert.ok(speciesFindings(data).some((finding) => finding.level === "error" && finding.text === normalized.error));
  // Renamed, as the refusal says, it saves.
  assert.ok("data" in saved({ ...data, traits: "**_Draconic Heritage._** Your line remembers its dragon." }));
});

test("the editor warns of a resistance the species already has and a score over +2, and notes an option with no breath", () => {
  const traits = "**_Fire Resistance._** You have resistance to fire damage.\n\n**_Breath Weapon._** You exhale destructive energy.";
  const findings = speciesFindings(species(choice([{ ...ASHEN, asi: { str: 1 } }, { id: "moonstone", name: "Moonstone" }]), { traits }));
  const said = findings.map((finding) => `${finding.level}: ${finding.text}`);
  assert.ok(said.some((line) => /^warn: Ashen resists fire, which the species already resists/.test(line)), said.join("\n"));
  assert.ok(said.some((line) => /^warn: Ashen raises Strength by 3 with the species' own/.test(line)), said.join("\n"));
  assert.ok(said.some((line) => /^note: Moonstone sets no breath: its Breath Weapon deals untyped damage against a Dexterity save\./.test(line)), said.join("\n"));
  assert.ok(!said.some((line) => line.startsWith("error:")), said.join("\n"));
});

test("an option is folded into the race once: the same pick twice is the race once, another pick replaces it", () => {
  const race = raceOf(species(choice([ASHEN, MIRRORSCALE])));
  assert.deepEqual(race.asi, { str: 2 });
  const ashen = withSpeciesVariant(race, "ashen");
  assert.deepEqual(ashen.asi, { str: 2, con: 1 });
  assert.deepEqual(withSpeciesVariant(ashen, "ashen").asi, { str: 2, con: 1 });
  const mirror = withSpeciesVariant(ashen, "mirrorscale");
  assert.deepEqual(mirror.asi, { str: 2, wis: 1 }, "Ashen's +1 Constitution stayed after the switch");
  assert.ok(mirror.skills.includes("insight"));
  assert.deepEqual(mirror.languages, ["Common", "Draconic"]);
  const back = withSpeciesVariant(mirror, "ashen");
  assert.ok(!(back.skills ?? []).includes("insight"), "Mirrorscale's Insight stayed after the switch back");
  assert.deepEqual(back.languages, ["Common"]);
  assert.equal(withSpeciesVariant(mirror, ""), race, "no pick is the race alone");
  assert.equal(withSpeciesVariant(mirror, "amethyst"), race, "an option the race does not offer is the race alone");
});

test("every name an option writes fits on a sheet at the most each limit allows, and an option's name is never read as a resistance", () => {
  const label = "Bloodline of the Drowned Kings";
  assert.equal(label.length, 30);
  const option = {
    id: "longest",
    name: "N".repeat(40),
    resistances: ["bludgeoning", "lightning", "necrotic"],
    breath: { damageType: "bludgeoning", save: "con", shape: "line" },
  };
  assert.ok("group" in checkSpeciesVariants(choice([option, ASHEN], label)));
  const names = variantFeatureNames(label, option);
  assert.equal(names[0], `${label} (${"N".repeat(40)})`);
  assert.ok(names.every((name) => name.length <= 80), names.join(" | "));
  // "Fire Opal" with psychic resistance resists psychic damage, not fire.
  const opal = variantFeatureNames("Gem lineage", { id: "fire-opal", name: "Fire Opal", resistances: ["psychic"] });
  const resisted = pcResistances({ race: "homebrew:scalekin", features: opal.map((name) => ({ name, source: "race" })) });
  assert.match(resisted, /\bpsychic\b/);
  assert.doesNotMatch(resisted, /\bfire\b/, `"Fire Opal" resisted fire: ${resisted}`);
  // A resistance the species' own traits already write is not written twice.
  assert.deepEqual(variantFeatureNames("Draconic ancestry", ASHEN, ["Fire Resistance"]), ["Draconic ancestry (Ashen)", "Breath Weapon (fire, 15 ft. cone, DEX save)"]);
});

test("Mirrorscale's breath is spent as the Dragonborn's scales: 2d6, 3d6, 4d6, 5d6 at 1st, 6th, 11th and 16th, a Wisdom save, DC 8 + Constitution + proficiency, a line", () => {
  const features = variantFeatureNames("Draconic ancestry", MIRRORSCALE).map((name) => ({ name, source: "race" }));
  assert.deepEqual(variantBreathOf(features), { damageType: "psychic", area: BREATH_AREAS.line, save: "wis" });
  // The bundled trait's own name is never read as an option's breath.
  assert.equal(variantBreathOf([{ name: "Breath Weapon (2d6, DC 8 + CON mod + PB)" }]), null);
  assert.ok(Object.keys(populateResources(features, 1, { con: 2 })).includes("breath_weapon"), "no breath counter");
  const breath = RESOURCE_DEFS.find((entry) => entry.id === "breath_weapon");
  for (const [level, dice, proficiencyBonus] of [[1, "2d6", 2], [6, "3d6", 3], [11, "4d6", 4], [16, "5d6", 5]]) {
    assert.deepEqual(aoeSpendFor(breath, { features }, level, { proficiencyBonus, abilityMods: { con: 2 } }), {
      dice,
      saveAbility: "wis",
      dc: 8 + 2 + proficiencyBonus,
      damageType: "psychic",
      area: "5 by 30 ft. line",
    });
  }
});

test("the builder sets aside a racial +1 the new option already gives, and an option the species no longer offers", () => {
  const race = raceOf(species(choice([ASHEN, MIRRORSCALE])));
  const kept = reconcilePicks({ racialVariant: "ashen", racialAsi: ["wis"] }, { race, level: 1 });
  assert.equal(kept.picks.racialVariant, "ashen");
  assert.deepEqual(kept.picks.racialAsi, ["wis"]);
  assert.deepEqual(kept.drops, []);
  const switched = reconcilePicks({ racialVariant: "mirrorscale", racialAsi: ["wis"] }, { race, level: 1 });
  assert.deepEqual(switched.picks.racialAsi, [""]);
  assert.deepEqual(switched.drops, [{ label: "racial ability bump", value: "wis", target: "racialAsi" }]);
  const gone = reconcilePicks({ racialVariant: "amethyst" }, { race, level: 1 });
  assert.equal(gone.picks.racialVariant, "");
  assert.deepEqual(gone.drops, [{ label: "draconic ancestry", value: "amethyst", target: "variant" }]);
  // A race with no choice keeps no pick of one.
  const plain = raceOf(species(undefined));
  assert.deepEqual(reconcilePicks({ racialVariant: "ashen" }, { race: plain, level: 1 }).drops.map((drop) => drop.target), ["variant"]);
});

test("the words the damage engine reads anywhere in a name are refused in every form, since it would read them", () => {
  // What the refusals above keep off a sheet: the record of a pick is read
  // by pcResistances, which finds "resistance" and a damage type anywhere.
  assert.match(pcResistances({ race: "homebrew:scalekin", features: [{ name: "Elemental Resistances (Cold)", source: "race" }] }), /\bcold\b/);
  assert.match(pcResistances({ race: "homebrew:scalekin", features: [{ name: "Bloodline (Fire Resistances)", source: "race" }] }), /\bfire\b/);
});

// A choice the table would run as one of its own features, through the
// server's save: the engines read the record "<label> (<option>)" by the name
// before its bracket, and some words anywhere in it.
const ENGINE_CLASHES = [
  ["Second Wind", [ASHEN, MIRRORSCALE], /the choice's label, "Second Wind", as Second Wind, a feature it runs/],
  ["Dwarven Resilience", [ASHEN, MIRRORSCALE], /the choice's label, "Dwarven Resilience", as Dwarven Resilience, a feature it runs/],
  ["Relentless Endurance", [ASHEN, MIRRORSCALE], /as Relentless Endurance, a feature it runs/],
  ["Fighting Style", [{ id: "defense", name: "Defense" }, ASHEN], /the choice's label, "Fighting Style", as Fighting Style, a feature it runs/],
  ["Lucky", [ASHEN, MIRRORSCALE], /as Lucky, a feature it runs/],
  ["Bloodline", [ASHEN, { id: "dragon-wings", name: "Dragon Wings" }], /"Bloodline \(Dragon Wings\)", the feature Dragon Wings writes on a sheet, as a flying speed\. Give the option another name\./],
  ["Bloodline", [ASHEN, { id: "deepsight", name: "Darkvision 120" }], /as a sense \(darkvision/],
  ["Bloodline", [ASHEN, { id: "eel", name: "Eel Swimmer" }], /as a swimming speed/],
];

for (const [label, options, expected] of ENGINE_CLASHES) {
  const what = `${label} (${options[1].name})`;
  test(`the server refuses a choice the table would read as one of its own features: ${what}`, () => {
    const data = species(choice(options, label));
    // The editor's own check passes it: the names the engines run stay on
    // the server, which refuses it as the save's error.
    assert.ok("data" in saved(data), `${what} was refused before the server's check`);
    const refused = normalizeHomebrewForSave("race", data, "Scalekin");
    assert.ok("error" in refused, `${what} was saved`);
    assert.match(refused.error, expected);
  });
}

test("a choice the table reads as nothing but its record is saved: Draconic ancestry, a bloodline, a gem lineage", () => {
  for (const [label, options] of [
    ["Draconic ancestry", [ASHEN, MIRRORSCALE]],
    ["Bloodline", [ASHEN, MIRRORSCALE]],
    ["Gem lineage", [{ id: "fire-opal", name: "Fire Opal", resistances: ["psychic"] }, ASHEN]],
    ["Bloodline of the Drowned Kings", [{ id: "longest", name: "N".repeat(40) }, ASHEN]],
  ]) {
    const kept = normalizeHomebrewForSave("race", species(choice(options, label)), "Scalekin");
    assert.ok("data" in kept, `${label}: ${kept.error}`);
  }
  // And what the refusals stand on: unrefused, these records run.
  assert.ok(Object.keys(populateResources([{ name: "Second Wind (Ashen)", source: "race" }], 5, { con: 2 })).includes("second_wind"));
  assert.match(pcResistances({ race: "homebrew:scalekin", features: [{ name: "Dwarven Resilience (Ashen)", source: "race" }] }), /\bpoison\b/);
});

// The Scalekin of the table: +2 Strength and one +1 of the player's choice.
// Mirrorscale's grants, as a character made on it was given them.
const MIRRORSCALE_GAVE = { asi: { wis: 1 }, skills: ["insight"], tools: [], languages: ["Draconic"] };

test("what a stored character's option gave comes off from the sheet's own record, though the workshop has since removed the option", () => {
  const now = raceOf(species(choice([ASHEN, { id: "moonstone", name: "Moonstone", asi: { cha: 1 } }])));
  // The stored scores carry Mirrorscale's +1 Wisdom, which the species no
  // longer offers: the record says so, and the builder's base scores and the
  // server's stored pool both read it.
  assert.deepEqual(withHeldVariant(now, { variant: "mirrorscale", variantGrants: MIRRORSCALE_GAVE }).asi, { str: 2, wis: 1 });
  assert.ok(withHeldVariant(now, { variant: "mirrorscale", variantGrants: MIRRORSCALE_GAVE }).skills.includes("insight"));
  // A sheet stored before the record reads the option of its id today, and
  // with that option gone, the race alone.
  assert.deepEqual(withHeldVariant(now, { variant: "mirrorscale" }).asi, { str: 2 });
  assert.deepEqual(withHeldVariant(raceOf(species(choice([ASHEN, MIRRORSCALE]))), { variant: "mirrorscale" }).asi, { str: 2, wis: 1 });
  // An edit to Ashen takes Insight and Draconic off what the character holds.
  const held = { skills: ["athletics", "insight"], tools: [], languages: ["Common", "Draconic"], armor: [], weapons: [], saves: [], expertise: [] };
  const ashen = now.variants.options[0];
  const edited = withoutOldVariant(held, now, { variant: "mirrorscale", variantGrants: MIRRORSCALE_GAVE }, ashen);
  assert.deepEqual(edited.skills, ["athletics"]);
  assert.deepEqual(edited.languages, ["Common"]);
});

test("an option the author changed under the same id takes off what it gave then, and keeps what it still gives", () => {
  // Mirrorscale now raises Charisma and trains Arcana; the character was
  // made when it raised Wisdom and trained Insight.
  const changed = { id: "mirrorscale", name: "Mirrorscale", asi: { cha: 1 }, skills: ["arcana"], languages: ["Draconic"] };
  const race = raceOf(species(choice([ASHEN, changed])));
  assert.deepEqual(withHeldVariant(race, { variant: "mirrorscale", variantGrants: MIRRORSCALE_GAVE }).asi, { str: 2, wis: 1 }, "the stored pool read today's option");
  const held = { skills: ["athletics", "insight"], tools: [], languages: ["Common", "Draconic"], armor: [], weapons: [], saves: [], expertise: [] };
  const kept = withoutOldVariant(held, race, { variant: "mirrorscale", variantGrants: MIRRORSCALE_GAVE }, race.variants.options[1]);
  assert.deepEqual(kept.skills, ["athletics"], "Insight stayed after the option stopped giving it");
  assert.deepEqual(kept.languages, ["Common", "Draconic"]);
  // A sheet stored before the record, with the same pick, keeps what it holds.
  assert.deepEqual(withoutOldVariant(held, race, { variant: "mirrorscale" }, race.variants.options[1]), held);
});

test("a replacement skill that no longer replaces anything is set aside and said so, after a new option or a new background", () => {
  const race = raceOf(species(choice([ASHEN, MIRRORSCALE])));
  // Mirrorscale's Insight and the acolyte's Insight repeat: Perception is
  // picked in its place.
  const acolyte = { id: "acolyte", name: "Acolyte", skills: ["insight", "religion"], knownLanguages: [] };
  const kept = reconcilePicks({ racialVariant: "mirrorscale", repeatSkills: ["perception"] }, { race, background: acolyte, level: 1 });
  assert.deepEqual(kept.picks.repeatSkills, ["perception"]);
  assert.deepEqual(kept.drops, []);
  // Ashen gives no Insight: nothing repeats, and the pick goes.
  const ashen = reconcilePicks({ racialVariant: "ashen", repeatSkills: ["perception"] }, { race, background: acolyte, level: 1 });
  assert.deepEqual(ashen.picks.repeatSkills, []);
  assert.deepEqual(ashen.drops, [{ label: "replacement skill", value: "perception", target: "repeatSkills" }]);
  // A soldier repeats nothing of Mirrorscale's either.
  const soldier = { id: "soldier", name: "Soldier", skills: ["athletics", "intimidation"], knownLanguages: [] };
  const moved = reconcilePicks({ racialVariant: "mirrorscale", repeatSkills: ["perception"] }, { race, background: soldier, level: 1 });
  assert.deepEqual(moved.drops, [{ label: "replacement skill", value: "perception", target: "repeatSkills" }]);
  // A replacement the character now holds another way goes too.
  const twice = reconcilePicks({ racialVariant: "mirrorscale", repeatSkills: ["religion"] }, { race, background: acolyte, level: 1 });
  assert.deepEqual(twice.picks.repeatSkills, [""]);
});

test("the line of choices left names the species' own choice: its Draconic ancestry, its Bloodline", () => {
  const state = { racialVariant: "", racialAsi: [], racialSkills: [], racialTool: "", racialCantrips: [], bonusLanguages: [], feats: [], repeatSkills: [] };
  for (const label of ["Draconic ancestry", "Bloodline"]) {
    const race = raceOf(species(choice([ASHEN, MIRRORSCALE], label)));
    const owed = owedPicks(ancestryBlocks(state, race)).find((pick) => pick.target === "variant");
    assert.equal(owed?.label, label);
  }
});

test("the summary line says what an option gives, with the species' own scores when asked", () => {
  assert.equal(variantSummary(checkSpeciesVariants(choice([ASHEN, MIRRORSCALE])).group.options[1]), "+1 Wisdom; resists psychic damage; breath weapon: psychic, 5 by 30 ft. line, Wisdom save; proficient in Insight; speaks Draconic");
  assert.match(variantSummary(ASHEN, { str: 2 }), /^\+2 Strength, \+1 Constitution; resists fire damage/);
});

console.log(`${passed} passed`);
