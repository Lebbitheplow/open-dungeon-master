// A feature, feat or condition is the one a rule names when its whole name
// is that name, compared by textKey, in the formats ODM itself writes: the
// name alone, with a bracket note ("Lucky (Halfling)"), or as one choice of a
// family ("Maneuver: Riposte"). A name that only holds another is a
// different one: a homebrew "Unlucky" is no Lucky. A record list answers a
// name that is no record's whole spelling with nothing, and its refusal names
// the records whose name holds the word. Names compare by textKey wherever
// they are keys: curly quotes, "ß" and "SS", case and spacing are one name, a
// feat's picks are found under its textKey whatever key an older sheet stored
// them under, and an NPC renamed onto another's name in another case is the
// clash it is.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-routes.mjs", import.meta.url);
const { openWorld } = await import("./lib/enforce-world.mjs");
const { suite } = await import("./lib/enforce-harness.mjs");

const { test, finish } = suite("test-feature-names");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const { isNamed, choiceIn, nameChoice, familyOf } = await import("../src/lib/srd/feature-names.ts");
const { textKey, findNamed, namesHolding } = await import("../src/lib/language/text-logic.ts");
const { holdsFeature } = await import("../src/lib/srd/trait-rules.ts");
const { holdsFeat } = await import("../src/lib/srd/feat-effects.ts");
const { hasElvenAccuracy } = await import("../src/lib/srd/feature-effects.ts");
const { hasHalflingNimbleness } = await import("../src/lib/battlemap/passage.ts");
const { initiativeRefills } = await import("../src/lib/srd/resource-refills.ts");
const { canonicalCondition, conditionNameRefusal } = await import("../src/lib/dm/set-condition.ts");
const { conditionEffectsFor } = await import("../src/lib/srd/condition-effects.ts");
const { reactionTimingOf } = await import("../src/lib/dm/reaction-kinds.ts");
const { kiTechnique } = await import("../src/lib/dm/bonus-actions.ts");
const { heldCheckTraits } = await import("../src/lib/srd/check-traits.ts");
const { isFavoredEnemy } = await import("../src/lib/dm/attack-features.ts");
const { keyFits } = await import("../src/lib/srd/roll-keys.ts");
const { ignoresHeavyArmorSpeedPenalty, unarmoredFormulaFor } = await import("../src/lib/srd/armor.ts");
const { featureHitPoints } = await import("../src/lib/srd/trait-rules.ts");
const { hasFastHands } = await import("../src/lib/dm/bonus-routes.ts");
const { hasOpenHandTechnique } = await import("../src/lib/dm/attack-choice-rules.ts");
const { pcResistances } = await import("../src/lib/dm/pc-defenses.ts");
const { bonusCastOf } = await import("../src/lib/dm/cast-rules.ts");
const { featChoice, featChoicesSchema, keyedFeatChoices, withFeatChoice } = await import("../src/lib/schemas/sheet.ts");
const { createCharacter, getCharacter } = await import("../src/lib/db/characters.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { getSheetById } = await import("../src/lib/db/sheets.ts");
const { upsertNpc, getNpcByName, listNpcs } = await import("../src/lib/db/npcs.ts");
const { mintSession } = await import("../src/lib/auth.ts");
const review = await import("../src/app/api/campaigns/[campaignId]/npcs/review/route.ts");

await test("isNamed: the whole name, with a bracket note, or as a family's choice; never a name that only holds it.", () => {
  for (const [written, name] of [
    ["Lucky", "Lucky"], ["LUCKY", "lucky"], ["Lucky (Halfling)", "Lucky"], ["Maneuver: Riposte", "Riposte"],
    ["Hunter's Prey: Colossus Slayer", "Colossus Slayer"], ["Nature’s Ward", "Nature's Ward"], ["Fiendish Resilience (fire)", "Fiendish Resilience"],
    ["frightened (Dragon)", "frightened"], ["Aura of Protection", "aura-of-protection"],
  ]) {
    assert.equal(isNamed(written, name), true, `${written} is ${name}`);
  }
  for (const [written, name] of [
    ["Unlucky", "Lucky"], ["War Caster Lite", "War Caster"], ["exhausted", "exhaustion"], ["Maneuver", "Riposte"],
    ["Improved Aura of Protection", "Aura of Protection"], ["Persistent Rage Lite", "Persistent Rage"], ["Elven Accuracy Training", "Elven Accuracy"],
    ["frightened of the dragon", "frightened"], ["unrestrained", "restrained"], ["asleep-ish", "asleep"],
  ]) {
    assert.equal(isNamed(written, name), false, `${written} is ${name}`);
  }
  assert.equal(choiceIn("Fighting Style: Archery", "Fighting Style"), "Archery");
  assert.equal(choiceIn("Fighting Style", "Fighting Style"), null);
  assert.equal(nameChoice("Dragon Ancestor (gold)"), "gold");
  assert.equal(familyOf("Dragon Ancestor: Red"), "Dragon Ancestor");
});

await test("the engines that hold a feature or feat by name hold the whole one only.", () => {
  const sheet = (names, feats = []) => ({ features: names.map((name) => ({ name })), feats });
  assert.equal(holdsFeature(sheet(["Lucky (Halfling)"]), "Lucky"), true);
  assert.equal(holdsFeature(sheet(["Unlucky"]), "Lucky"), false);
  assert.equal(holdsFeat(sheet([], ["Alert"]), "alert"), true);
  assert.equal(holdsFeat(sheet([], ["Alertness Training"]), "Alert"), false);
  assert.equal(hasElvenAccuracy(sheet([], ["Elven Accuracy"])), true);
  assert.equal(hasElvenAccuracy(sheet(["Elven Accuracy Training"])), false);
  assert.equal(hasHalflingNimbleness([{ name: "Halfling Nimbleness" }]), true);
  assert.equal(hasHalflingNimbleness([{ name: "Halfling Nimbleness Lost" }]), false);
  const spent = { bardic_inspiration: { max: 3, used: 3 } };
  assert.ok(initiativeRefills(spent, [{ name: "Superior Inspiration" }]), "Superior Inspiration refilled nothing");
  assert.equal(initiativeRefills(spent, [{ name: "Superior Inspiration Denied" }]), null);
  for (const [name, timing] of [
    ["Uncanny Dodge (Rogue)", "answers"], ["Fighting Style: Protection", "answers"], ["SHIELD", "answers"], ["Strength Before Death (1/long rest)", "at_zero"],
    ["Shield of Faith", "after"], ["Protection from Evil and Good", "after"], ["Parry Riposte", "after"], ["Necrotic Husk Lite", "after"],
  ]) {
    assert.equal(reactionTimingOf(name), timing, name);
  }
  for (const [variant, technique] of [
    ["Flurry of Blows", "flurry"], ["PATIENT DEFENSE", "patient defense"], ["Step of the Wind (Dash)", "step of the wind"], ["step of the wind dash", "step of the wind"],
    // The keys the tool lists, never another word for one.
    ["flurry", null], ["patient defence", null], ["step of the wind disengage", null],
    ["Shadow Step", null], ["dodge", null], ["defense", null], ["Wind Walk", null],
  ]) {
    assert.equal(kiTechnique(variant), technique, variant);
  }
  assert.ok(unarmoredFormulaFor("monk", [{ name: "Unarmored Defense (Monk)" }]));
  assert.equal(unarmoredFormulaFor("monk", [{ name: "Unarmored Defense Training" }]), null);
});

await test("a species is its bundled id, whichever list spelled it, or the trait it carries; never an id that only holds a word.", () => {
  const stonework = (race) => heldCheckTraits({ race, features: [], feats: [] }).some((trait) => trait.about === "stonework");
  for (const race of ["hill_dwarf", "odm-mountain-dwarf", "Dwarf"]) {
    assert.equal(stonework(race), true, race);
    assert.equal(ignoresHeavyArmorSpeedPenalty(race), true, race);
  }
  for (const race of ["dwarfling", "half-dwarf-kin"]) {
    assert.equal(stonework(race), false, race);
    assert.equal(ignoresHeavyArmorSpeedPenalty(race), false, race);
  }
  assert.equal(heldCheckTraits({ race: "deep-gnome", features: [], feats: [] }).some((trait) => trait.about === "rocky_terrain"), true);
  for (const [race, type] of [["hill_dwarf", "poison"], ["stout-halfling", "poison"], ["Tiefling", "fire"]]) {
    assert.match(pcResistances({ race, features: [] }), new RegExp(type), race);
  }
  for (const race of ["dwarfling", "stoutheart", "tiefling-kin"]) {
    assert.equal(pcResistances({ race, features: [] }), "", race);
  }
});

await test("a subclass is the one its whole name is, in any of its titles; a subclass that only holds a word is another.", () => {
  const rogue = (subclass) => ({ class: "rogue", level: 3, classes: [{ id: "rogue", level: 3, subclass }], subclass, features: [], feats: [] });
  const monk = (subclass) => ({ class: "monk", level: 3, classes: [{ id: "monk", level: 3, subclass }], subclass, features: [], feats: [] });
  const sorcerer = (subclass) => ({ class: "sorcerer", level: 6, classes: [{ id: "sorcerer", level: 6, subclass }], subclass, features: [], feats: [] });
  for (const subclass of ["Thief", "thief"]) {
    assert.equal(hasFastHands(rogue(subclass)), true, subclass);
  }
  assert.equal(hasFastHands(rogue("Master Thief Guild")), false);
  assert.equal(hasOpenHandTechnique(monk("Way of the Open Hand")), true);
  assert.equal(hasOpenHandTechnique(monk("Open Hand")), true);
  assert.equal(hasOpenHandTechnique(monk("Way of the Open Handshake")), false);
  assert.equal(featureHitPoints(sorcerer("Draconic Bloodline")), 6);
  assert.equal(featureHitPoints(sorcerer("Draconic Studies")), 0);
});

await test("a condition is its whole name, or with a bracket note; any other words are refused, pointing at the source's own field.", () => {
  assert.equal(canonicalCondition("Frightened (dragon)"), "frightened");
  assert.equal(canonicalCondition("PRONE"), "prone");
  assert.equal(canonicalCondition("unrestrained"), "unrestrained");
  for (const raw of ["frightened of the dragon", "grappled by the ogre", "Poisoned badly"]) {
    assert.match(conditionNameRefusal(raw)?.error ?? "", /sourceEnemyId/, raw);
  }
  assert.equal(conditionNameRefusal("spaventato"), null);
  // A family's choice is a feature's format, never a condition's: "Curse:
  // Blinded" is no blinded, and no rule reads it as one.
  assert.equal(canonicalCondition("Curse: Blinded"), "curse: blinded");
  assert.equal(conditionEffectsFor("Spell: Bless"), null);
  assert.equal(conditionEffectsFor("bless (the cleric)")?.match.includes("bless"), true);
  // A story condition that holds a condition's word is asked which it is: the
  // condition with its source, or the story condition named without the word.
  for (const raw of ["paralyzed arm", "Curse: Blinded"]) {
    const refusal = conditionNameRefusal(raw)?.error ?? "";
    assert.match(refusal, /If it is the condition, send condition "(paralyzed|blinded)" and who caused it in sourceEnemyId or sourceCharacterId; if it is a story condition no rule applies to, send it again named without the word/, raw);
  }
  // A story condition in the table's language holds no condition's English
  // word, and is kept as written at every table.
  for (const raw of ["braccio paralizzato", "Maledizione: accecato", "bras paralysé", "brazo paralizado", "gelähmter Arm"]) {
    assert.equal(conditionNameRefusal(raw), null, raw);
    assert.equal(canonicalCondition(raw), raw.toLowerCase(), raw);
  }
  const command = { name: "Command", castingTime: "action", level: 1, classes: ["paladin"] };
  const held = (condition) => bonusCastOf({ conditions: [condition], features: [] }, command, null)?.feature ?? null;
  assert.equal(held("Mantle of Majesty (1 minute)"), "Mantle of Majesty");
  assert.equal(held("elder champion"), "Elder Champion");
  for (const condition of ["Mantle of Majesty fading", "Elder Champions' banner"]) {
    assert.equal(held(condition), null, condition);
  }
});

await test("a record list finds a whole spelling only; its refusal names the records whose name holds the word.", () => {
  const forms = [{ name: "Giant Spider" }, { name: "Wolf" }, { name: "Dire Wolf" }];
  const spellings = (entry) => [entry.name];
  assert.equal(findNamed(forms, "giant spider", spellings)?.name, "Giant Spider");
  assert.equal(findNamed(forms, "GIANT-SPIDER", spellings)?.name, "Giant Spider");
  assert.equal(findNamed(forms, "spider", spellings), null);
  assert.equal(findNamed(forms, "ragno gigante", spellings), null);
  assert.deepEqual(namesHolding(forms, "spider", spellings).map((entry) => entry.name), ["Giant Spider"]);
  assert.deepEqual(namesHolding(forms, "wolf", spellings).map((entry) => entry.name), ["Wolf", "Dire Wolf"]);
});

await test("names compare by textKey: curly quotes, ß and SS, case, hyphens and spacing are one key.", () => {
  for (const [a, b] of [["Hunter’s Mark", "Hunter's Mark"], ["Straße", "STRASSE"], ["hunter_s_mark", "HUNTER-S-MARK"], ["Niccolò", "Niccolò"], ["  Magic   Initiate ", "magic initiate"]]) {
    assert.equal(textKey(a), textKey(b), `${a} / ${b}`);
  }
  assert.notEqual(textKey("papà"), textKey("papa"));
});

await test("a feat's picks are found under its textKey: a map sent or stored under the earlier lower-case keys is re-keyed where it arrives, and no read tries a second key.", () => {
  const picks = { cantrips: ["Light", "Mage Hand"], spells: ["Shield"] };
  const old = { "magic initiate (wizard)": picks, "elemental adept": { damageType: "fire" } };
  const sent = featChoicesSchema.parse(old);
  assert.deepEqual(featChoice(sent, "Magic Initiate (Wizard)"), picks);
  assert.deepEqual(featChoice(sent, "MAGIC INITIATE – WIZARD"), picks);
  assert.equal(featChoice(old, "Magic Initiate (Wizard)"), undefined, "an unkeyed map was read by a second key");
  assert.deepEqual(keyedFeatChoices(withFeatChoice({}, "Magic Initiate (Wizard)", picks)), { "magic initiate wizard": picks });
  // A library character stored before the keys were textKey keeps its picks.
  const stored = createCharacter(world.owner.id, 1, {
    name: "Ilse", race: "human", class: "wizard", subclass: "", background: "sage", alignment: "N", gender: "", appearance: "",
    abilities: { str: 8, dex: 14, con: 12, int: 15, wis: 10, cha: 10 }, maxHp: 7, ac: 12, acOverride: false, speed: 30,
    hitDice: { die: "d6", total: 1, spent: 0 },
    proficiencies: { saves: ["int", "wis"], skills: ["arcana", "history"], expertise: [], languages: ["common"], tools: [], armor: [], weapons: ["simple"] },
    equipment: [], gold: 10, copper: 0, feats: ["Magic Initiate"], features: [], asiChoices: [], spellcasting: null, notes: "", backstory: "",
  });
  const blob = JSON.parse(getDatabase().prepare("SELECT sheet_json FROM library_characters WHERE id = ?").get(stored.id).sheet_json);
  getDatabase().prepare("UPDATE library_characters SET sheet_json = ? WHERE id = ?").run(JSON.stringify({ ...blob, featChoices: old }), stored.id);
  const read = getCharacter(stored.id).sheet;
  assert.deepEqual(featChoice(read.featChoices, "Magic Initiate (Wizard)"), picks);
  assert.equal(featChoice(read.featChoices, "Elemental Adept")?.damageType, "fire");
});

await test("a campaign sheet stored before the keys were textKey keeps its picks under names with brackets, apostrophes and hyphens: the subclass grants and the pack feats whose lower case is not their key.", () => {
  const hero = world.addHero({ name: "Lore Keeper", class: "bard", level: 3 });
  const stored = {
    "bonus proficiencies (lore)": { skills: ["arcana", "history", "nature"] },
    "giant's power": { cantrips: ["Thaumaturgy"] },
    "bonus proficiency (heavy armor)": { skills: [] },
    "dual-wielding expert": { ability: "dex" },
  };
  getDatabase().prepare("UPDATE character_sheets SET feat_choices_json = ? WHERE id = ?").run(JSON.stringify(stored), hero.id);
  const read = getSheetById(hero.id);
  assert.deepEqual(featChoice(read.featChoices, "Bonus Proficiencies (Lore)"), stored["bonus proficiencies (lore)"]);
  assert.deepEqual(featChoice(read.featChoices, "Giant’s Power"), stored["giant's power"]);
  assert.deepEqual(featChoice(read.featChoices, "Bonus Proficiency (heavy armor)"), stored["bonus proficiency (heavy armor)"]);
  assert.deepEqual(featChoice(read.featChoices, "Dual-Wielding Expert"), stored["dual-wielding expert"]);
});

await test("an NPC renamed onto a name another NPC holds in another case or spelling is refused as the clash it is.", async () => {
  const elodie = upsertNpc({ campaignId: world.campaignId, name: "Élodie" });
  const marta = upsertNpc({ campaignId: world.campaignId, name: "Marta" });
  globalThis.__odmTestToken = mintSession(world.owner.id).token;
  const rename = (npcId, name) =>
    review.POST(new Request(`http://odm.test/api/campaigns/${world.campaignId}/npcs/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rename", npcId, name }) }), { params: Promise.resolve({ campaignId: world.campaignId }) });
  for (const name of ["ÉLODIE", "élodie", "Élodie"]) {
    const response = await rename(marta.id, name);
    assert.equal(response.status, 409, `${name}: ${response.status}`);
  }
  assert.equal(getNpcByName(world.campaignId, "Marta")?.id, marta.id, "the refused rename changed the NPC");
  const renamed = await rename(marta.id, "Marta la Rossa");
  assert.equal(renamed.status, 200, await renamed.clone().text());
  assert.deepEqual(listNpcs(world.campaignId).map((npc) => npc.name).sort(), ["Marta la Rossa", "Élodie"].sort());
  assert.equal(getNpcByName(world.campaignId, "ÉLODIE")?.id, elodie.id);
});

await test("Favored Enemy and Natural Explorer picks are keys of the rules' English vocabulary, in the singular or the plural the SRD writes: monstrosities, elves, dwarves and gnolls are favored, and a forest and a swamp explored.", () => {
  const owlbear = { slug: "owlbear", stats: { type: "monstrosity" } };
  const drow = { slug: "drow", stats: { type: "humanoid (elf)" } };
  const dwarf = { slug: "duergar", stats: { type: "humanoid (dwarf)" } };
  const gnoll = { slug: "gnoll", stats: { type: "humanoid (gnoll)" } };
  const imp = { slug: "imp", stats: { type: "fiend (devil)" } };
  const zombie = { slug: "zombie", stats: { type: "undead" } };
  const favored = (feature, enemy) => isFavoredEnemy({ features: [{ name: feature }] }, enemy);
  assert.ok(favored("Favored Enemy: monstrosities", owlbear));
  assert.ok(favored("Favored Enemy (elves and dwarves)", drow));
  assert.ok(favored("Favored Enemy (elves and dwarves)", dwarf));
  assert.ok(favored("Favored Enemy: gnolls, orcs", gnoll));
  assert.ok(favored("Favored Enemy: fiend", imp));
  assert.ok(favored("Favored Enemy Improvement: Undead", zombie));
  assert.ok(!favored("Favored Enemy: elves", dwarf));
  assert.ok(!favored("Favored Enemy: orcs", { slug: "forcemage", stats: { type: "humanoid (human)" } }));
  // A pick is a key of the rules' English vocabulary, at every table, as
  // the feature's own name is: a word of the table's language is none.
  for (const pick of ["non morti", "morts-vivants", "no muertos", "Untote"]) {
    assert.ok(!favored(`Favored Enemy: ${pick}`, zombie), pick);
  }
  // The check a pick gives advantage to, about the creature a call names.
  const traits = heldCheckTraits({ features: [{ name: "Favored Enemy: monstrosities, elves" }, { name: "Natural Explorer: forests and swamps" }], feats: [] });
  const tracking = traits.find((trait) => trait.about === "tracking");
  for (const creature of ["monstrosity", "monstrosities", "elf", "elves"]) {
    assert.ok(keyFits(tracking, { roll: "check", skill: "survival", about: "tracking", creature }), creature);
  }
  assert.ok(!keyFits(tracking, { roll: "check", skill: "survival", about: "tracking", creature: "dwarf" }));
  assert.deepEqual(traits.find((trait) => trait.terrains)?.terrains, ["forest", "swamp"]);
});

finish();
