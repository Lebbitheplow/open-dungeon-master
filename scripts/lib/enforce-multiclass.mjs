// What the test-enforce-multiclass-*.mjs suites share: a table whose owner
// plays one hero at a time, the sheet route called the way a player's client
// calls it, and the SRD 5.1 tables the suites compare the engine against.
// The tables are written here from the rulebook, never read from ODM's data.
import assert from "node:assert/strict";
import { openWorld } from "./enforce-world.mjs";

// SRD 5.1, "Multiclassing", prerequisites. Outer list: any one alternative
// is enough. Inner list: every score in it must be 13 or higher.
export const SRD_PREREQS = {
  barbarian: [["str"]],
  bard: [["cha"]],
  cleric: [["wis"]],
  druid: [["wis"]],
  fighter: [["str"], ["dex"]],
  monk: [["dex", "wis"]],
  paladin: [["str", "cha"]],
  ranger: [["dex", "wis"]],
  rogue: [["dex"]],
  sorcerer: [["cha"]],
  warlock: [["cha"]],
  wizard: [["int"]],
};

export const SRD_CLASS_IDS = Object.keys(SRD_PREREQS);

// SRD 5.1 hit dice by class.
export const SRD_HIT_DIE = {
  barbarian: "d12",
  fighter: "d10", paladin: "d10", ranger: "d10",
  bard: "d8", cleric: "d8", druid: "d8", monk: "d8", rogue: "d8", warlock: "d8",
  sorcerer: "d6", wizard: "d6",
};

// SRD 5.1, "Multiclass Spellcaster: Spell Slots per Spell Level". Index 0 is
// caster level 1; each row lists the slots of spell level 1, 2, 3 and so on.
export const SRD_MULTICLASS_SLOTS = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

// A slot row as the { spellLevel: max } map sheets store, zero rows dropped.
export function slotMap(row) {
  return Object.fromEntries(
    row.map((max, index) => [String(index + 1), max]).filter(([, max]) => max > 0),
  );
}

// The same map read off a stored sheet's shared pool.
export function storedSlots(sheet) {
  return Object.fromEntries(
    Object.entries(sheet.spellcasting?.slots ?? {})
      .filter(([, slot]) => slot.max > 0)
      .map(([level, slot]) => [level, slot.max]),
  );
}

export function scores(overrides = {}) {
  return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...overrides };
}

// Scores that meet the prerequisites of every class named, at exactly 13,
// taking the first alternative where a class offers two.
export function scoresMeeting(...classIds) {
  const out = scores();
  for (const classId of classIds) {
    for (const ability of SRD_PREREQS[classId]?.[0] ?? []) {
      out[ability] = 13;
    }
  }
  return out;
}

const pools = (sheet) => sheet.hitDicePools ?? [];

// Every mirror a multiclass sheet keeps must agree with its classes array,
// and every counter must sit inside its bounds.
export function assertCoherent(sheet, label = sheet.name) {
  const list = sheet.classes;
  assert.ok(sheet.level >= 1 && sheet.level <= 20, `${label}: level ${sheet.level} is outside 1 to 20`);
  if (list.length > 0) {
    const summed = list.reduce((sum, entry) => sum + entry.level, 0);
    assert.equal(sheet.level, summed, `${label}: level is not the sum of the class levels`);
    assert.equal(sheet.class, list[0].id, `${label}: class is not the first entry`);
    assert.equal(sheet.subclass, list[0].subclass, `${label}: subclass is not the first entry's`);
    assert.ok(list.length <= 3, `${label}: more than three classes`);
    assert.equal(
      new Set(list.map((entry) => entry.id.toLowerCase())).size,
      list.length,
      `${label}: a class is listed twice`,
    );
  }
  if (list.length > 1) {
    assert.deepEqual(
      pools(sheet).map((pool) => [pool.classId, pool.total]),
      list.map((entry) => [entry.id, entry.level]),
      `${label}: the hit-die pools do not match the class levels`,
    );
    for (const pool of pools(sheet)) {
      assert.ok(pool.spent >= 0 && pool.spent <= pool.total, `${label}: ${pool.classId} spent ${pool.spent} of ${pool.total}`);
      if (SRD_HIT_DIE[pool.classId]) {
        assert.equal(pool.die, SRD_HIT_DIE[pool.classId], `${label}: ${pool.classId} rolls the wrong die`);
      }
    }
    assert.equal(sheet.hitDice.spent, pools(sheet).reduce((sum, pool) => sum + pool.spent, 0), `${label}: spent mirror`);
    assert.equal(sheet.hitDice.die, pools(sheet)[0].die, `${label}: die mirror`);
  }
  assert.equal(sheet.hitDice.total, sheet.level, `${label}: hit dice total is not the character level`);
  assert.ok(sheet.hitDice.spent >= 0 && sheet.hitDice.spent <= sheet.hitDice.total, `${label}: hit dice spent out of bounds`);
  for (const [level, slot] of Object.entries(sheet.spellcasting?.slots ?? {})) {
    assert.ok(slot.used >= 0 && slot.used <= slot.max, `${label}: level ${level} slots used ${slot.used} of ${slot.max}`);
  }
  const pact = sheet.spellcasting?.pact;
  if (pact) {
    assert.ok(pact.used >= 0 && pact.used <= pact.max, `${label}: pact slots used ${pact.used} of ${pact.max}`);
  }
  for (const [id, state] of Object.entries(sheet.resources ?? {})) {
    assert.ok(state.used >= 0 && state.used <= state.max, `${label}: ${id} used ${state.used} of ${state.max}`);
  }
}

export async function openTable(options = {}) {
  const world = await openWorld(options);
  const sheetsDb = await import("../../src/lib/db/sheets.ts");
  const routes = {
    sheet: await world.route("campaigns/[campaignId]/sheet"),
    usage: await world.route("campaigns/[campaignId]/sheet/usage"),
    sync: await world.route("campaigns/[campaignId]/sheet/sync"),
  };

  // One request, as the signed-in player's client sends it.
  async function send(routeName, method, body, { user = world.owner, campaignId = world.campaignId } = {}) {
    world.signIn(user);
    const response = await routes[routeName][method](
      new Request("http://test.local/api", { method, body: JSON.stringify(body) }),
      { params: Promise.resolve({ campaignId }) },
    );
    const json = await response.json();
    return { status: response.status, error: json.error, sheet: json.sheet, body: json };
  }

  // The owner's hero, replacing whichever one they had: a player fields one
  // sheet, and a fresh one per case keeps the cases apart. A level is taken
  // only with the experience for it, and these suites ask about everything
  // else a level-up does, so the hero arrives with the experience of 20th
  // level unless a case says otherwise (`xp`).
  let current = null;
  function hero({ xp = 355000, ...input } = {}) {
    sheetsDb.deleteSheetForUser(world.campaignId, world.owner.id);
    const made = world.addHero({ ...input, user: world.owner });
    current = world.patch(made.id, { xp });
    return current;
  }
  // A sheet that arrived another way (out of the library) becomes the hero.
  function adopt(sheet) {
    current = sheet;
    return current;
  }
  const now = () => world.sheet(current.id);

  // One level, taken in the named class, through the player's PATCH.
  function levelUp(classId, extra = {}) {
    return send("sheet", "PATCH", { level: now().level + 1, levelUpClass: classId, ...extra });
  }

  // Several levels, one request each. Throws when the server refuses one.
  async function levelInto(classId, times = 1, extra = {}) {
    for (let step = 0; step < times; step += 1) {
      const out = await levelUp(classId, step === 0 ? extra : {});
      assert.equal(out.status, 200, `level-up into ${classId} refused: ${out.error}`);
    }
    return now();
  }

  // A refusal, and proof that it wrote nothing.
  async function assertRefused(body, label) {
    const before = now();
    const out = await send("sheet", "PATCH", body);
    assert.ok(out.status >= 400, `${label}: the server answered ${out.status}`);
    assert.deepEqual(now(), before, `${label}: the refusal changed the sheet`);
    return out;
  }

  return { world, send, hero, adopt, now, levelUp, levelInto, assertRefused };
}
