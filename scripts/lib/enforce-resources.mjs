// What the resource and rest suites (scripts/test-enforce-resource-*.mjs,
// test-enforce-short-rest.mjs, test-enforce-long-rest.mjs,
// test-enforce-wild-shape.mjs, test-enforce-font-of-magic.mjs) share: a table
// big enough to seat a hero per class and level, the player's usage route
// called the way a client calls it, and the checks every counter has to pass
// after every operation.
//
// Importing this file imports enforce-world.mjs, so it still has to come
// before anything from src/.
import assert from "node:assert/strict";
import { openWorld } from "./enforce-world.mjs";

// A campaign seats six by default and a player fields one sheet, so a suite
// that walks twelve classes through twenty levels needs a bigger table.
export function openTable(options = {}) {
  return openWorld({
    ...options,
    campaign: { maxPlayers: 400, ...(options.campaign ?? {}) },
  });
}

// A fight with no board. start_encounter lays out a battle map with its
// tokens placed at random, so reach and line of sight would differ from run
// to run; without a map the attack engine asks about neither.
export async function beginBoardlessFight(world, enemies, options = {}) {
  const encounter = await world.beginFight(enemies, options);
  const { getDatabase } = await import("../../src/lib/db/core.ts");
  const db = getDatabase();
  db.prepare(
    "DELETE FROM battle_tokens WHERE map_id IN (SELECT id FROM battle_maps WHERE encounter_id = ?)",
  ).run(encounter.id);
  db.prepare("DELETE FROM battle_maps WHERE encounter_id = ?").run(encounter.id);
  return world.encounter();
}

// A spellcasting block from { level: [max, used] }.
export function casting(ability, slots, extra = {}) {
  return {
    ability,
    slots: Object.fromEntries(
      Object.entries(slots).map(([level, [max, used]]) => [level, { max, used }]),
    ),
    prepared: [],
    known: [],
    cantrips: [],
    ...extra,
  };
}

// The stored sheet without the one field every write moves.
export function stored(world, id) {
  return Object.fromEntries(Object.entries(world.sheet(id)).filter(([key]) => key !== "updatedAt"));
}

// Runs an operation that must be refused and must leave the sheet as it was.
export async function refusedUnchanged(world, id, run, label = "") {
  const before = stored(world, id);
  const outcome = await run();
  assert.equal(outcome.ok, false, `${label} should be refused`);
  assert.deepEqual(stored(world, id), before, `${label} changed the sheet`);
  return outcome;
}

// Every counter a sheet carries, as the database holds it now, is a whole
// number inside 0..max: class resources, spell slots, pact slots, hit dice,
// hit points.
export function assertInBounds(world, id, label = "") {
  const sheet = world.sheet(id);
  const within = (name, used, max) => {
    assert.ok(Number.isInteger(used) && Number.isInteger(max), `${label} ${name} is not whole`);
    assert.ok(used >= 0, `${label} ${name} used ${used} is below 0`);
    assert.ok(used <= max, `${label} ${name} used ${used} is above max ${max}`);
  };
  for (const [name, state] of Object.entries(sheet.resources)) {
    within(name, state.used, state.max);
  }
  for (const [level, slot] of Object.entries(sheet.spellcasting?.slots ?? {})) {
    within(`slot ${level}`, slot.used, slot.max);
  }
  if (sheet.spellcasting?.pact) {
    within("pact", sheet.spellcasting.pact.used, sheet.spellcasting.pact.max);
  }
  within("hit dice", sheet.hitDice.spent, sheet.hitDice.total);
  for (const pool of sheet.hitDicePools ?? []) {
    within(`${pool.die} pool`, pool.spent, pool.total);
  }
  within("hit points", sheet.currentHp, sheet.maxHp);
  return sheet;
}

// POST /api/campaigns/[campaignId]/sheet/usage as the player who owns the
// sheet: the route the character sheet's own plus and minus buttons call.
export async function postUsage(world, sheetId, body) {
  const route = await world.route("campaigns/[campaignId]/sheet/usage");
  world.signIn({ id: world.sheet(sheetId).userId });
  const request = new Request("http://test/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await route.POST(request, {
    params: Promise.resolve({ campaignId: world.campaignId }),
  });
  return { status: response.status, json: await response.json() };
}

// A character benefits from one long rest in 24 hours, so a test that wants a
// second one lets a day go by first.
export const aDayLater = (world) => world.invoke("pass_time", { amount: 1, unit: "days" });

// The in-world clock, in minutes.
export const clockOf = (world) => world.campaign().clock.instant;

// How many in-world minutes an operation took.
export async function minutesTaken(world, run) {
  const before = clockOf(world);
  const outcome = await run();
  return { minutes: clockOf(world) - before, outcome };
}

// Sets counters straight in the database, for arranging a scene.
export function setUsed(world, id, used) {
  const resources = { ...world.sheet(id).resources };
  for (const [name, value] of Object.entries(used)) {
    assert.ok(resources[name], `the sheet has no ${name} counter to arrange`);
    resources[name] = { max: resources[name].max, used: value };
  }
  return world.patch(id, { resources });
}

// The forced dice an operation really rolled, as [sides, face] pairs, and a
// check that it took every die queued for it.
export function rolled(world) {
  const left = world.clearDice();
  const log = world.diceLog();
  assert.equal(left, 0, `${left} queued dice were never rolled`);
  return log.map((die) => [die.sides, die.face]);
}
