// Issue #30: timed conditions run on the in-world clock outside combat.
// A poison set on the road wears off when the party travels, waits, or
// rests; inside an encounter the round wrap owns the countdown and the
// clock leaves conditions alone.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-condition-clock-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { advanceClock } = await import("../src/lib/db/clock.ts");
const { createSheet, getSheetById, patchSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { createEncounter, endEncounter } = await import("../src/lib/db/encounters.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const dm = createUser("dm", "x");
const campaign = createCampaign(dm.id, {
  title: "The Marsh Road",
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 1,
  difficulty: "normal",
});
const sheet = createSheet(
  campaign.id,
  dm.id,
  1,
  createSheetSchema.parse({
    name: "Kara",
    race: "human",
    class: "fighter",
    abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 11, cha: 8 },
    maxHp: 12,
    ac: 16,
    hitDice: { die: "d10", total: 1, spent: 0 },
    proficiencies: { saves: ["str", "con"], skills: [], languages: [], tools: [], armor: [], weapons: [] },
  }),
);

function afflict(meta) {
  patchSheet(sheet.id, { conditions: Object.keys(meta), conditionMeta: meta });
}
function current() {
  return getSheetById(sheet.id);
}
function latestSystemLine() {
  return listRecentMessages(campaign.id, 1).find((m) => m.authorType === "system")?.content ?? "";
}

try {
  test("a poison set outside combat counts down as the clock moves", () => {
    afflict({ poisoned: { rounds: 600 } });
    assert.ok(!("error" in advanceClock(campaign.id, 30, "minutes")));
    assert.deepEqual(current().conditions, ["poisoned"]);
    assert.equal(current().conditionMeta.poisoned.rounds, 300);
  });

  test("and expires once enough in-world time has passed, with a note at the table", () => {
    advanceClock(campaign.id, 45, "minutes");
    assert.deepEqual(current().conditions, []);
    assert.deepEqual(current().conditionMeta, {});
    assert.match(latestSystemLine(), /Kara is no longer poisoned/);
  });

  test("an untimed condition is left alone by the clock", () => {
    afflict({ prone: {} });
    advanceClock(campaign.id, 8, "hours");
    assert.deepEqual(current().conditions, ["prone"]);
  });

  test("a long rest's eight hours clear an hour-long condition on their own", () => {
    afflict({ cursed: { rounds: 600 } });
    advanceClock(campaign.id, 480, "minutes");
    assert.deepEqual(current().conditions, []);
  });

  test("inside an encounter the clock does not touch conditions", () => {
    afflict({ stunned: { rounds: 2 } });
    const encounter = createEncounter(campaign.id, "ambush");
    assert.ok(encounter);
    advanceClock(campaign.id, 10, "minutes");
    assert.equal(current().conditionMeta.stunned.rounds, 2);
    endEncounter(encounter.id, "won");
    advanceClock(campaign.id, 1, "minutes");
    assert.deepEqual(current().conditions, []);
  });

  test("a save-ends condition gets one save per passage of time, never a hundred", () => {
    // DC 40 cannot be met, so the save is rolled and fails, and the
    // condition stays; the point is that the tick neither crashes nor
    // removes it without a success.
    afflict({ frightened: { saveEnds: { ability: "wis", dc: 40 } } });
    advanceClock(campaign.id, 10, "minutes");
    assert.deepEqual(current().conditions, ["frightened"]);
    assert.match(latestSystemLine(), /Kara stays frightened \(WIS save \d+ vs DC 40\)/);
    const first = latestSystemLine();
    // Exactly one save line per advance.
    assert.equal((first.match(/stays frightened/g) ?? []).length, 1);
  });
} finally {
  removeTempDir(dir);
}

console.log(`test-condition-clock: ${passed} tests passed`);
