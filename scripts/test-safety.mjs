// Safety tools (docs/vtt-parity-implementation-plan.md 9.1): the X-card
// pauses the DM queue and resumes it, the event names nobody, and a line
// crossed is caught by the guard's check.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-safety-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { dmQueuePaused, enqueueDmJob, pauseDmQueue, resumeDmQueue } = await import("../src/lib/dm/queue.ts");
const { buildLinePrompt, boundaryNegativeTerms, normalizeSafety, renderSafetyBlock } = await import("../src/lib/dm/safety-logic.ts");
const { lineViolations } = await import("../src/lib/dm/safety-lines-logic.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { raiseXCard, resumeAfterXCard, xCardRaised } = await import("../src/lib/dm/safety.ts");
const { subscribe } = await import("../src/lib/events.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

await test("a paused queue holds its jobs until it is resumed", async () => {
  const ran = [];
  pauseDmQueue("c1", "x-card");
  assert.equal(dmQueuePaused("c1"), "x-card");
  const job = enqueueDmJob("c1", async () => {
    ran.push("one");
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(ran, [], "the job waits at the gate");
  assert.equal(resumeDmQueue("c1"), true);
  await job;
  assert.deepEqual(ran, ["one"]);
  assert.equal(resumeDmQueue("c1"), false, "nothing to resume twice");
  assert.equal(dmQueuePaused("c1"), null);
});

await test("raising the card publishes an anonymous, persisted event and resuming names the action", async () => {
  const user = createUser("player", "x");
  const campaign = createCampaign(user.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
  const events = [];
  subscribe(campaign.id, (chunk) => events.push(String(chunk)));
  raiseXCard(campaign.id);
  assert.ok(xCardRaised(campaign.id));
  const raised = events.find((chunk) => chunk.includes("x_card"));
  assert.ok(raised, "an x_card event went out");
  assert.ok(!raised.includes(user.id) && !raised.includes("player"), "the event names nobody");
  assert.ok(/^id: \d+/m.test(raised), "persisted, so a late joiner lands in the pause");
  const outcome = await resumeAfterXCard(campaign.id, "continue");
  assert.deepEqual(outcome, { ok: true });
  assert.ok(!xCardRaised(campaign.id));
  assert.ok(events.some((chunk) => chunk.includes("safety_resumed") && chunk.includes('"action":"continue"')));
});

await test("a line catches its plural and singular in the table's own language, and nothing inside another word", async () => {
  const cases = [
    ["italian", "ragno", "Un ragno scende dal soffitto.", "Tre ragni scendono dal soffitto."],
    ["spanish", "ratón", "Un ratón cruza la sala.", "Los ratones cruzan la sala."],
    ["german", "Spinne", "Eine Spinne krabbelt herab.", "Die Spinnen krabbeln herab."],
    ["french", "araignée", "Une araignée descend du plafond.", "Des araignées descendent du plafond."],
    ["english", "spider", "A spider drops.", "Spiders drop."],
  ];
  for (const [language, line, one, many] of cases) {
    assert.deepEqual(lineViolations(one, [line], language), [line], `${language}: ${one}`);
    assert.deepEqual(lineViolations(many, [line], language), [line], `${language}: ${many}`);
  }
  // A line written with an elided article still catches the bare word.
  assert.deepEqual(lineViolations("Une araignée descend.", ["l'araignée"], "french"), ["l'araignée"]);
  // A name starting or ending with an accented letter.
  assert.deepEqual(lineViolations("Niccolò entra nella stanza.", ["Niccolò"], "italian"), ["Niccolò"]);
  assert.deepEqual(lineViolations("Élodie sourit.", ["Élodie"], "french"), ["Élodie"]);
  // Inside a longer word is no match: the old prefix rule read "rat" in "pirate".
  assert.deepEqual(lineViolations("The pirate laughs.", ["rat"], "english"), []);
  assert.deepEqual(lineViolations("The slave market is closed; a Slavic merchant waits.", ["Slavic"], "english"), ["Slavic"]);
  assert.deepEqual(lineViolations("A Slavic merchant waits.", ["slave"], "english"), []);
});

await test("a line is caught by phrase or by stem, and the prompt block lists lines and veils", async () => {
  const lines = ["spiders", "harm to children"];
  assert.deepEqual(lineViolations("A spider drops from the rafters.", lines, "english"), ["spiders"]);
  assert.deepEqual(lineViolations("The child is safe; nothing harms her.", lines, "english"), ["harm to children"]);
  assert.deepEqual(lineViolations("The rain falls on the mill.", lines, "english"), []);
  assert.match(buildLinePrompt(["spiders"]), /ruled out entirely: spiders/);
  const safety = normalizeSafety({ lines, veils: ["torture"], boundaries: "family", xCard: false });
  const block = renderSafetyBlock(safety);
  assert.match(block, /LINES.*spiders; harm to children/);
  assert.match(block, /VEILS.*torture/);
  assert.match(block, /all ages/);
  assert.equal(safety.xCard, false);
  assert.equal(normalizeSafety(null).boundaries, "standard");
  assert.match(boundaryNegativeTerms("family"), /gore/);
});

console.log(`test-safety: ${passed} passed`);
