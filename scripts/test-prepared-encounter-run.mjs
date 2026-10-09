// The storyteller running a prepared fight by name, through the same
// dispatch its turn loop uses (#154). The roster, the plan and the cue are
// read back from the engine's own rows: the enemies that were made, the
// override that renamed one and set its hit points, the DM note that holds
// what the fight is worth.

import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-prepared-encounter-run");
const { dispatchAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { listSheets } = await import("../src/lib/db/sheets.ts");
const { getEncounterTemplate, insertEncounterTemplate, setTemplateCued } = await import(
  "../src/lib/db/encounter-templates.ts"
);
const { listDmPrepNotes } = await import("../src/lib/db/notes.ts");
const { preparedFightsBlock } = await import("../src/lib/dm/prepared-encounter-tool.ts");

const world = await openWorld({ gameSettings: { dmMode: "ai" } });
world.addHero({ class: "fighter", level: 3, name: "Sword" });
world.addHero({ class: "cleric", level: 3, name: "Shield" });
const template = insertEncounterTemplate({
  campaignId: world.campaignId,
  name: "Goblins at the ford",
  enemies: [{ monster: "goblin", count: 2 }],
  battlefield: "a shallow ford between reeds",
  map: { mapId: null, seed: null, theme: null, ambient: null, width: null, height: null },
  notes: "They want the toll, not a fight.",
  extras: { rewards: "12 sp and a fishing net", phases: ["When one falls, the other flees."], overrides: [{ slot: 0, name: "Snik", hp: 3 }] },
  createdByUserId: world.owner.id,
});
setTemplateCued(template.id, true);

const run = (args) => {
  const sheets = listSheets(world.campaignId);
  return dispatchAdjudication("run_prepared_encounter", JSON.stringify(args), {
    campaign: world.campaign(),
    turn: createDmTurn(world.campaignId, [], "ai"),
    sheets,
    sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])),
    realDiceUserIds: new Set(),
  });
};

await test("the cued fight heads the storyteller's list", async () => {
  assert.match(preparedFightsBlock(world.campaign()), /\[CUED by the party lead[^\n]*Goblins at the ford: goblin x2/);
});

const result = await run({ name: "Goblins at the ford" });

await test("running it by name starts that roster, not one the model invents", async () => {
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(result.prepared, "Goblins at the ford");
  const enemies = world.enemies();
  assert.equal(enemies.length, 2);
  assert.ok(enemies.every((enemy) => /goblin/i.test(enemy.slug)));
});

await test("the plan lands on the fight: the override, and what it is worth", async () => {
  const snik = world.enemies().find((enemy) => enemy.displayName === "Snik");
  assert.ok(snik, `names: ${world.enemies().map((enemy) => enemy.displayName)}`);
  assert.equal(snik.maxHp, 3);
  assert.deepEqual(result.plan, ["Worth: 12 sp and a fishing net", "Phase 1: When one falls, the other flees."]);
  assert.ok(listDmPrepNotes(world.campaignId).some((note) => /Worth: 12 sp/.test(note.body)));
});

await test("running it takes the cue down, and a second fight is refused while this one is on", async () => {
  assert.equal(getEncounterTemplate(template.id).cued, false);
  assert.equal(preparedFightsBlock(world.campaign()), "", "the list should wait while a fight is on");
  const again = await run({ name: "Goblins at the ford" });
  assert.match(again.error, /already active/);
});

finish();
