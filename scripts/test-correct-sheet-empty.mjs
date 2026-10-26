// Correct a sheet, left empty as its hint says (table function audit
// 2026-10-26, T09). The DM picks Conditions and leaves Becomes empty: the
// console's own form sends the empty box, the facade keeps it because the
// catalog says an empty Becomes is an answer, and the conditions clear.
// Nothing else learns to read an empty box as an answer: an empty name or
// number is asked for again, a value left out is no answer from anyone, a
// required field elsewhere is still missing, the AI may not clear
// conditions through update_sheet at all, and Clear a condition still lifts
// only the one.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-correct-sheet-empty");
const { ADJUDICATIONS, adjudication } = await import("../src/lib/dm/invoke-catalog.ts");
const { invokeEngine, normalizeArgs } = await import("../src/lib/dm/invoke.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { argsFor, initialValue } = await import("../src/app/campaigns/[campaignId]/DmActionFields.tsx");

const world = await openWorld({ gameSettings: { dmMode: "human" } });
const hero = world.addHero({ user: world.addUser(), name: "Ilse Marr", class: "fighter", level: 3 });
const correct = adjudication("update_sheet");

// The form as the DM leaves it: every input as it starts, then what they
// picked. Becomes is never touched.
function form(entry, picked) {
  const start = Object.fromEntries(entry.fields.map((field) => [field.name, initialValue(field)]));
  return argsFor(entry.fields, { ...start, ...picked });
}

// The console's own request, through the dm/invoke route as the DM.
async function run(name, args) {
  world.signIn(world.owner);
  const handler = await world.route("campaigns/[campaignId]/dm/invoke");
  const response = await handler.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, args }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

const afflict = () => world.patch(hero.id, { conditions: ["poisoned", "prone"] });

await test("Conditions with Becomes left empty clears them, from the console's own form", async () => {
  afflict();
  const args = form(correct, { characterId: hero.id, field: "conditions" });
  assert.equal(args.value, "", "the form sends the empty box");
  const out = await run("update_sheet", args);
  assert.equal(out.status, 200, out.body.error);
  assert.deepEqual(world.sheet(hero.id).conditions, []);
});

await test("A name, a text or a number left empty is asked for again, and the sheet keeps it", async () => {
  world.patch(hero.id, { alignment: "LG" });
  for (const [field, label] of [["alignment", "alignment"], ["name", "name"], ["level", "level"], ["str", "strength"]]) {
    for (const value of ["", "   "]) {
      const out = await run("update_sheet", form(correct, { characterId: hero.id, field, value }));
      assert.equal(out.status, 409, `${field} "${value}"`);
      assert.equal(out.body.error, `Say what ${label} becomes.`);
    }
  }
  assert.equal(world.sheet(hero.id).alignment, "LG");
  assert.equal(world.sheet(hero.id).name, "Ilse Marr");
});

await test("A value left out is no answer: Conditions named alone is asked for, never cleared", async () => {
  afflict();
  const out = await run("update_sheet", { characterId: hero.id, field: "conditions", reason: "no value" });
  assert.equal(out.status, 409);
  assert.equal(out.body.error, "Say what conditions becomes.");
  assert.deepEqual(world.sheet(hero.id).conditions, ["poisoned", "prone"]);
});

await test("The AI may not clear conditions through update_sheet, empty answer or not", async () => {
  afflict();
  const turn = createDmTurn(world.campaignId, [], "ai");
  for (const args of [{ field: "conditions", value: "" }, { conditions: [] }]) {
    const out = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "update_sheet", args: { characterId: hero.id, reason: "a wish", ...args } });
    assert.equal(out.ok, false, JSON.stringify(args));
    assert.match(out.error, /cannot set conditions/);
  }
  assert.deepEqual(world.sheet(hero.id).conditions, ["poisoned", "prone"]);
});

await test("Only update_sheet's Becomes keeps an empty box, never on a required field, and every other blank still goes", () => {
  const keeping = ADJUDICATIONS.flatMap((entry) => entry.fields.filter((field) => field.keepsEmpty).map((field) => `${entry.name}.${field.name}`));
  assert.deepEqual(keeping, ["update_sheet.value"]);
  for (const entry of ADJUDICATIONS) {
    for (const field of entry.fields.filter((one) => one.keepsEmpty)) {
      assert.notEqual(field.required, true, `${entry.name}.${field.name}`);
    }
  }
  const kept = normalizeArgs(correct, { characterId: hero.id, field: "conditions", value: "", reason: "" });
  assert.equal(kept.value, "");
  assert.equal("reason" in kept, false);
});

await test("A required text field elsewhere is still reported missing when left empty", async () => {
  const out = await run("learn_spell", form(adjudication("learn_spell"), { characterId: hero.id, action: "add" }));
  assert.equal(out.status, 409);
  assert.equal(out.body.error, "Learn a spell needs spell.");
});

await test("Clear a condition still lifts only the one it names", async () => {
  afflict();
  const out = await run("clear_condition", form(adjudication("clear_condition"), { characterId: hero.id, condition: "poisoned" }));
  assert.equal(out.status, 200, out.body.error);
  assert.deepEqual(world.sheet(hero.id).conditions, ["prone"]);
});

await finish();
