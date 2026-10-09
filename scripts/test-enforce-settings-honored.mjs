// Every switch the settings panel offers is read by something.
//
// A setting is a promise the table makes to its players. The variant rules
// are held one by one in test-enforce-variant-rules.mjs and the table's
// frame in test-enforce-campaign-config.mjs; this suite asks the plainer
// question of the whole schema (src/lib/schemas/game-settings.ts): is each
// key read anywhere outside the schema and the panels that edit it? A key
// nothing reads is a switch wired to nothing, and the panel that shows it
// is lying.
//
// Then the hit point method, the one setting with three values that each
// change a number: "average" takes the fixed value, "max" the die's top
// face, "rolled" rolls the die (and lets the player take the average). The
// level-up route (PATCH /api/campaigns/[id]/sheet) is the door, and the
// request's own maxHp must count for nothing under any of them.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, suite } from "./lib/enforce-harness.mjs";
import { XP_BY_LEVEL, patchSheetAs } from "./lib/enforce-srd-progression.mjs";

const { test, gap, finish } = suite("test-enforce-settings-honored");

const repo = path.resolve(import.meta.dirname, "..");

// ---- every key is read ----

// The keys of the schema, top level and one level down (voice.turnEnforcement
// is read as `turnEnforcement` off the voice object).
function schemaKeys() {
  const source = fs.readFileSync(path.join(repo, "src/lib/schemas/game-settings.ts"), "utf8");
  const keys = new Set();
  for (const match of source.matchAll(/^\s{2,6}([a-zA-Z]+):\s*z\./gm)) {
    keys.add(match[1]);
  }
  return [...keys].sort();
}

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// Files that only DEFINE or EDIT settings: the schema, its options, and the
// panels. A read there is not the engine reading the key.
const EDITORS = /schemas\/game-settings|schemas\/game-settings-options|GameSettingsPanel|CreateCampaignDialog|settings\/route\.ts|test-/;

const files = sourceFiles(path.join(repo, "src")).filter((file) => !EDITORS.test(file));
const corpus = files.map((file) => [file, fs.readFileSync(file, "utf8")]);

function readers(key) {
  const pattern = new RegExp(`\\b${key}\\b`);
  return corpus.filter(([, text]) => pattern.test(text)).map(([file]) => path.relative(repo, file));
}

const KEYS = schemaKeys();

await test("the schema has the keys this suite expects to find switches among", () => {
  assert.ok(KEYS.length >= 40, `${KEYS.length} keys`);
  for (const key of ["dmMode", "hpMethod", "startingWealth", "supplies", "flanking", "multiclassingEnabled"]) {
    assert.ok(KEYS.includes(key), key);
  }
});

// Keys this suite has recorded as read by nothing. Each stays a gap until
// something reads it or the panel stops offering it. (None today.)
const UNREAD = {};

for (const key of KEYS) {
  const where = readers(key);
  const note = UNREAD[key];
  const run = () => {
    assert.ok(where.length > 0, `gameSettings.${key} is read by nothing outside the schema and the panels`);
  };
  if (note) {
    await gap(`setting-unread:${key}`, {
      rule: `A setting the panel offers is read by the engine: gameSettings.${key}.`,
      where: "src/lib/schemas/game-settings.ts, src/app/campaigns/[campaignId]/GameSettingsPanel.tsx",
      severity: "low",
      note,
    }, run);
  } else {
    await test(`gameSettings.${key} is read somewhere (${where.slice(0, 2).join(", ")}${where.length > 2 ? ", ..." : ""})`, run);
  }
}

// ---- hpMethod at a level-up ----

const SCORES = { str: 15, dex: 14, con: 14, int: 8, wis: 12, cha: 10 };

async function tableWith(hpMethod) {
  const world = await openWorld({ gameSettings: { hpMethod } });
  const sheetRoute = await world.route("campaigns/[campaignId]/sheet");
  const hero = world.addHero({ class: "fighter", level: 1, maxHp: 12, abilities: SCORES });
  await world.invoke("award_xp", { characterIds: [hero.id], amount: XP_BY_LEVEL[1], reason: "earned" });
  return {
    world,
    sheet: () => world.sheet(hero.id),
    patch: (body) => patchSheetAs(world, sheetRoute, world.owner, body),
  };
}

const request = (sheet, extra = {}) => ({
  level: 2,
  maxHp: sheet.maxHp + 6 + abilityMod(sheet.abilities.con),
  currentHp: sheet.currentHp + 6 + abilityMod(sheet.abilities.con),
  hitDice: { ...sheet.hitDice, total: 2 },
  ...extra,
});

await test("average: a fighter gains 6 + CON, whatever maxHp the request names and whatever hpChoice it sends", async () => {
  for (const hpChoice of [undefined, "roll", "average"]) {
    const { world, sheet, patch } = await tableWith("average");
    const before = sheet();
    const response = await patch(request(before, { maxHp: before.maxHp + 10 + 2, ...(hpChoice ? { hpChoice } : {}) }));
    assert.equal(response.status, 200, response.json.error);
    assert.equal(sheet().maxHp, before.maxHp + 6 + 2, `hpChoice ${hpChoice}: ${sheet().maxHp}`);
    world.close();
  }
});

await test("max: a fighter gains 10 + CON", async () => {
  const { world, sheet, patch } = await tableWith("max");
  const before = sheet();
  const response = await patch(request(before));
  assert.equal(response.status, 200, response.json.error);
  assert.equal(sheet().maxHp, before.maxHp + 10 + 2);
  world.close();
});

await test("rolled: the server rolls the d10 and the request's number counts for nothing; a player may take the average instead", async () => {
  const rolled = await tableWith("rolled");
  const before = rolled.sheet();
  rolled.world.dice(3);
  const response = await rolled.patch(request(before, { maxHp: before.maxHp + 10 + 2, hpChoice: "roll" }));
  rolled.world.clearDice();
  assert.equal(response.status, 200, response.json.error);
  assert.equal(rolled.sheet().maxHp, before.maxHp + 3 + 2, `rolled a 3: ${rolled.sheet().maxHp}`);
  assert.equal(rolled.sheet().hitDice.total, 2);
  rolled.world.close();

  const averaged = await tableWith("rolled");
  const start = averaged.sheet();
  averaged.world.dice(10);
  const taken = await averaged.patch(request(start, { hpChoice: "average" }));
  const unused = averaged.world.clearDice();
  assert.equal(taken.status, 200, taken.json.error);
  assert.equal(averaged.sheet().maxHp, start.maxHp + 6 + 2, `took the average: ${averaged.sheet().maxHp}`);
  assert.equal(unused, 1, "no die was rolled for an average taken");
  averaged.world.close();
});

await test("rolled: a 1 on the die still gains at least 1 + CON", async () => {
  const { world, sheet, patch } = await tableWith("rolled");
  const before = sheet();
  world.dice(1);
  const response = await patch(request(before, { hpChoice: "roll" }));
  world.clearDice();
  assert.equal(response.status, 200, response.json.error);
  assert.equal(sheet().maxHp, before.maxHp + 1 + 2);
  world.close();
});

// Found 2026-10-08 and fixed the same day: the die was rolled with the plain
// dice and nothing reached the rolls table (sheet/route.ts now rolls it
// through rollCard).
await test("rolled: the hit die is a dice card on the record, named for the level it bought", async () => {
  const { world, sheet, patch } = await tableWith("rolled");
  const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
  const before = sheet();
  world.dice(7);
  const response = await patch(request(before, { hpChoice: "roll" }));
  world.clearDice();
  assert.equal(response.status, 200, response.json.error);
  assert.equal(sheet().maxHp, before.maxHp + 7 + 2);
  const cards = listRecentRolls(world.campaignId, 20).filter((roll) => roll.characterId === before.id);
  assert.equal(cards.length, 1, "one card for the one die");
  assert.equal(cards[0].total, 7, "showing the face rolled");
  assert.match(cards[0].detail, /level 2/);
  assert.equal(cards[0].expression, "1d10");
  world.close();
});

await test("average and max roll no die and leave no card", async () => {
  const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
  for (const method of ["average", "max"]) {
    const { world, sheet, patch } = await tableWith(method);
    const before = sheet();
    const response = await patch(request(before, { hpChoice: "roll" }));
    assert.equal(response.status, 200, response.json.error);
    assert.equal(listRecentRolls(world.campaignId, 20).filter((roll) => roll.characterId === before.id).length, 0, method);
    world.close();
  }
});

finish();
