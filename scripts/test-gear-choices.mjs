// A background's kit lines that leave a choice to the player (issue #127):
// a "tool of your choice" line filled from the character's training, an
// either-or line answered by the pick the sheet records, and anything else
// left as written (src/lib/srd/gear-choices.ts).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { expandBackgroundGear, gearAlternatives, isToolChoiceLine } = await import("../src/lib/srd/gear-choices.ts");
const { resolveBackgroundGear } = await import("../src/lib/srd/adventuring-gear.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const labels = (line) => gearAlternatives(line)?.map((entry) => entry.label) ?? null;
const items = (line, at) => gearAlternatives(line)?.[at].items.map((item) => `${item.name} x${item.qty}`) ?? null;

test("an either-or line of catalog items is a pick, the book's words kept", () => {
  assert.deepEqual(labels("A dagger, quarterstaff, or spear"), ["Dagger", "Quarterstaff", "Spear"]);
  assert.deepEqual(items("A dagger, quarterstaff, or spear", 2), ["Spear x1"]);
  assert.deepEqual(labels("A dagger or light hammer"), ["Dagger", "Light hammer"]);
  assert.deepEqual(labels("A set of either brewer's supplies or cook's utensils"), ["Brewer's supplies", "Cook's utensils"]);
  assert.deepEqual(items("A set of either brewer's supplies or cook's utensils", 1), ["Cook's Utensils x1"]);
  assert.deepEqual(labels("A dagger, quarterstaff, or shortsword (if proficient)"), ["Dagger", "Quarterstaff", "Shortsword"]);
  assert.deepEqual(labels("A club, handaxe, or spear"), ["Club", "Handaxe", "Spear"]);
});

test("a choice inside brackets, and a 'with' that rides on every alternative", () => {
  assert.deepEqual(labels("Hunting gear (a shortbow with 20 arrows, or a hunting trap)"), ["Shortbow with 20 arrows", "Hunting trap"]);
  assert.deepEqual(items("Hunting gear (a shortbow with 20 arrows, or a hunting trap)", 0), ["Shortbow x1", "Arrows x20"]);
  assert.deepEqual(items("Hunting gear (a shortbow with 20 arrows, or a hunting trap)", 1), ["Hunting Trap x1"]);
});

test("a line the catalog cannot fill on every side stays as written", () => {
  // No donkey, mule or bridle in the SRD gear table; the line is kept whole.
  assert.equal(labels("A donkey or mule with bit and bridle"), null);
  assert.equal(labels("A set of cold-weather or warm-weather clothes"), null);
  // A bracketed detail of one item is not a choice.
  assert.equal(labels("Holy symbol (amulet or reliquary)"), null);
  assert.equal(labels("A memento of your destiny"), null);
});

test("a 'tool of your choice' line is the tool grant's, not an either-or", () => {
  for (const line of [
    "A set of artisan's tools of your choice",
    "A set of tools to match your choice of tool proficiency",
    "A musical instrument of your choice",
    "A gaming set of your choice",
    "A set of artisan's tools or a musical instrument (one of your choice)",
    "A set of dice or deck of cards",
    "One musical instrument of your choice",
  ]) {
    assert.equal(isToolChoiceLine(line), true, line);
    assert.equal(labels(line), null, line);
  }
  assert.equal(isToolChoiceLine("A dagger or light hammer"), false);
});

test("a tool line is filled from the character's training, the background's own pick first, never twice", () => {
  const courtServant = resolveBackgroundGear([
    "A set of artisan's tools of your choice", "a unique piece of jewelry", "a set of fine clothes", "a handcrafted pipe",
  ]);
  const kit = expandBackgroundGear(courtServant, {
    tools: ["thieves' tools", "calligrapher's supplies"],
    backgroundTools: ["one artisan's tools of your choice"],
    picks: [],
  });
  assert.deepEqual(kit.toolLines, [{ line: "A set of artisan's tools of your choice", item: "Calligrapher's Supplies" }]);
  assert.ok(kit.names.includes("Calligrapher's Supplies"));
  assert.ok(!kit.names.includes("A set of artisan's tools of your choice"));
  assert.deepEqual(kit.choices, []);
  // Not picked yet: the line waits, as written, and says so.
  const owed = expandBackgroundGear(courtServant, { tools: ["thieves' tools"], backgroundTools: ["one artisan's tools of your choice"], picks: [] });
  assert.deepEqual(owed.toolLines, [{ line: "A set of artisan's tools of your choice", item: null }]);
  assert.ok(owed.names.includes("A set of artisan's tools of your choice"));
  // "To match your choice of tool proficiency": the background's named list.
  const syndicate = expandBackgroundGear(["A set of tools to match your choice of tool proficiency"], {
    tools: ["thieves' tools", "forgery kit"],
    backgroundTools: ["Your choice of one from Thieves' Tools, Forgery Kit, or Disguise Kit"],
    picks: [],
  });
  assert.deepEqual(syndicate.names, ["Thieves' Tools"]);
  // A bard with three instruments and a minstrel's line: one instrument, once.
  const minstrel = expandBackgroundGear(["One musical instrument of your choice", "A musical instrument of your choice"], {
    tools: ["lute", "drum"], backgroundTools: ["one musical instrument of your choice"], picks: [],
  });
  assert.deepEqual(minstrel.names, ["Lute", "Drum"]);
  // A gaming set: the dice set the character is trained with.
  const sentry = expandBackgroundGear(["A set of dice or deck of cards", "A set of common clothes"], {
    tools: ["playing card set"], backgroundTools: ["one gaming set"], picks: [],
  });
  assert.deepEqual(sentry.names, ["Playing Card Set", "A set of common clothes"]);
});

test("an either-or line takes the sheet's pick, the book's first until then, and refuses a pick it does not offer", () => {
  const innkeeper = ["A set of either brewer's supplies or cook's utensils", "A dagger or light hammer", "Clothes, Traveler's"];
  const unanswered = expandBackgroundGear(innkeeper, { tools: [], backgroundTools: [], picks: [] });
  assert.deepEqual(unanswered.names, ["Brewer's Supplies", "Dagger", "Clothes, Traveler's"]);
  assert.deepEqual(unanswered.choices.map((choice) => choice.chosen), [0, 0]);
  const answered = expandBackgroundGear(innkeeper, { tools: [], backgroundTools: [], picks: ["Cook's utensils", "Light hammer"] });
  assert.deepEqual(answered.names, ["Cook's Utensils", "Light Hammer", "Clothes, Traveler's"]);
  assert.deepEqual(answered.choices.map((choice) => choice.chosen), [1, 1]);
  assert.deepEqual(answered.problems, []);
  const wrong = expandBackgroundGear(innkeeper, { tools: [], backgroundTools: [], picks: ["Greatsword"] });
  assert.deepEqual(wrong.names.slice(0, 2), ["Brewer's Supplies", "Dagger"]);
  assert.equal(wrong.problems.length, 1);
  assert.match(wrong.problems[0], /brewer's supplies or cook's utensils/);
});

test("a purse line and a plain line pass through untouched", () => {
  const kit = expandBackgroundGear(["Clothes, Common", "15 gp", "A letter of introduction"], { tools: [], backgroundTools: [], picks: [] });
  assert.deepEqual(kit.names, ["Clothes, Common", "15 gp", "A letter of introduction"]);
  assert.deepEqual(kit.choices, []);
  assert.deepEqual(kit.toolLines, []);
});

console.log(`\ntest-gear-choices: ${passed} tests passed.`);
