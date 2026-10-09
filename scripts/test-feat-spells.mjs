// The spells a feat teaches, read from its text (src/lib/srd/feat-spells.ts,
// issue #125): Fey Touched's misty step and a 1st-level divination or
// enchantment spell, Shadow Touched's invisibility, Spell Sniper's attack
// cantrip, Magic Initiate's two cantrips and a spell from one list (both the
// 2014 and the 2024 wording), Ritual Caster's two ritual spells; the picks
// owed, the strict checks, the lists they land on and the free-cast counter.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  featSpellGrants, featSpellSpec, featSpellsAnything, featSpellsOwed, freeCastFeatureName, freeCastFeatures,
  freeCastOf, freeCastResourceId, freeCastSpellOf, withFeatSpells, withoutFeatSpells, listAbility,
} = await import("../src/lib/srd/feat-spells.ts");
const { authoredFeatDesc } = await import("../src/lib/srd/feat-effects.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const spec = (name) => featSpellSpec(authoredFeatDesc(name));

const MAGIC_INITIATE_2014 =
  "Choose a class: bard, cleric, druid, sorcerer, warlock, or wizard. You learn two cantrips of your choice from that class's spell list. In addition, choose one 1st-level spell from that same list. You learn that spell and can cast it at its lowest level. Once you cast it, you must finish a long rest before you can cast it again using this feat. Your spellcasting ability for these spells depends on the class you chose: Charisma for bard, sorcerer, or warlock; Wisdom for cleric or druid; or Intelligence for wizard.";
const MAGIC_INITIATE_2024 =
  "You learn two cantrips of your choice from the Cleric, Druid, or Wizard spell list. Intelligence, Wisdom, or Charisma is your spellcasting ability for this feat's spells (choose when you select this feat). Choose a level 1 spell from the same list you selected for this feat's cantrips. You always have that spell prepared. You can cast it once without a spell slot, and you regain the ability to cast it in that way when you finish a Long Rest. You can also cast the spell using any spell slots you have.";

test("the authored feats' spells are read from their text", () => {
  const fey = spec("Fey Touched");
  assert.deepEqual(fey.fixedSpells, ["misty step"]);
  assert.equal(fey.spells, 1);
  assert.equal(fey.spellLevel, 1);
  assert.deepEqual(fey.schools, ["divination", "enchantment"]);
  assert.equal(fey.freeCast, true);
  assert.equal(fey.ability, "raised");
  const shadow = spec("Shadow Touched");
  assert.deepEqual(shadow.fixedSpells, ["invisibility"]);
  assert.deepEqual(shadow.schools, ["illusion", "necromancy"]);
  const sniper = spec("Spell Sniper");
  assert.equal(sniper.cantrips, 1);
  assert.equal(sniper.attackCantrip, true);
  assert.deepEqual(sniper.lists, ["bard", "cleric", "druid", "sorcerer", "warlock", "wizard"]);
  assert.equal(sniper.listChoice, false);
  assert.equal(sniper.spells, 0);
  const ritual = spec("Ritual Caster");
  assert.equal(ritual.spells, 2);
  assert.equal(ritual.ritualBook, true);
  assert.equal(ritual.listChoice, true);
  assert.equal(ritual.freeCast, false);
  assert.equal(featSpellsAnything(spec("Linguist")), false);
  assert.equal(featSpellsAnything(spec("War Caster")), false);
  assert.equal(featSpellsAnything(spec("Elemental Adept")), false);
});

test("Magic Initiate is read in both wordings", () => {
  const old = featSpellSpec(MAGIC_INITIATE_2014);
  assert.equal(old.cantrips, 2);
  assert.equal(old.spells, 1);
  assert.equal(old.listChoice, true);
  assert.deepEqual(old.lists, ["bard", "cleric", "druid", "sorcerer", "warlock", "wizard"]);
  assert.equal(old.freeCast, true);
  assert.equal(old.ability, "list");
  const now = featSpellSpec(MAGIC_INITIATE_2024);
  assert.equal(now.cantrips, 2);
  assert.equal(now.spells, 1);
  assert.equal(now.listChoice, true);
  assert.deepEqual(now.lists, ["cleric", "druid", "wizard"]);
  assert.equal(now.freeCast, true);
  assert.equal(now.ability, "choice");
  // ODM's own Magic Initiate (the 2024 row is not offered by the pickers).
  const own = spec("Magic Initiate");
  assert.equal(own.cantrips, 2);
  assert.equal(own.spells, 1);
  assert.equal(own.listChoice, true);
  assert.deepEqual(own.lists, ["bard", "cleric", "druid", "sorcerer", "warlock", "wizard"]);
  assert.equal(own.freeCast, true);
  assert.equal(own.ability, "list");
  assert.equal(listAbility("wizard"), "int");
  assert.equal(listAbility("druid"), "wis");
  assert.equal(listAbility("bard"), "cha");
});

test("what is still owed is worded for the gate", () => {
  assert.equal(featSpellsOwed("Fey Touched", spec("Fey Touched"), undefined), "Fey Touched: pick 1 1st-level divination or enchantment spell.");
  assert.equal(featSpellsOwed("Fey Touched", spec("Fey Touched"), { spells: ["Bless"] }), null);
  assert.equal(featSpellsOwed("Spell Sniper", spec("Spell Sniper"), {}), "Spell Sniper: pick 1 attack cantrip.");
  assert.equal(
    featSpellsOwed("Magic Initiate", featSpellSpec(MAGIC_INITIATE_2024), {}),
    "Magic Initiate: pick a class list, a spellcasting ability, 2 cantrips, 1 1st-level spell.",
  );
  assert.equal(featSpellsOwed("Ritual Caster", spec("Ritual Caster"), { list: "wizard", spells: ["Find Familiar"] }), "Ritual Caster: pick 1 1st-level ritual spell.");
  assert.equal(featSpellsOwed("Linguist", spec("Linguist"), undefined), null);
});

const SPELLS = {
  "misty step": { name: "Misty Step", level: 2, classes: ["sorcerer", "warlock", "wizard"], school: "conjuration" },
  bless: { name: "Bless", level: 1, classes: ["cleric", "paladin"], school: "enchantment" },
  "detect magic": { name: "Detect Magic", level: 1, classes: ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "wizard"], school: "divination", ritual: true },
  "burning hands": { name: "Burning Hands", level: 1, classes: ["sorcerer", "wizard"], school: "evocation", ritual: false },
  "fire bolt": { name: "Fire Bolt", level: 0, classes: ["sorcerer", "wizard"], school: "evocation" },
  "cure wounds": { name: "Cure Wounds", level: 1, classes: ["bard", "cleric", "druid", "paladin", "ranger"], school: "evocation" },
  "find familiar": { name: "Find Familiar", level: 1, classes: ["wizard"], school: "conjuration", ritual: true },
  "sacred flame": { name: "Sacred Flame", level: 0, classes: ["cleric"], school: "evocation" },
  guidance: { name: "Guidance", level: 0, classes: ["cleric", "druid"], school: "divination" },
};
const spellOf = (name) => SPELLS[name.trim().toLowerCase()] ?? null;
const feats = (...names) => names.map((name) => ({ name, desc: name === "Magic Initiate" ? MAGIC_INITIATE_2024 : authoredFeatDesc(name) }));
const raised = () => "wis";

test("a Fey Touched fighter knows misty step and the pick, both free once a day, cast with the raised score", () => {
  const verdict = featSpellGrants({ feats: feats("Fey Touched"), choices: { "fey touched": { spells: ["bless"] } }, raisedAbility: raised, spellOf, strict: true });
  assert.deepEqual(verdict.problems, []);
  assert.equal(verdict.grants.length, 1);
  const [grant] = verdict.grants;
  assert.deepEqual(grant.spells, ["Misty Step", "Bless"]);
  assert.deepEqual(grant.freeCasts, ["Misty Step", "Bless"]);
  assert.deepEqual(grant.cantrips, []);
  assert.equal(grant.ability, "wis");
  assert.deepEqual(freeCastFeatures(verdict.grants), ["Free cast: Misty Step (Fey Touched)", "Free cast: Bless (Fey Touched)"]);
  const lists = withFeatSpells(null, verdict.grants);
  assert.deepEqual(lists, { ability: "wis", slots: {}, cantrips: [], known: ["Misty Step", "Bless"], prepared: [] });
});

test("the strict checks hold the pick to the feat's school, level and list", () => {
  const wrongSchool = featSpellGrants({ feats: feats("Fey Touched"), choices: { "fey touched": { spells: ["burning hands"] } }, raisedAbility: raised, spellOf, strict: true });
  assert.ok(wrongSchool.problems.some((line) => /evocation spell; Fey Touched's spell is picked from divination or enchantment/.test(line)), wrongSchool.problems.join(" | "));
  const wrongLevel = featSpellGrants({ feats: feats("Fey Touched"), choices: { "fey touched": { spells: ["fire bolt"] } }, raisedAbility: raised, spellOf, strict: true });
  assert.ok(wrongLevel.problems.some((line) => /is a cantrip; Fey Touched's spell is a 1st-level spell/.test(line)), wrongLevel.problems.join(" | "));
  const unknown = featSpellGrants({ feats: feats("Fey Touched"), choices: { "fey touched": { spells: ["Mend Fences"] } }, raisedAbility: raised, spellOf, strict: true });
  assert.ok(unknown.problems.some((line) => /not a spell the server knows/.test(line)));
  const owed = featSpellGrants({ feats: feats("Fey Touched"), choices: {}, raisedAbility: raised, spellOf, strict: true });
  assert.deepEqual(owed.problems, ["Fey Touched: pick 1 1st-level divination or enchantment spell."]);
  // Lenient: a stored sheet is read as it is, misty step still arrives.
  const stored = featSpellGrants({ feats: feats("Fey Touched"), choices: {}, raisedAbility: raised, spellOf, strict: false });
  assert.deepEqual(stored.problems, []);
  assert.deepEqual(stored.grants[0].spells, ["Misty Step"]);
});

test("Magic Initiate's picks come from the one list chosen, with the ability named", () => {
  const good = featSpellGrants({
    feats: feats("Magic Initiate"),
    choices: { "magic initiate": { list: "cleric", ability: "wis", cantrips: ["sacred flame", "guidance"], spells: ["cure wounds"] } },
    raisedAbility: () => null, spellOf, strict: true,
  });
  assert.deepEqual(good.problems, []);
  assert.deepEqual(good.grants[0].cantrips, ["Sacred Flame", "Guidance"]);
  assert.deepEqual(good.grants[0].spells, ["Cure Wounds"]);
  assert.deepEqual(good.grants[0].freeCasts, ["Cure Wounds"]);
  assert.equal(good.grants[0].ability, "wis");
  assert.equal(good.grants[0].list, "cleric");
  const offList = featSpellGrants({
    feats: feats("Magic Initiate"),
    choices: { "magic initiate": { list: "cleric", ability: "wis", cantrips: ["fire bolt", "guidance"], spells: ["cure wounds"] } },
    raisedAbility: () => null, spellOf, strict: true,
  });
  assert.ok(offList.problems.some((line) => /Fire Bolt is not on the cleric list/.test(line)), offList.problems.join(" | "));
  const badList = featSpellGrants({
    feats: feats("Magic Initiate"),
    choices: { "magic initiate": { list: "warlock", ability: "cha", cantrips: ["fire bolt", "guidance"], spells: ["cure wounds"] } },
    raisedAbility: () => null, spellOf, strict: true,
  });
  assert.ok(badList.problems.some((line) => /come from the cleric, druid, wizard list; "warlock" is not one of them/.test(line)), badList.problems.join(" | "));
  // The 2014 wording settles the ability by the class.
  const old = featSpellGrants({
    feats: [{ name: "Magic Initiate", desc: MAGIC_INITIATE_2014 }],
    choices: { "magic initiate": { list: "wizard", cantrips: ["fire bolt", "guidance"], spells: ["burning hands"] } },
    raisedAbility: () => null, spellOf, strict: false,
  });
  assert.equal(old.grants[0].ability, "int");
});

test("Ritual Caster's two spells go in a ritual book, never free, held to the ritual tag", () => {
  const good = featSpellGrants({
    feats: feats("Ritual Caster"),
    choices: { "ritual caster": { list: "wizard", spells: ["find familiar", "detect magic"] } },
    raisedAbility: () => null, spellOf, strict: true,
  });
  assert.deepEqual(good.problems, []);
  assert.deepEqual(good.grants[0].rituals, ["Find Familiar", "Detect Magic"]);
  assert.deepEqual(good.grants[0].spells, []);
  assert.deepEqual(good.grants[0].freeCasts, []);
  const lists = withFeatSpells({ ability: "int", slots: {}, cantrips: [], known: [], prepared: [] }, good.grants);
  assert.deepEqual(lists.spellbook, ["Find Familiar", "Detect Magic"]);
  assert.deepEqual(lists.known, []);
  const notRitual = featSpellGrants({
    feats: feats("Ritual Caster"),
    choices: { "ritual caster": { list: "wizard", spells: ["find familiar", "burning hands"] } },
    raisedAbility: () => null, spellOf, strict: true,
  });
  assert.ok(notRitual.problems.some((line) => /Burning Hands has no ritual tag/.test(line)), notRitual.problems.join(" | "));
});

test("Spell Sniper adds its cantrip to a caster's list on top of the class's", () => {
  const verdict = featSpellGrants({ feats: feats("Spell Sniper"), choices: { "spell sniper": { cantrips: ["fire bolt"] } }, raisedAbility: () => null, spellOf, strict: true });
  assert.deepEqual(verdict.problems, []);
  const lists = withFeatSpells({ ability: "int", slots: { "1": { max: 2, used: 0 } }, cantrips: ["Mage Hand"], known: ["Shield"], prepared: [] }, verdict.grants);
  assert.deepEqual(lists.cantrips, ["Mage Hand", "Fire Bolt"]);
  assert.deepEqual(lists.known, ["Shield"]);
  // Taken out again before a re-pick, the class's own stay.
  const bare = withoutFeatSpells(lists, verdict.grants);
  assert.deepEqual(bare.cantrips, ["Mage Hand"]);
  // Nothing to add leaves a non-caster's null alone.
  assert.equal(withFeatSpells(null, []), null);
});

test("the free cast is a feature and a counter the sheet can read back", () => {
  assert.equal(freeCastFeatureName("Misty Step", "Fey Touched"), "Free cast: Misty Step (Fey Touched)");
  assert.deepEqual(freeCastOf("Free cast: Misty Step (Fey Touched)"), { spell: "Misty Step", feat: "Fey Touched" });
  assert.equal(freeCastOf("Racial cantrip: Thaumaturgy"), null);
  assert.equal(freeCastResourceId("Misty Step"), "free_cast_misty_step");
  assert.equal(freeCastSpellOf("free_cast_misty_step"), "misty step");
});


// ---- issue #147: the Level Up and Tome of Heroes wordings ----

test("Level Up's Mystical Talent reads as Magic Initiate: a list, two of its cantrips, a 1st-level spell cast once a day", () => {
  const talent = featSpellSpec("You've learned to channel the spark of magic in you. Select a spell list and learn 2 of its cantrips. From the same list, select a 1st level spell. Without expending a spell slot, you may cast this spell once per long rest. Additionally, you may cast this spell using spell slots of the same level. The spellcasting ability for these spells is the same as the spellcasting class from which the spells are drawn.");
  assert.equal(talent.listChoice, true);
  assert.equal(talent.cantrips, 2);
  assert.equal(talent.spells, 1);
  assert.equal(talent.spellLevel, 1);
  assert.equal(talent.freeCast, true);
  assert.equal(talent.ability, "list");
  assert.equal(featSpellsOwed("Mystical Talent", talent, undefined), "Mystical Talent: pick a class list, 2 cantrips, 1 1st-level spell.");
});

test("Level Up's Power Caster teaches one attack cantrip from any list, and Rite Master fills a ritual book from a chosen list", () => {
  const power = featSpellSpec("Double the range on any spells you cast requiring an attack roll. Cover does not grant your targets an AC bonus when you make attacks against them with a ranged spell. Select and learn one cantrip requiring an attack roll from any spell list. The spellcasting ability for these spells is the same as the spellcasting class from which the spell is drawn.");
  assert.equal(power.cantrips, 1);
  assert.equal(power.attackCantrip, true);
  assert.deepEqual(power.lists, []);
  const rite = featSpellSpec("You have delved into ancient mysteries. When you acquire this feat, select from the bard, cleric, druid, herald, sorcerer, warlock, or wizard spell list and choose two 1st level spells with the ritual tag, which are entered into your ritual book. These spells use the same casting attribute as the list from which they were drawn. You may cast any spells in your ritual book as rituals so long as the book is in your possession.");
  assert.equal(rite.listChoice, true);
  assert.deepEqual(rite.lists, ["bard", "cleric", "druid", "sorcerer", "warlock", "wizard"]);
  assert.equal(rite.spells, 2);
  assert.equal(rite.ritualBook, true);
  assert.equal(rite.freeCast, false);
  assert.equal(rite.ability, "list");
});

test("a cantrip or spell a feat names outright is known: Monster Hunter's altered strike, Friend of the Forest's treeheal, two druid cantrips and speak with animals once a day", () => {
  const hunter = featSpellSpec("You gain an expertise die on checks made to learn information about the Legends and Lore of a creature you can see. You learn the altered strike cantrip. You gain proficiency with the Douse maneuver and do not have to spend exertion to activate it.");
  assert.deepEqual(hunter.fixedCantrips, ["altered strike"]);
  assert.equal(featSpellsAnything(hunter), true);
  const friend = featSpellSpec("* You learn the *treeheal* (see the Magic and Spells chapter) cantrip and two other druid cantrips of your choice. * You also learn the *speak with animals* spell and can cast it once without expending a spell slot. Once you cast it, you must finish a short or long rest before you can cast it in this way again.");
  assert.deepEqual(friend.fixedCantrips, ["treeheal"]);
  assert.equal(friend.cantrips, 2);
  assert.deepEqual(friend.lists, ["druid"]);
  assert.deepEqual(friend.fixedSpells, ["speak with animals"]);
  assert.equal(friend.freeCast, true);
  const grants = featSpellGrants({
    feats: [{ name: "Monster Hunter", desc: "You learn the altered strike cantrip." }],
    choices: {},
    raisedAbility: () => null,
    spellOf: (name) => (name === "altered strike" ? { name: "Altered Strike", level: 0, classes: ["wizard"] } : null),
    strict: true,
  });
  assert.deepEqual(grants.problems, []);
  assert.deepEqual(grants.grants[0].cantrips, ["Altered Strike"]);
});

console.log(`${passed} checks passed`);
