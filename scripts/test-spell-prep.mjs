// Preparing spells on 5e timing (src/lib/srd/spell-prep.ts): who prepares
// and who knows, the allowance, unpreparing at once, preparing at the next
// long rest, a wizard's spellbook, and multiclass mirrors.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  casterViewsOf,
  changePreparation,
  preparedCount,
  settlePreparation,
  spellStyleFor,
  spellbookAllowance,
  spellbookOf,
  withCasterViews,
} = await import("../src/lib/srd/spell-prep.ts");
const { allSpellNames, checklistClassSpell, spellLevelOf } = await import(
  "../src/lib/srd/spell-lists.ts"
);
const { longRestPatch } = await import("../src/lib/dm/rest-logic.ts");

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

const ABILITIES = { str: 10, dex: 12, con: 14, int: 16, wis: 16, cha: 10 };

function cleric(overrides = {}) {
  return {
    class: "cleric",
    level: 1,
    subclass: "",
    classes: [],
    abilities: ABILITIES,
    spellcasting: {
      ability: "wis",
      slots: { 1: { max: 2, used: 0 } },
      known: [],
      prepared: ["Bless", "Cure Wounds", "Guiding Bolt", "Healing Word"],
      cantrips: ["Sacred Flame", "Guidance", "Light"],
      ...overrides,
    },
  };
}

function wizard(overrides = {}) {
  return {
    class: "wizard",
    level: 1,
    subclass: "",
    classes: [],
    abilities: ABILITIES,
    spellcasting: {
      ability: "int",
      slots: { 1: { max: 2, used: 0 } },
      known: [],
      prepared: ["Magic Missile", "Shield"],
      cantrips: ["Fire Bolt"],
      spellbook: ["Magic Missile", "Shield", "Sleep", "Mage Armor", "Detect Magic", "Find Familiar"],
      ...overrides,
    },
  };
}

const ok = (result) => {
  assert.ok(!("error" in result), result.error);
  return result.view;
};

test("each SRD class holds its spells the way the rules say", () => {
  assert.equal(spellStyleFor("wizard"), "spellbook");
  for (const id of ["cleric", "druid", "paladin", "artificer"]) {
    assert.equal(spellStyleFor(id), "prepared", id);
  }
  for (const id of ["bard", "sorcerer", "warlock", "ranger"]) {
    assert.equal(spellStyleFor(id), "known", id);
  }
});

test("a wizard's book starts at six and gains two a level", () => {
  assert.equal(spellbookAllowance(1), 6);
  assert.equal(spellbookAllowance(5), 14);
  assert.equal(spellbookAllowance(20), 44);
});

test("unpreparing takes effect at once", () => {
  const [view] = casterViewsOf(cleric());
  const next = ok(changePreparation(view, "unprepare", "Bless", { abilities: ABILITIES, inClassList: true }));
  assert.deepEqual(next.prepared, ["Cure Wounds", "Guiding Bolt", "Healing Word"]);
  assert.deepEqual(next.pending, []);
});

test("preparing waits for the long rest and is not castable before it", () => {
  const sheet = cleric({ prepared: ["Bless", "Cure Wounds", "Guiding Bolt"] });
  const views = casterViewsOf(sheet);
  const next = ok(changePreparation(views[0], "prepare", "Shield of Faith", { abilities: ABILITIES, inClassList: true }));
  assert.deepEqual(next.pending, ["Shield of Faith"]);
  const casting = withCasterViews(sheet.spellcasting, [next]);
  assert.deepEqual(casting.pending, ["Shield of Faith"]);
  assert.ok(!allSpellNames(casting).includes("Shield of Faith"));
  const rested = settlePreparation(casting);
  assert.ok(rested.prepared.includes("Shield of Faith"));
  assert.equal(rested.pending, undefined);
});

test("the allowance counts spells waiting for the rest", () => {
  // Level 1 cleric, WIS 16: 3 + 1 = 4 prepared. Already four.
  const [view] = casterViewsOf(cleric());
  assert.equal(preparedCount(view), 4);
  const refused = changePreparation(view, "prepare", "Command", { abilities: ABILITIES, inClassList: true });
  assert.ok("error" in refused);
  const freed = ok(changePreparation(view, "unprepare", "Bless", { abilities: ABILITIES, inClassList: true }));
  const queued = ok(changePreparation(freed, "prepare", "Command", { abilities: ABILITIES, inClassList: true }));
  assert.equal(preparedCount(queued), 4);
  assert.ok("error" in changePreparation(queued, "prepare", "Sanctuary", { abilities: ABILITIES, inClassList: true }));
});

test("cancel and unprepare both drop a spell still waiting", () => {
  const [view] = casterViewsOf(cleric({ prepared: ["Bless"], pending: ["Command"] }));
  assert.deepEqual(ok(changePreparation(view, "cancel", "Command", { abilities: ABILITIES, inClassList: true })).pending, []);
  assert.deepEqual(ok(changePreparation(view, "unprepare", "Command", { abilities: ABILITIES, inClassList: true })).pending, []);
});

test("a prepared caster may only prepare from the class list", () => {
  const [view] = casterViewsOf(cleric({ prepared: [] }));
  assert.ok("error" in changePreparation(view, "prepare", "Magic Missile", { abilities: ABILITIES, inClassList: false }));
});

test("cantrips, known casters and subclass spells are refused", () => {
  const [clericView] = casterViewsOf(cleric({ prepared: [] }));
  assert.ok("error" in changePreparation(clericView, "prepare", "Sacred Flame", { abilities: ABILITIES, inClassList: true }));
  const bard = { ...cleric(), class: "bard", spellcasting: { ...cleric().spellcasting, known: ["Sleep"], prepared: [] } };
  const [bardView] = casterViewsOf(bard);
  assert.ok("error" in changePreparation(bardView, "unprepare", "Sleep", { abilities: ABILITIES, inClassList: true }));
  const war = { ...cleric({ prepared: ["Shield of Faith"] }), subclass: "war" };
  const [warView] = casterViewsOf(war);
  const domain = changePreparation(warView, "unprepare", "Shield of Faith", { abilities: ABILITIES, inClassList: true });
  // War domain grants Shield of Faith at 1st level: always prepared, never removed.
  assert.ok("error" in domain, "domain spell stays prepared");
});

test("the life domain grants its spells, always prepared and free", () => {
  const [view] = casterViewsOf({ ...cleric({ prepared: ["Guiding Bolt"] }), subclass: "life" });
  assert.ok("error" in changePreparation(view, "unprepare", "Bless", { abilities: ABILITIES, inClassList: true }));
  assert.equal(preparedCount(view), 1, "granted domain spells never count against the allowance");
  const [byName] = casterViewsOf({ ...cleric({ prepared: [] }), subclass: "Life Domain", level: 3 });
  assert.ok("error" in changePreparation(byName, "prepare", "Spiritual Weapon", { abilities: ABILITIES, inClassList: true }), "a granted spell is already prepared");
});

test("a wizard prepares only from the spellbook, and unpreparing keeps it written", () => {
  const sheet = wizard();
  const [view] = casterViewsOf(sheet);
  assert.equal(view.style, "spellbook");
  assert.ok("error" in changePreparation(view, "prepare", "Fireball", { abilities: ABILITIES, inClassList: true }));
  const dropped = ok(changePreparation(view, "unprepare", "Shield", { abilities: ABILITIES, inClassList: false }));
  assert.ok(spellbookOf(dropped).includes("Shield"));
  assert.ok(!dropped.prepared.includes("Shield"));
  const queued = ok(changePreparation(dropped, "prepare", "Sleep", { abilities: ABILITIES, inClassList: false }));
  assert.deepEqual(queued.pending, ["Sleep"]);
});

test("an older wizard sheet without a spellbook reads its prepared spells as the book", () => {
  const [view] = casterViewsOf(wizard({ spellbook: undefined }));
  assert.deepEqual(spellbookOf(view), ["Magic Missile", "Shield"]);
});

test("the long rest settles pending spells and leaves other sheets untouched", () => {
  const sheet = {
    ...cleric({ prepared: ["Bless"], pending: ["Command"] }),
    maxHp: 10,
    currentHp: 4,
    tempHp: 0,
    hitDice: { die: "d8", total: 1, spent: 1 },
    conditions: [],
    conditionMeta: {},
    resources: {},
    pets: [],
  };
  const patch = longRestPatch(sheet);
  assert.deepEqual(patch.spellcasting.prepared, ["Bless", "Command"]);
  assert.equal(patch.spellcasting.pending, undefined);
  const plain = longRestPatch({ ...sheet, spellcasting: cleric().spellcasting });
  assert.equal("pending" in plain.spellcasting, false);
});

test("multiclass views write back to casters and keep the union mirror", () => {
  const sheet = {
    class: "cleric",
    level: 3,
    subclass: "",
    classes: [
      { id: "cleric", subclass: "", level: 2 },
      { id: "wizard", subclass: "", level: 1 },
    ],
    abilities: ABILITIES,
    spellcasting: {
      ability: "wis",
      slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } },
      known: [],
      prepared: ["Bless", "Magic Missile"],
      cantrips: [],
      casters: [
        { classId: "cleric", ability: "wis", known: [], prepared: ["Bless"], cantrips: [] },
        { classId: "wizard", ability: "int", known: [], prepared: ["Magic Missile"], cantrips: [], spellbook: ["Magic Missile", "Sleep"] },
      ],
    },
  };
  const views = casterViewsOf(sheet);
  assert.equal(views[1].level, 1);
  const wiz = ok(changePreparation(views[1], "prepare", "Sleep", { abilities: ABILITIES, inClassList: false }));
  const casting = withCasterViews(sheet.spellcasting, [views[0], wiz]);
  assert.deepEqual(casting.casters[1].pending, ["Sleep"]);
  assert.equal("pending" in casting.casters[0], false);
  assert.deepEqual(casting.pending, ["Sleep"]);
  assert.deepEqual(casting.prepared, ["Bless", "Magic Missile"]);
  const rested = settlePreparation(casting);
  assert.deepEqual(rested.casters[1].prepared, ["Magic Missile", "Sleep"]);
});

test("the checklist knows spell levels and class lists", () => {
  assert.equal(spellLevelOf("fireball"), 3);
  assert.equal(spellLevelOf("Sacred Flame"), 0);
  assert.equal(spellLevelOf("Homebrew Bolt"), null);
  assert.equal(checklistClassSpell("cure wounds", "cleric", 1), "Cure Wounds");
  assert.equal(checklistClassSpell("Cure Wounds", "wizard", 9), null);
  assert.equal(checklistClassSpell("Spiritual Weapon", "cleric", 1), null);
});

console.log(`test-spell-prep: ${passed} tests passed.`);
