// The level-up dialog's and the builder's picks from any class's spell list
// (issue #570, the SRD text audit, CLS-19 to CLS-22). The level-up route took
// a bard's Magical Secrets, a Lore bard's Additional Magical Secrets and a
// Pact of the Tome warlock's Book of Shadows cantrips by name, but both
// screens listed only the class's own spells and counted no extras, so a
// player could not make the picks. src/lib/srd/any-list-picks-logic.ts says
// what group the screen offers and what the class's list keeps; each case
// here also sends what the screen proposes to the route's own check
// (src/lib/srd/level-up-spells.ts), which stays the authority.
// Pure: no database, no server.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { spellPickRooms, offListHeld, anyListPickRefusal, anyListTiles } = await import("../src/lib/srd/any-list-picks-logic.ts");
const { classSpellGrants } = await import("../src/lib/srd/class-spell-grants.ts");
const { levelUpSpells } = await import("../src/lib/srd/level-up-spells.ts");
const { casterPreview } = await import("../src/app/campaigns/[campaignId]/level-up-preview.ts");
const { checklistSpell, checklistSpellsOn } = await import("../src/lib/srd/spell-lists.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
  passed += 1;
}

const ABILITIES = { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16 };
const listOf = (classId, from, to) =>
  checklistSpellsOn(classId)
    .filter((spell) => spell.level >= from && spell.level <= to)
    .map((spell) => spell.name);
const onList = (classId) => (name) => (checklistSpell(name)?.classes ?? []).includes(classId);

// The room the dialog reads for a known caster taking a level: the tables'
// counts at the new level, the features' extras on top, less what is held.
function dialogRooms({ classId, levelAfter, subclass = "", features = [], known, cantrips, picks = [] }) {
  const preview = casterPreview({ classId, subclass, level: levelAfter, abilitiesAfter: ABILITIES });
  const grants = classSpellGrants({ classId, level: levelAfter, subclass, features });
  const before = classSpellGrants({ classId, level: levelAfter - 1, subclass, features });
  const granted = (name) => grants.learned.includes(name);
  const held = known.filter((name) => !granted(name)).length;
  const rooms = spellPickRooms({
    grants,
    before,
    keptOff: offListHeld({ grants, cantrips, spells: known, onList: onList(classId), granted, freeCantrips: 0 }),
    spells: Math.max(0, preview.spellCap.count + grants.extraSpells - held),
    cantrips: Math.max(0, preview.cantripCap + grants.extraCantrips - cantrips.length),
    picks: picks.map((name) => checklistSpell(name)?.level === 0),
    own: classId,
    maxLevel: preview.maxLevel,
  });
  return { rooms, grants };
}

// What the level-up route answers when the dialog sends these picks.
function routeTakes({ classId, levelAfter, subclass = "", features = [], known, cantrips, picks }) {
  return levelUpSpells({
    before: { classId, ability: "cha", level: levelAfter - 1, subclass, style: "known", known, prepared: [], cantrips, pending: [], spellbook: [], features },
    level: levelAfter,
    subclass,
    list: classId,
    firstLevel: false,
    abilities: ABILITIES,
    freeCantrips: 0,
    features,
    spellOf: checklistSpell,
    picks: { kind: "picks", spells: picks },
  });
}

const BARD_CANTRIPS = listOf("bard", 0, 0);
const BARD_SPELLS = listOf("bard", 1, 5);
const notBard = (name) => !onList("bard")(name);
assert.ok(["Fireball", "Counterspell", "Haste", "Cone of Cold"].every(notBard), "the spells these cases take from other lists are off the bard's");

// SRD 5.1 bard, Magical Secrets (10th): "Choose two spells from any classes,
// including this one. ... The chosen spells count as bard spells for you and
// are included in the number in the Spells Known column of the Bard table."
test("A bard reaching 10th level is offered Magical Secrets' two spells from any class as their own group, out of the two new spells known", () => {
  const bard9 = { classId: "bard", levelAfter: 10, known: BARD_SPELLS.slice(0, 12), cantrips: BARD_CANTRIPS.slice(0, 3) };
  const { rooms } = dialogRooms(bard9);
  assert.ok(rooms.group, "no group for Magical Secrets");
  assert.equal(rooms.group.title, "Magical Secrets: 2 spells from any class");
  assert.equal(rooms.group.slots, 2);
  assert.equal(rooms.group.spells, true);
  assert.equal(rooms.spells, 0, "the class's own list kept the two Magical Secrets spells as well");
  assert.equal(rooms.cantrips, 1, "the bard's new cantrip at 10th went missing");
  assert.match(rooms.group.hint, /bard's included/);
  assert.match(rooms.group.hint, /count among your spells known/);
  const taken = routeTakes({ ...bard9, picks: ["Fireball", "Counterspell"] });
  assert.ok("view" in taken, `the route refused the dialog's Magical Secrets: ${taken.error}`);
});

test("A bard below 10th level without the College of Lore is offered no group, and keeps the class's count as before", () => {
  const { rooms } = dialogRooms({ classId: "bard", levelAfter: 9, known: BARD_SPELLS.slice(0, 11), cantrips: BARD_CANTRIPS.slice(0, 3) });
  assert.equal(rooms.group, null);
  assert.equal(rooms.spells, 1);
});

// SRD 5.1, College of Lore, Additional Magical Secrets (6th): "you learn two
// spells of your choice from any class ... but don't count against the
// number of bard spells you know."
test("A Lore bard reaching 6th level is offered Additional Magical Secrets' two on top of the new spell the class's list keeps", () => {
  const lore5 = { classId: "bard", levelAfter: 6, subclass: "College of Lore", known: BARD_SPELLS.slice(0, 8), cantrips: BARD_CANTRIPS.slice(0, 3) };
  const { rooms } = dialogRooms(lore5);
  assert.equal(rooms.group?.title, "Additional Magical Secrets: 2 spells from any class");
  assert.equal(rooms.spells, 1, "the bard's own new spell at 6th went missing, or the two were counted inside the count");
  assert.match(rooms.group.hint, /on top of your spells known/);
  assert.equal(rooms.group.cantrips, false, "a cantrip was offered with no new cantrip open");
  const next = BARD_SPELLS.find((name) => !lore5.known.includes(name) && checklistSpell(name).level <= 3);
  const taken = routeTakes({ ...lore5, picks: [next, "Fireball", "Counterspell"] });
  assert.ok("view" in taken, `the route refused the dialog's Additional Magical Secrets: ${taken.error}`);
});

test("A Lore bard reaching 10th with Additional Magical Secrets already taken off the list is offered Magical Secrets' two, named so", () => {
  const known = [...BARD_SPELLS.slice(0, 12), "Fireball", "Counterspell"];
  const lore9 = { classId: "bard", levelAfter: 10, subclass: "College of Lore", known, cantrips: BARD_CANTRIPS.slice(0, 3) };
  const { rooms } = dialogRooms(lore9);
  assert.equal(rooms.group?.title, "Magical Secrets: 2 spells from any class");
  assert.equal(rooms.spells, 0);
  const taken = routeTakes({ ...lore9, picks: ["Haste", "Cone of Cold"] });
  assert.ok("view" in taken, `the route refused the dialog's Magical Secrets: ${taken.error}`);
});

test("A Lore bard reaching 10th who never used Additional Magical Secrets is told both features' picks are open", () => {
  const { rooms } = dialogRooms({ classId: "bard", levelAfter: 10, subclass: "College of Lore", known: BARD_SPELLS.slice(0, 14), cantrips: BARD_CANTRIPS.slice(0, 3) });
  assert.equal(rooms.group?.title, "Magical Secrets and Additional Magical Secrets: 2 spells from any class");
  assert.match(rooms.group.hint, /The 2 from Additional Magical Secrets come on top of your spells known/);
});

test("A bard whose Magical Secrets are already spent off the list is offered no group at 11th", () => {
  const { rooms } = dialogRooms({ classId: "bard", levelAfter: 11, known: [...BARD_SPELLS.slice(0, 12), "Fireball", "Counterspell"], cantrips: BARD_CANTRIPS.slice(0, 4) });
  assert.equal(rooms.group, null);
  assert.equal(rooms.spells, 1);
});

test("A bard who gives up a Magical Secrets spell on a level-up may take its place from any class again", () => {
  // The spell given up is out of the lists the dialog reads, and its place is one more pick.
  const known = [...BARD_SPELLS.slice(0, 12), "Counterspell"];
  const grants = classSpellGrants({ classId: "bard", level: 11 });
  const before = classSpellGrants({ classId: "bard", level: 10 });
  const keptOff = offListHeld({ grants, cantrips: [], spells: known, onList: onList("bard"), granted: () => false, freeCantrips: 0 });
  assert.equal(keptOff, 1);
  const rooms = spellPickRooms({ grants, before, keptOff, spells: 2, cantrips: 0, picks: [], own: "bard", maxLevel: 6 });
  assert.equal(rooms.group?.title, "Magical Secrets: 1 spell from any class");
  assert.equal(rooms.spells, 1);
});

test("A cantrip chosen through Magical Secrets takes one of the new cantrips too, and a second one does not fit", () => {
  const bard9 = { classId: "bard", levelAfter: 10, known: BARD_SPELLS.slice(0, 12), cantrips: BARD_CANTRIPS.slice(0, 3) };
  const { rooms } = dialogRooms({ ...bard9, picks: ["Fire Bolt", "Sacred Flame"] });
  assert.equal(rooms.kept, 1, "a cantrip past the open cantrips was kept");
  assert.equal(rooms.cantrips, 0, "the class's list still offered the cantrip Magical Secrets took");
  assert.match(rooms.group.hint, /A cantrip chosen here also takes one of your new cantrips/);
  const refusal = anyListPickRefusal({ group: rooms.group, picked: 1, cantrip: true, cantripsOpen: 0, name: "Sacred Flame" });
  assert.equal(refusal?.short, "Cantrips full");
  const taken = routeTakes({ ...bard9, picks: ["Fire Bolt", "Fireball"] });
  assert.ok("view" in taken, `the route refused a Magical Secrets cantrip: ${taken.error}`);
});

// SRD 5.1 warlock, Pact of the Tome: "choose three cantrips from any class's
// spell list ... They don't count against your number of cantrips known."
test("A warlock taking Pact of the Tome at 3rd is offered the Book of Shadows' three cantrips from any class, and keeps the new spell", () => {
  const features = [{ name: "Pact Boon: Pact of the Tome" }];
  const warlock2 = { classId: "warlock", levelAfter: 3, features, known: listOf("warlock", 1, 1).slice(0, 3), cantrips: listOf("warlock", 0, 0).slice(0, 2) };
  const { rooms } = dialogRooms(warlock2);
  assert.equal(rooms.group?.title, "Pact of the Tome: 3 cantrips from any class");
  assert.equal(rooms.group.spells, false);
  assert.equal(rooms.group.cantrips, true);
  assert.equal(rooms.cantrips, 0, "the three were counted inside the warlock's cantrips known");
  assert.equal(rooms.spells, 1, "the warlock's new spell at 3rd went missing");
  assert.match(rooms.group.hint, /Book of Shadows/);
  const taken = routeTakes({ ...warlock2, picks: ["Fire Bolt", "Sacred Flame", "Guidance"] });
  assert.ok("view" in taken, `the route refused the Book of Shadows' cantrips: ${taken.error}`);
  // The group is full at three; a tap on a fourth says so.
  const full = anyListPickRefusal({ group: rooms.group, picked: 3, cantrip: true, cantripsOpen: 0, name: "Light" });
  assert.equal(full?.short, "All chosen");
  assert.equal(anyListPickRefusal({ group: rooms.group, picked: 2, cantrip: true, cantripsOpen: 0, name: "Light" }), null, "the Book of Shadows' cantrips were held to the class's cantrip room");
});

test("A warlock without Pact of the Tome is offered no cantrips from other classes", () => {
  const { rooms } = dialogRooms({ classId: "warlock", levelAfter: 3, features: [{ name: "Pact Boon: Pact of the Blade" }], known: listOf("warlock", 1, 1).slice(0, 3), cantrips: listOf("warlock", 0, 0).slice(0, 2) });
  assert.equal(rooms.group, null);
  assert.equal(rooms.cantrips, 0);
});

// SRD 5.1 warlock, Pact of the Chain: "You learn the find familiar spell ...
// The spell doesn't count against your number of spells known."
test("A Pact of the Chain warlock is granted find familiar, named by the pact, with no pick to make for it", () => {
  const { rooms, grants } = dialogRooms({ classId: "warlock", levelAfter: 3, features: [{ name: "Pact Boon: Pact of the Chain" }], known: listOf("warlock", 1, 1).slice(0, 3), cantrips: listOf("warlock", 0, 0).slice(0, 2) });
  assert.deepEqual(grants.learned, ["Find Familiar"]);
  assert.equal(grants.learnedFrom, "Pact of the Chain");
  assert.equal(rooms.group, null);
  assert.equal(rooms.spells, 1, "find familiar took the warlock's new spell");
});

test("The race's cantrips held off the list are not counted against the Book of Shadows", () => {
  const grants = classSpellGrants({ classId: "warlock", level: 3, features: [{ name: "Pact Boon: Pact of the Tome" }] });
  const count = offListHeld({ grants, cantrips: ["Eldritch Blast", "Thaumaturgy"], spells: [], onList: onList("warlock"), granted: () => false, freeCantrips: 1 });
  assert.equal(count, 0);
});

test("The group's tiles leave out what is held, take only what the feature takes, and say when a spell is chosen from the class's list", () => {
  const { rooms } = dialogRooms({ classId: "bard", levelAfter: 10, known: BARD_SPELLS.slice(0, 12), cantrips: BARD_CANTRIPS.slice(0, 3) });
  const pool = [
    { name: "Fireball", level: 3 },
    { name: "Counterspell", level: 3 },
    { name: "Fire Bolt", level: 0 },
    { name: BARD_SPELLS[0], level: checklistSpell(BARD_SPELLS[0]).level },
    { name: "Tasha's Lost Spell", level: 2, source: "homebrew", document: "A Table's Book", documentSlug: "homebrew" },
  ];
  const tiles = anyListTiles({
    group: rooms.group,
    pool,
    held: (name) => name === BARD_SPELLS[0],
    picks: ["Fireball"],
    elsewhere: (name) => (name === "Counterspell" ? "Chosen above" : null),
    refusal: () => null,
  });
  const byName = Object.fromEntries(tiles.map((tile) => [tile.name, tile]));
  assert.equal(byName[BARD_SPELLS[0]], undefined, "a spell the bard knows was offered again");
  assert.equal(byName.Fireball.state, "ready");
  assert.equal(byName.Fireball.note, "New");
  assert.equal(byName.Counterspell.blocked, "Chosen above");
  assert.ok(byName["Fire Bolt"], "a cantrip was left out while a new cantrip is open");
  assert.equal(byName["Tasha's Lost Spell"].homebrew, true);
  const tome = dialogRooms({ classId: "warlock", levelAfter: 3, features: [{ name: "Pact Boon: Pact of the Tome" }], known: listOf("warlock", 1, 1).slice(0, 3), cantrips: listOf("warlock", 0, 0).slice(0, 2) }).rooms;
  const cantripsOnly = anyListTiles({ group: tome.group, pool, held: () => false, picks: [], elsewhere: () => null, refusal: () => null });
  assert.deepEqual(cantripsOnly.map((tile) => tile.name), ["Fire Bolt"], "the Book of Shadows offered levelled spells");
});

// ---- the builder's spell step (a character made above 1st level, and the
// library's Level up, which runs on the same step) ----

const { builderAnyListGroup } = await import("../src/lib/srd/any-list-picks-logic.ts");
const { openBuilder } = await import("./lib/enforce-builder.mjs");
const builder = await openBuilder();

test("The builder counts a Lore bard's Additional Magical Secrets on top of the spells known, and groups the picks off the bard's list", () => {
  const spells = [...BARD_SPELLS.filter((name) => checklistSpell(name).level <= 3).slice(0, 9), "Fireball", "Counterspell"];
  const built = builder.build({ race: "human", class: "bard", background: "sage", level: 6, subclass: "College of Lore", spells, cantrips: BARD_CANTRIPS.slice(0, 3) });
  assert.equal(built.derived.spellAdvice?.count, 11, "a Lore bard of 6th knows 9 bard spells and two more from Additional Magical Secrets");
  const { group, chosen } = builderAnyListGroup({
    grants: built.derived.spellGrants,
    cantrips: built.derived.chosenCantrips,
    spells: built.derived.chosenSpells,
    onList: onList("bard"),
    cantripCap: built.derived.cantripAdvice,
    own: "bard",
    maxLevel: built.derived.maxSpellLevel,
  });
  assert.equal(group?.title, "Additional Magical Secrets: 2 spells from any class");
  assert.deepEqual(chosen, ["Fireball", "Counterspell"]);
  assert.match(group.hint, /other class's spell list \(the bard's own are above\)/);
  assert.equal(group.sharesSpells, true, "a builder pick from any class sat outside the list's count");
  assert.equal(
    anyListPickRefusal({ group, picked: chosen.length, cantrip: false, cantripsOpen: 0, spellsOpen: 0, name: "Haste" })?.short,
    "All chosen",
  );
  assert.deepEqual(
    built.sheet?.spellcasting?.known?.filter((name) => notBard(name)),
    ["Fireball", "Counterspell"],
    "the saved sheet lost the picks from other lists",
  );
});

test("The builder counts the Book of Shadows' three cantrips on top of a warlock's cantrips known", () => {
  const built = builder.build({ race: "human", class: "warlock", background: "sage", level: 3, optionPicks: ["Pact Boon: Pact of the Tome"] });
  assert.equal(built.derived.cantripAdvice, 5);
  const { group } = builderAnyListGroup({
    grants: built.derived.spellGrants,
    cantrips: ["Eldritch Blast", "Fire Bolt"],
    spells: [],
    onList: onList("warlock"),
    cantripCap: built.derived.cantripAdvice,
    own: "warlock",
    maxLevel: built.derived.maxSpellLevel,
  });
  assert.equal(group?.title, "Pact of the Tome: 3 cantrips from any class");
  assert.equal(group.spells, false);
  const plain = builder.build({ race: "human", class: "warlock", background: "sage", level: 3, optionPicks: ["Pact Boon: Pact of the Blade"] });
  assert.equal(plain.derived.cantripAdvice, 2, "a blade warlock was given the tome's cantrips");
});

test("A Pact of the Chain warlock built at 3rd holds find familiar free of the spells known, and the saved sheet carries it", () => {
  const built = builder.build({ race: "human", class: "warlock", background: "sage", level: 3, optionPicks: ["Pact Boon: Pact of the Chain"], spells: listOf("warlock", 1, 2).slice(0, 4) });
  assert.ok(built.derived.subclassSpells.includes("Find Familiar"), "find familiar is not shown as granted");
  assert.equal(built.derived.chosenSpells.length, 4, "find familiar took a place among the spells known");
  assert.ok(built.sheet?.spellcasting?.known?.includes("Find Familiar"), "the saved sheet does not carry find familiar");
});

console.log(`test-any-list-picks: ${passed} passed`);
