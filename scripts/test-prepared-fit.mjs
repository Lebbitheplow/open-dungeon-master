// A prepared fight held to the table's rails, and run for the party in front
// of it (issue 520). The eight-combatant cap and the difficulty ceiling are
// the table's rules, which start_encounter holds a person's own fights to as
// well; what a prepared fight could not do was meet them once the party it
// was written for was not the one at the table. Every check reads the
// engine's own rows: the enemies made, the cue, the readout, the refusal.
//
// The numbers, from the DMG's encounter table as src/lib/srd/encounter-math.ts
// carries it: a 2nd-level character's deadly threshold is 200 XP, a goblin
// is worth 50 and a bugbear 200, an ogre 450, and a party of fewer than
// three reads every group a step deadlier. A normal table's ceiling is a
// quarter past the party's deadly threshold.

import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-prepared-fit");
const { dispatchAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { listSheets, patchSheet } = await import("../src/lib/db/sheets.ts");
const { getEncounterTemplate, insertEncounterTemplate, listEncounterTemplates, setTemplateCued } = await import("../src/lib/db/encounter-templates.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { readyTemplates } = await import("../src/lib/dm/prepared-encounter-tool.ts");
const { templateDifficulty } = await import("../src/lib/dm/encounter-templates.ts");
const { scaleRoster } = await import("../src/lib/dm/encounter-template-logic.ts");
const { importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { workshopBundleSchema } = await import("../src/lib/workshop/bundle-schema.ts");
const { listRollTables } = await import("../src/lib/db/roll-tables.ts");
const { normalizeRollEntries } = await import("../src/lib/dm/roll-table-logic.ts");

// Two 2nd-level heroes at an AI table: deadly 400, ceiling 500.
async function table(options = {}) {
  const world = await openWorld({ gameSettings: { dmMode: "ai", ...(options.gameSettings ?? {}) } });
  const heroes = (options.heroes ?? [{}, {}]).map((hero, index) => world.addHero({ class: "fighter", level: 2, name: `Hero ${index + 1}`, ...hero }));
  return { world, heroes };
}

function prepare(world, name, enemies, cued = true) {
  const template = insertEncounterTemplate({
    campaignId: world.campaignId,
    name,
    enemies,
    battlefield: "",
    map: { mapId: null, scene: null, seed: null, theme: null, ambient: null, width: null, height: null },
    notes: "",
    extras: {},
    createdByUserId: world.owner.id,
  });
  if (cued) {
    setTemplateCued(template.id, true);
  }
  return template;
}

const turnOf = (world) => createDmTurn(world.campaignId, [], "ai");
function call(world, name, args) {
  const sheets = listSheets(world.campaignId);
  return dispatchAdjudication(name, JSON.stringify(args), {
    campaign: world.campaign(),
    turn: turnOf(world),
    sheets,
    sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])),
    realDiceUserIds: new Set(),
  });
}
const counted = (world) => {
  const out = {};
  for (const enemy of world.enemies()) {
    const kind = enemy.slug.replace(/-.*$/, "");
    out[kind] = (out[kind] ?? 0) + 1;
  }
  return out;
};

await test("A prepared fight beyond the party runs cut down to fit, keeping its strongest creature, and says what it left out.", async () => {
  const { world } = await table();
  const fight = prepare(world, "Warren mouth", [{ monster: "bugbear", count: 1 }, { monster: "goblin", count: 4 }]);
  // As written: 400 XP of five creatures, read as x2.5 for two heroes, 1000
  // against a 500 ceiling. The bugbear and one goblin are 250 at x2: 500.
  const readout = templateDifficulty(world.campaign(), fight.enemies);
  assert.equal(readout.tooDeadly, true);
  assert.equal(readout.scaledWithout, "Goblin x3", "by the name the fight shows");
  const out = await call(world, "run_prepared_encounter", { name: "Warren mouth" });
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.deepEqual(counted(world), { bugbear: 1, goblin: 1 });
  assert.match(out.scaled, /without Goblin x3/);
  assert.equal(getEncounterTemplate(fight.id).cued, false);
  // The stored fight is the author's still.
  assert.deepEqual(getEncounterTemplate(fight.id).enemies, [{ monster: "bugbear", count: 1 }, { monster: "goblin", count: 4 }]);
  world.close();
});

await test("A prepared fight whose strongest creature alone is beyond the party is held, its cue taken down, and nothing starts.", async () => {
  const { world } = await table();
  const fight = prepare(world, "The ogre's bridge", [{ monster: "ogre", count: 1 }, { monster: "goblin", count: 2 }]);
  // An ogre alone is 450 at x2 for two heroes: 900 against 500.
  const readout = templateDifficulty(world.campaign(), fight.enemies);
  assert.equal(readout.held, true);
  const out = await call(world, "run_prepared_encounter", { name: "The ogre's bridge" });
  assert.equal(out.retry, true);
  assert.match(out.error, /beyond the party as it stands, even cut down to its strongest creature/);
  assert.doesNotMatch(out.error, /fewer or weaker enemies/, "run_prepared_encounter takes no roster");
  assert.equal(world.encounter(), null);
  assert.equal(getEncounterTemplate(fight.id).cued, false, "a held fight left cued is refused every turn");
  world.close();
});

await test("A roster written past eight creatures runs as eight or fewer.", async () => {
  const { world } = await table({ heroes: [{ level: 10 }, { level: 10 }, { level: 10 }, { level: 10 }] });
  // A bundle stores what it was given; the editor would have refused ten.
  const fight = prepare(world, "Rat tide", [{ monster: "giant-rat", count: 10 }]);
  const out = await call(world, "run_prepared_encounter", { name: "Rat tide" });
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.equal(world.enemies().length, 8);
  assert.match(out.scaled, /without giant-rat x2|without Giant Rat x2/i);
  assert.equal(getEncounterTemplate(fight.id).cued, false);
  world.close();
});

await test("A roster a bundle wrote as lines or bare names counts, is offered to the storyteller, and runs.", async () => {
  const { world } = await table();
  const fight = prepare(world, "Reed ambush", []);
  getDatabase().prepare(`UPDATE encounter_templates SET enemies_json = ? WHERE id = ?`).run(JSON.stringify(["goblin x2", "wolf"]), fight.id);
  assert.deepEqual(getEncounterTemplate(fight.id).enemies, [{ monster: "goblin", count: 2 }, { monster: "wolf", count: 1 }]);
  assert.ok(readyTemplates(world.campaignId).some((entry) => entry.id === fight.id), "the storyteller never saw it");
  const out = await call(world, "run_prepared_encounter", { name: "Reed ambush" });
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.deepEqual(counted(world), { goblin: 2, wolf: 1 });
  world.close();
});

await test("A workshop bundle's fight and table land as the editor would have saved them.", async () => {
  const { world } = await table();
  const bundle = workshopBundleSchema.parse({
    kind: "odm.workshop",
    version: 1,
    manifest: { name: "Hand-written", blurb: "Written by hand", inspiredBy: "Nothing" },
    encounters: [{ name: "Ford", enemies: ["goblin x3", { monster: "wolf", count: 0 }, "  "] }],
    tables: [{ name: "Rumours", entries: ["The mill burned", { text: "A stranger asks after you" }, { min: 5, max: 6, text: "Nothing" }] }],
  });
  const landed = importWorkshopBundle(world.owner.id, bundle);
  assert.ok(!("error" in landed), landed.error);
  const [ford] = listEncounterTemplates(landed.workshopId);
  assert.deepEqual(ford.enemies, [{ monster: "goblin", count: 3 }, { monster: "wolf", count: 1 }]);
  const stored = JSON.parse(getDatabase().prepare(`SELECT enemies_json FROM encounter_templates WHERE id = ?`).get(ford.id).enemies_json);
  assert.deepEqual(stored, ford.enemies, "the stored row was the bundle's raw list");
  const [rumours] = listRollTables(landed.workshopId);
  assert.deepEqual(
    rumours.entries.map((entry) => [entry.min, entry.max, entry.text]),
    [[1, 1, "The mill burned"], [2, 2, "A stranger asks after you"], [5, 6, "Nothing"]],
  );
  world.close();
});

await test("A roll table row stored with no range is read with one, so no die rolls past it.", () => {
  assert.deepEqual(
    normalizeRollEntries([{ text: "a" }, { min: 3, text: "b" }, "c", { max: "x", text: "d" }, 7]).map((entry) => [entry.min, entry.max, entry.text]),
    [[1, 1, "a"], [3, 3, "b"], [4, 4, "c"], [5, 5, "d"]],
  );
});

await test("The dead do not fight: a fight is budgeted on the living, as the return fights already were.", async () => {
  const { world, heroes } = await table();
  // Three goblins: 150 at x2.5 for two heroes (375 under 500), and at x3
  // for one (450 over that one's 250).
  patchSheet(heroes[1].id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  const refused = await call(world, "start_encounter", { enemies: [{ monster: "goblin", count: 3 }] });
  assert.match(refused.error ?? "", /Too deadly/);
  const fight = prepare(world, "Three goblins", [{ monster: "goblin", count: 3 }], false);
  const readout = templateDifficulty(world.campaign(), fight.enemies);
  assert.equal(readout.tooDeadly, true, "the readout must say what start_encounter does");
  assert.match(refused.error, new RegExp(`ceiling of ${readout.ceiling}\\b`));
  world.close();
});

await test("A player's benched character does not make a fight easier.", async () => {
  const { world } = await table({ gameSettings: { multiCharacter: "one_active" }, heroes: [{}] });
  world.addHero({ user: world.owner, class: "wizard", level: 2, name: "Benched" });
  const refused = await call(world, "start_encounter", { enemies: [{ monster: "goblin", count: 3 }] });
  assert.match(refused.error ?? "", /Too deadly/, JSON.stringify(refused));
  world.close();
});

await test("Scaling keeps a row kept whole and never cuts below the strongest creature.", () => {
  const fits = (limit) => (rows) => rows.reduce((sum, row) => sum + row.count, 0) <= limit;
  const rows = [{ monster: "boss", count: 1 }, { monster: "minion", count: 5 }, { monster: "pet", count: 2 }];
  const weights = [{ cr: 5, keep: false }, { cr: 0.25, keep: false }, { cr: 1, keep: false }];
  // The largest group gives first, the weaker of two the same size.
  assert.deepEqual(scaleRoster(rows, weights, fits(4)).rows, [{ monster: "boss", count: 1 }, { monster: "minion", count: 1 }, { monster: "pet", count: 2 }]);
  assert.deepEqual(scaleRoster(rows, weights, fits(1)).rows, [{ monster: "boss", count: 1 }]);
  assert.equal(scaleRoster(rows, weights, fits(0)), null);
  const kept = [{ cr: 5, keep: false }, { cr: 0.25, keep: true }, { cr: 1, keep: false }];
  assert.deepEqual(scaleRoster(rows, kept, fits(6)).rows, [{ monster: "boss", count: 1 }, { monster: "minion", count: 5 }]);
});

await test("The lead cannot cue a fight the storyteller would only hold.", async () => {
  const { world } = await table();
  const fight = prepare(world, "Too big", [{ monster: "ogre", count: 1 }], false);
  const handler = await world.route("campaigns/[campaignId]/dm/encounter-templates/[templateId]/deploy");
  world.signIn(world.owner);
  const response = await handler.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ cue: true }) }), {
    params: Promise.resolve({ campaignId: world.campaignId, templateId: fight.id }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /beyond the party as it stands/);
  assert.equal(getEncounterTemplate(fight.id).cued, false);
  world.close();
});

finish();
