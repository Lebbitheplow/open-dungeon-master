// The rules every cast is asked (src/lib/dm/cast-rules.ts) and what a spell
// taught in play must be (src/lib/dm/learn-rules.ts). Pure, so each branch is
// walked here without a database; the tools that call them are held to the
// same rules end to end by scripts/test-enforce-casting*.mjs.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  canCastRituals,
  casterStateProblem,
  componentProblem,
  handsBusy,
  longCastingProblem,
  materialPlan,
  openCastOf,
  ritualProblem,
  slotPlan,
  spellHeldProblem,
  spellKeyOf,
  turnCharge,
  withOpenCast,
} = await import("../src/lib/dm/cast-rules.ts");
const { copyCost, learnProblem } = await import("../src/lib/dm/learn-rules.ts");
const { bundledSpellFacts } = await import("../src/lib/srd/spell-facts.ts");
const { freshBudget } = await import("../src/lib/dm/action-budget.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
  passed += 1;
}

const facts = (name) => {
  const found = bundledSpellFacts(name);
  assert.ok(found, `the bundled data knows ${name}`);
  return found;
};

const PROFS = { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] };

function caster(overrides = {}) {
  return {
    name: "Iris",
    class: "wizard",
    level: 5,
    subclass: "",
    classes: [],
    abilities: { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
    conditions: [],
    features: [],
    feats: [],
    equipment: [],
    proficiencies: PROFS,
    wildShape: null,
    gold: 0,
    copper: 0,
    ...overrides,
    spellcasting:
      overrides.spellcasting === null
        ? null
        : {
            ability: "int",
            slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
            known: [],
            prepared: ["Magic Missile", "Hold Person", "Fireball", "Healing Word"],
            cantrips: ["Fire Bolt"],
            spellbook: ["Magic Missile", "Hold Person", "Fireball", "Detect Magic"],
            pending: ["Fly"],
            ...(overrides.spellcasting ?? {}),
          },
  };
}

// ---- names ----

test("a name is compared whole, whatever its case or spacing", () => {
  assert.equal(spellKeyOf("  Hold  PERSON "), "hold person");
  assert.equal(spellKeyOf("Hunter's Mark"), spellKeyOf("hunters mark").replace("hunters", "hunter s"));
});

// ---- who holds the spell ----

test("a caster holds what they know, have prepared, or keep as a cantrip, by whole name", () => {
  const iris = caster();
  assert.equal(spellHeldProblem(iris, "Hold Person", facts("Hold Person")), null);
  assert.equal(spellHeldProblem(iris, "fire bolt", facts("Fire Bolt")), null);
  assert.ok(spellHeldProblem(iris, "Bolt", null), "part of a name is not the name");
  assert.ok(spellHeldProblem(iris, "Counterspell", facts("Counterspell")));
});

test("a spell waiting for the long rest, or only in the book, is not ready", () => {
  const iris = caster();
  assert.ok(spellHeldProblem(iris, "Fly", facts("Fly")));
  assert.ok(spellHeldProblem(iris, "Detect Magic", facts("Detect Magic")));
});

test("a wizard reads a ritual from the book without preparing it", () => {
  assert.equal(spellHeldProblem(caster(), "Detect Magic", facts("Detect Magic"), { ritual: true }), null);
});

test("a character with no Spellcasting holds nothing", () => {
  assert.ok(spellHeldProblem(caster({ spellcasting: null }), "Fire Bolt", facts("Fire Bolt")));
});

// ---- the caster's own state ----

test("raging, wild shaped, polymorphed and untrained armor each stop a cast", () => {
  assert.equal(casterStateProblem(caster()), null);
  assert.match(casterStateProblem(caster({ conditions: ["raging"] })), /raging/);
  const wolf = { form: "Wolf", beastHp: 11, beastMaxHp: 11, beastAc: 13, kind: "wildshape" };
  assert.match(casterStateProblem(caster({ wildShape: wolf })), /wild shaped/);
  assert.equal(
    casterStateProblem(caster({ wildShape: wolf, features: [{ name: "Beast Spells", level: 18 }] })),
    null,
    "Beast Spells lets a druid of 18th level cast in beast form",
  );
  assert.match(casterStateProblem(caster({ wildShape: { ...wolf, kind: "polymorph" } })), /polymorphed/);
  assert.match(
    casterStateProblem(caster({ equipment: [{ name: "Plate", qty: 1, equipped: true }] })),
    /not trained/,
  );
  assert.equal(
    casterStateProblem(
      caster({ equipment: [{ name: "Plate", qty: 1, equipped: true }], proficiencies: { ...PROFS, armor: ["heavy"] } }),
    ),
    null,
  );
});

// ---- components ----

test("no verbal spell without a voice; a spell with none is still cast", () => {
  const hushed = caster({ conditions: ["silenced"] });
  assert.match(componentProblem(hushed, facts("Magic Missile")), /verbal/);
  const somatic = { ...facts("Magic Missile"), verbal: false };
  assert.equal(componentProblem(hushed, somatic), null);
});

test("two busy hands refuse a somatic spell; War Caster or a holy symbol on a shield does not", () => {
  const armed = {
    equipment: [
      { name: "Longsword", qty: 1, equipped: true },
      { name: "Shield", qty: 1, equipped: true },
    ],
    proficiencies: { ...PROFS, armor: ["light", "medium", "heavy", "shield"], weapons: ["simple", "martial"] },
  };
  assert.equal(handsBusy(caster(armed)), 2);
  assert.match(componentProblem(caster(armed), facts("Magic Missile")), /free hand/);
  assert.equal(componentProblem(caster({ ...armed, feats: ["War Caster"] }), facts("Magic Missile")), null);
  const priest = caster({ ...armed, class: "cleric" });
  assert.equal(componentProblem(priest, facts("Hold Person")), null, "V, S, M: the emblem hand");
  assert.match(componentProblem(priest, facts("Magic Missile")), /free hand/, "V, S: no material, no emblem");
  assert.equal(handsBusy(caster({ equipment: [{ name: "Longsword", qty: 1 }] })), 0, "carried is not held");
});

// ---- materials ----

test("a costly material is carried, bought, or the spell is refused", () => {
  const revivify = facts("Revivify");
  assert.equal(revivify.materialCostGp, 300);
  assert.equal(revivify.materialConsumed, true);
  assert.ok("error" in materialPlan(caster(), revivify));
  const carried = materialPlan(caster({ equipment: [{ name: "Diamond (300 gp)", qty: 1 }] }), revivify);
  assert.deepEqual([carried.kind, carried.consume], ["item", true]);
  const bought = materialPlan(caster({ gold: 400 }), revivify);
  assert.deepEqual([bought.kind, bought.copper, bought.consume], ["purse", 30000, true]);
  assert.deepEqual(materialPlan(caster(), facts("Hold Person")), { kind: "none" });
});

// ---- slots ----

test("no level named is the spell's own level; below it or a slot not held is refused", () => {
  const iris = caster();
  const own = slotPlan(iris, "Hold Person", facts("Hold Person"), undefined);
  assert.deepEqual([own.kind, own.level, own.state.used], ["slot", 2, 1]);
  assert.ok("error" in slotPlan(iris, "Hold Person", facts("Hold Person"), 1));
  assert.ok("error" in slotPlan(iris, "Fireball", facts("Fireball"), 5));
  assert.equal(slotPlan(iris, "Fire Bolt", facts("Fire Bolt"), 3).kind, "none", "a cantrip spends nothing");
  const up = slotPlan(iris, "Magic Missile", facts("Magic Missile"), 3);
  assert.deepEqual([up.level, up.state.used], [3, 1]);
  const spent = caster({ spellcasting: { slots: { 2: { max: 3, used: 3 } } } });
  assert.ok("error" in slotPlan(spent, "Hold Person", facts("Hold Person"), 2));
});

// ---- rituals and long castings ----

test("a ritual is a named, ritual-tagged spell, cast by a class with Ritual Casting, out of a fight", () => {
  const iris = caster();
  assert.equal(canCastRituals(iris), true);
  assert.equal(canCastRituals(caster({ class: "sorcerer" })), false);
  assert.equal(canCastRituals(caster({ class: "sorcerer", feats: ["Ritual Caster"] })), true);
  assert.ok(ritualProblem(iris, "", null, false));
  assert.match(ritualProblem(iris, "Fireball", facts("Fireball"), false), /no ritual tag/);
  assert.match(ritualProblem(caster({ class: "sorcerer" }), "Detect Magic", facts("Detect Magic"), false), /does not cast rituals/);
  assert.match(ritualProblem(iris, "Detect Magic", facts("Detect Magic"), true), /fight/);
  assert.equal(ritualProblem(iris, "Detect Magic", facts("Detect Magic"), false), null);
});

test("a spell of a minute or longer is not cast in a fight", () => {
  assert.ok(longCastingProblem(facts("Identify"), true));
  assert.equal(longCastingProblem(facts("Identify"), false), null);
  assert.equal(longCastingProblem(facts("Fireball"), true), null);
});

// ---- the turn ----

const turn = (spell, budget, extra = {}) =>
  turnCharge({ who: "Iris", facts: facts(spell), spell, slotLevel: null, inFight: true, budget, reactionSpent: false, ...extra });

test("an action spell spends the action, and a second one is refused", () => {
  const first = turn("Hold Person", freshBudget({ ownerId: "pc", round: 1 }));
  assert.equal(first.kind, "budget");
  assert.equal(first.budget.actionUsed, true);
  assert.ok("error" in turn("Fireball", first.budget));
});

test("after a bonus action spell only a cantrip with the action, and the other way round", () => {
  const quick = turn("Healing Word", freshBudget({ ownerId: "pc", round: 1 }));
  assert.equal(quick.cost, "bonus action");
  assert.ok("error" in turn("Hold Person", quick.budget), "a levelled spell after a bonus action spell");
  assert.equal(turn("Fire Bolt", quick.budget).kind, "budget", "a cantrip with the action");
  const levelled = turn("Hold Person", freshBudget({ ownerId: "pc", round: 1 }));
  assert.ok("error" in turn("Healing Word", levelled.budget), "a bonus action spell after a levelled one");
});

test("out of a fight the turn is not charged; a spent reaction refuses a reaction spell", () => {
  assert.equal(turn("Hold Person", null, { inFight: false }).kind, "free");
  assert.ok("error" in turn("Shield", null, { reactionSpent: true }));
});

test("an open casting counts its shares down and closes at none", () => {
  const budget = withOpenCast(freshBudget({ ownerId: "pc", round: 1 }), { spell: "Eldritch Blast", slotLevel: null, left: 1 });
  assert.deepEqual(openCastOf(budget, "eldritch blast"), { spell: "eldritch blast", slotLevel: null, left: 1 });
  const closed = withOpenCast(budget, { spell: "Eldritch Blast", slotLevel: null, left: 0 });
  assert.equal(openCastOf(closed, "Eldritch Blast"), null);
});

// ---- learning ----

test("a spell taught in play is the class's, of a castable level, with room for a cantrip", () => {
  const novice = caster({
    level: 1,
    spellcasting: { slots: { 1: { max: 2, used: 0 } }, cantrips: ["Fire Bolt", "Light", "Mage Hand"] },
  });
  assert.match(learnProblem(novice, "Wish", facts("Wish")), /level 9/);
  assert.match(learnProblem(novice, "Cure Wounds", facts("Cure Wounds")), /not on the wizard spell list/);
  assert.match(learnProblem(novice, "Ray of Frost", facts("Ray of Frost")), /cantrips/);
  assert.equal(learnProblem(novice, "Shield", facts("Shield")), null);
  assert.ok(learnProblem(novice, "Nothing Real", null));
});

test("copying a spell costs 50 gp and two hours a level", () => {
  assert.deepEqual(copyCost(facts("Fly")), { gold: 150, hours: 6 });
});

console.log(`test-cast-rules: ${passed} passed`);
