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
  focusProblem,
  materialComponents,
  handsBusy,
  longCastingProblem,
  materialPlan,
  openCastOf,
  QUICKENED,
  reactionSpellOnOwnTurn,
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
const { spellSupportFor, spellSupportLine } = await import("../src/lib/srd/spell-support.ts");

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
  assert.equal(carried.kind, "components");
  assert.deepEqual(carried.uses.map((use) => [use.itemName, use.take, use.consume]), [["Diamond (300 gp)", 1, true]]);
  // Pieces make the worth: three 100 gp diamonds.
  const pieces = materialPlan(caster({ equipment: [{ name: "Diamond (100 gp)", qty: 5 }] }), revivify);
  assert.deepEqual(pieces.uses.map((use) => use.take), [3]);
  // A name alone proves no worth.
  assert.ok("error" in materialPlan(caster({ equipment: [{ name: "Diamond", qty: 1 }] }), revivify, { inFight: true }));
  // Bought from the purse out of a fight; never in one.
  const bought = materialPlan(caster({ gold: 400 }), revivify);
  assert.deepEqual(bought.bought.map((buy) => [buy.copper, buy.consume]), [[30000, true]]);
  assert.match(materialPlan(caster({ gold: 400 }), revivify, { inFight: true }).error, /middle of a fight/);
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

// F11 (docs/dnd-rules-audit-2026-10-09-extent.md): a ritual is cast through
// the class that holds it, and only a ritual caster's hold counts.
test("a ritual is cast only through a ritual caster's own spells, or the ritual book", () => {
  const multi = (casters, extra = {}) =>
    caster({
      class: casters[0].classId,
      classes: casters.map((entry) => ({ id: entry.classId, level: 3, subclass: "" })),
      ...extra,
      spellcasting: {
        known: casters.flatMap((entry) => entry.known ?? []),
        prepared: casters.flatMap((entry) => entry.prepared ?? []),
        spellbook: casters.flatMap((entry) => entry.spellbook ?? []),
        cantrips: [],
        pending: [],
        casters: casters.map((entry) => ({ ability: "int", known: [], prepared: [], cantrips: [], ...entry })),
        ...(extra.spellcasting ?? {}),
      },
    });
  const detect = facts("Detect Magic");
  // A sorcerer-wizard whose sorcerer knows Detect Magic and whose book does not hold it.
  const sorcWiz = multi([{ classId: "sorcerer", known: ["Detect Magic"] }, { classId: "wizard", spellbook: ["Alarm"], prepared: [] }]);
  assert.match(spellHeldProblem(sorcWiz, "Detect Magic", detect, { ritual: true }), /as a sorcerer spell/);
  assert.equal(spellHeldProblem(sorcWiz, "Detect Magic", detect), null, "from a slot it is cast as ever");
  // The same spell written in the wizard's book is a ritual.
  const inBook = multi([{ classId: "sorcerer", known: ["Detect Magic"] }, { classId: "wizard", spellbook: ["Detect Magic"], prepared: [] }]);
  assert.equal(spellHeldProblem(inBook, "Detect Magic", detect, { ritual: true }), null);
  // A cleric's prepared ritual is castable; a paladin's is not.
  assert.equal(spellHeldProblem(multi([{ classId: "cleric", prepared: ["Detect Magic"] }]), "Detect Magic", detect, { ritual: true }), null);
  assert.match(spellHeldProblem(multi([{ classId: "paladin", prepared: ["Detect Magic"] }]), "Detect Magic", detect, { ritual: true }), /paladin/);
  // Ritual Caster's book holds rituals for any class; the known list does not.
  const book = multi([{ classId: "sorcerer", known: [] }], { feats: ["Ritual Caster"], spellcasting: { spellbook: ["Detect Magic"] } });
  assert.equal(spellHeldProblem(book, "Detect Magic", detect, { ritual: true }), null);
  const unwritten = multi([{ classId: "sorcerer", known: [] }], { feats: ["Ritual Caster"], spellcasting: { spellbook: [] } });
  assert.match(spellHeldProblem(unwritten, "Detect Magic", detect, { ritual: true }), /not written in/);
  // A warlock with Book of Ancient Secrets: the book, not the warlock's list.
  const patron = { features: [{ name: "Invocation: Book of Ancient Secrets", source: "class", description: "" }] };
  assert.match(spellHeldProblem(multi([{ classId: "warlock", known: ["Detect Magic"] }], patron), "Detect Magic", detect, { ritual: true }), /warlock/);
  assert.equal(spellHeldProblem(multi([{ classId: "warlock", known: [] }], { ...patron, spellcasting: { spellbook: ["Detect Magic"] } }), "Detect Magic", detect, { ritual: true }), null);
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

// F12: the bonus action spell rule is on the turn, whatever the spell is
// cast with, and Quickened Spell moves a one-action spell to the bonus action.
test("a reaction spell on one's own turn is the turn's other spell", () => {
  const quick = turn("Healing Word", freshBudget({ ownerId: "pc", round: 1 }));
  assert.match(turn("Shield", quick.budget).error ?? "", /bonus action/, "Shield after a bonus action spell, on one's own turn");
  const shield = turn("Shield", freshBudget({ ownerId: "pc", round: 1 }));
  assert.equal(shield.kind, "reaction");
  assert.ok(shield.budget, "the own turn is marked");
  assert.ok("error" in turn("Healing Word", shield.budget), "no bonus action spell after a reaction spell on the same turn");
  assert.equal(turn("Fire Bolt", shield.budget).kind, "budget", "an action spell is still free to cast");
  assert.deepEqual(reactionSpellOnOwnTurn(null, "Iris", "Shield"), { budget: null }, "on another's turn the rule does not reach");
});

test("Quickened Spell charges a one-action spell to the bonus action, once", () => {
  const paid = { ...freshBudget({ ownerId: "pc", round: 1 }), oncePerTurn: [QUICKENED] };
  const fireball = turn("Fireball", paid);
  assert.equal(fireball.cost, "bonus action");
  assert.equal(fireball.budget.actionUsed, false, "the action is still there");
  assert.ok(!fireball.budget.oncePerTurn.includes(QUICKENED), "the quickening is spent");
  assert.match(fireball.note, /Quickened Spell/);
  assert.equal(turn("Fire Bolt", fireball.budget).kind, "budget", "a cantrip with the action beside it");
  assert.ok("error" in turn("Hold Person", fireball.budget), "no levelled spell beside it");
  // A quickened cantrip leaves the action for another cantrip only.
  const bolt = turn("Fire Bolt", paid);
  assert.equal(bolt.cost, "bonus action");
  assert.ok("error" in turn("Magic Missile", bolt.budget));
});

// F27/F29: what the server leaves to the DM is named.
test("a spell settled only in part names the parts that are the DM's", () => {
  assert.equal(spellSupportFor("Teleport").kind, "partial");
  assert.equal(spellSupportFor("Time Stop").kind, "narrated");
  assert.equal(spellSupportFor("Fireball"), null);
  assert.match(spellSupportLine("Geas"), /5d10 psychic/);
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

test("the nine materials a single price cannot hold are kept as printed", () => {
  const sum = (name, units = 1) => materialComponents({ ...facts(name), material: true }).reduce((total, part) => total + part.gp * part.count * (part.per ? units : 1), 0);
  assert.equal(sum("Clone"), 3000);
  assert.deepEqual(materialComponents({ ...facts("Clone"), material: true }).map((part) => part.consumed), [true, false], "the diamond is consumed, the vessel kept");
  assert.equal(sum("Astral Projection", 3), 3300, "1,100 gp for each of three creatures");
  assert.equal(sum("Create Undead", 4), 600, "150 gp a corpse");
  assert.equal(sum("Imprisonment", 10), 5000, "500 gp a Hit Die");
  assert.equal(sum("Legend Lore"), 450, "250 gp of incense and four 50 gp ivory strips");
  assert.equal(sum("Magnificent Mansion"), 15, "three items of 5 gp");
  assert.equal(sum("Warding Bond"), 100, "two rings of 50 gp");
  assert.equal(sum("Secret Chest"), 5050);
  assert.equal(sum("Simulacrum"), 1500);
  // Two rings, each worth 50: one 100 gp ring is not a pair.
  const bond = { ...facts("Warding Bond"), material: true };
  assert.ok("error" in materialPlan(caster({ equipment: [{ name: "Platinum ring (100 gp)", qty: 1 }] }), bond, { inFight: true }));
  const pair = materialPlan(caster({ equipment: [{ name: "Platinum ring (50 gp)", qty: 2 }] }), bond, { inFight: true });
  assert.deepEqual(pair.uses.map((use) => use.take), [2]);
  // Imprisonment counts the target's Hit Dice.
  const prison = { ...facts("Imprisonment"), material: true };
  assert.match(materialPlan(caster({ gold: 100000 }), prison).error, /Hit Die/);
  assert.equal(materialPlan(caster({ gold: 100000 }), prison, { units: 10 }).bought[0].copper, 500000);
});

test("a material with no price needs a component pouch or the class's focus", () => {
  const fireball = facts("Fireball");
  assert.match(focusProblem(caster(), fireball), /component pouch or an arcane focus/);
  assert.equal(focusProblem(caster({ equipment: [{ name: "Component pouch", qty: 1 }] }), fireball), null);
  assert.equal(focusProblem(caster({ equipment: [{ name: "Crystal", qty: 1 }] }), fireball), null);
  // A holy symbol is a cleric's focus, not a wizard's.
  assert.ok(focusProblem(caster({ equipment: [{ name: "Holy symbol", qty: 1 }] }), fireball));
  assert.equal(focusProblem(caster(), facts("Magic Missile")), null, "no material, nothing to hold");
});

test("War Caster frees the gestures with both hands full, never the material", () => {
  const full = { equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Shield", qty: 1, equipped: true }], feats: ["War Caster"] };
  assert.equal(componentProblem(caster(full), facts("Shocking Grasp") ?? facts("Magic Missile")), null);
  assert.match(componentProblem(caster(full), facts("Fireball")), /War Caster frees the gestures, not the material/);
});

console.log(`test-cast-rules: ${passed} passed`);
