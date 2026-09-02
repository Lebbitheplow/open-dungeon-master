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

const dialog = read("../src/app/CreateCampaignDialog.tsx");
const worldSetup = read("../src/app/WorldSetupFields.tsx");
const rulesPanel = read("../src/app/campaigns/[campaignId]/RulesPanel.tsx");
const creationSurface = `${dialog}\n${worldSetup}\n${rulesPanel}`;

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
const DELIBERATELY_OMITTED = new Set([
  "stages",
  "beatReminder",
  "dmAssist",
  "targetParty",
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

test("every intentional omission is documented in the dialog itself", () => {
  // A silent omission is the bug this suite exists to catch, so each
  // intentional gap has to be explained where a reader will find it.
  for (const key of DELIBERATELY_OMITTED) {
    assert.match(
      dialog,
      new RegExp(key, "i"),
      `the dialog does not mention why ${key} is left out`,
    );
  }
});

test("the dialog sends the settings it collects", () => {
  for (const key of ["relationships", "romance", "narrationGuard", "variantRules", "worldPack"]) {
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(dialog),
      `${key} is never referenced in CreateCampaignDialog`,
    );
  }
});

test("romance cannot be sent on while bonds are off", () => {
  // Romance rides on the bond meter, so the payload has to gate it.
  assert.match(
    dialog,
    /romance:\s*relationships === "off" \? "off" : romance/,
    "the dialog can post romance on with relationships off",
  );
});

console.log(`test-create-campaign-options: ${passed} passed`);
