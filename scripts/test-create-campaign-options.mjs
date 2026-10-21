// The new-campaign dialog must offer every game setting a table would want to
// decide up front. It used to send only a subset, and gameSettingsSchema is
// .partial() at the API, so an omitted field silently took its default and
// nobody could see it. This asserts against the dialog's source so a setting
// added later cannot quietly go missing again.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { gameSettingsSchema } = await import("../src/lib/schemas/game-settings.ts");

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.resolve(scriptsDir, relative), "utf8");

// The payload the dialog posts is built in payload.ts (campaignPayload); the
// dialog itself must still be the thing that sends it.
const dialog = read("../src/app/CreateCampaignDialog.tsx");
const payload = read("../src/app/create-campaign/payload.ts");
const worldSetup = read("../src/app/WorldSetupFields.tsx");
const rulesPanel = read("../src/app/campaigns/[campaignId]/RulesPanel.tsx");
const creationSurface = `${payload}\n${worldSetup}\n${rulesPanel}`;

// `stages` is deliberately absent: it tunes the turn pipeline for a slow local
// model, which is an operator decision made in the lobby, not a table decision
// made at creation. GameSettingsPanel owns it.
//
// `beatReminder` is absent for a related reason: it is how often a human DM is
// nudged to write down what they narrated aloud, and nobody has an opinion
// about that until the nudge has fired at them once. GameSettingsPanel owns it
// too, and shows it only when a person holds the DM seat.
//
// `dmAssist` is absent for the same reason once removed: choosing the assisted
// mode IS the answer to "do you want help", and which help is a question a DM
// answers at the table. All three start on and GameSettingsPanel shows them
// only in assisted mode.
//
// `targetParty` is absent because it is not a campaign setting at all. It is
// the stand-in party a WORKSHOP budgets prep against, and a campaign has real
// character sheets to read instead (docs/workshop-plan.md section 1.1). It
// lives in gameSettingsSchema because a workshop is a campaigns row.
//
// `narrationLength` and `styleNotes` are absent because they answer a table's
// first sessions, not its creation (issue 383): how long the AI DM runs and
// what its prose needs is learned by hearing it on this model. Both start
// as no change at all, and the AI group of GameSettingsPanel owns them.
// `combatPace` (issue #432) is the same kind of choice: how often fights come
// is learned in play, starts balanced, and sits beside them.
//
// `waitForTable` and `waitForTableSeconds` (PR #438) are too: whether the AI
// DM waits for everyone before it answers is learned once the table plays,
// has a safe default, and the Players group of GameSettingsPanel owns it as
// one Pacing picker (AGENTS.md, settings rule 2).
const DELIBERATELY_OMITTED = new Set([
  "stages",
  "beatReminder",
  "dmAssist",
  "targetParty",
  "narrationLength",
  "styleNotes",
  "combatPace",
  "waitForTable",
  "waitForTableSeconds",
]);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// A key counts as offered only where it stands as its own identifier or
// property token (`voice:`, `voice,`, `voice}`). A bare substring test let
// "voice" pass for as long as the dialog had a `(voice) =>` TTS loop, while
// the actual voice settings were never offered at creation.
function offeredAtCreation(key) {
  return new RegExp(`(?<![.\\w$])${key}(?=\\s*[:,}])`).test(creationSurface);
}

test("every game setting except the omitted ones is offered at creation", () => {
  const keys = Object.keys(gameSettingsSchema.shape);
  assert.ok(keys.length > 20, "the settings schema looks wrong; the shape is nearly empty");
  for (const key of keys) {
    if (DELIBERATELY_OMITTED.has(key)) {
      continue;
    }
    assert.ok(
      offeredAtCreation(key),
      `${key} is in gameSettingsSchema but the creation dialog never offers it`,
    );
  }
});

test("the dialog posts the payload this suite audits", () => {
  assert.match(dialog, /JSON\.stringify\(campaignPayload\(/, "CreateCampaignDialog no longer sends campaignPayload");
});

test("every intentional omission is documented where the payload is built", () => {
  // A silent omission is the bug this suite exists to catch, so each
  // intentional gap has to be explained where a reader will find it.
  for (const key of DELIBERATELY_OMITTED) {
    assert.match(
      payload,
      new RegExp(key, "i"),
      `payload.ts does not say why ${key} is left out`,
    );
  }
});

test("the payload sends the settings the dialog collects", () => {
  for (const key of ["relationships", "romance", "narrationGuard", "variantRules", "worldPack"]) {
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(payload),
      `${key} is never referenced in campaignPayload`,
    );
  }
});

test("romance cannot be sent on while bonds are off", () => {
  // Romance rides on the bond meter, so the payload has to gate it.
  assert.match(
    payload,
    /romance:\s*relationships === "off" \? "off" : romance/,
    "the dialog can post romance on with relationships off",
  );
});

console.log(`test-create-campaign-options: ${passed} passed`);
