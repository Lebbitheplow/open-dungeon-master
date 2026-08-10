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
const DELIBERATELY_OMITTED = new Set(["stages"]);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("every game setting except the omitted ones is offered at creation", () => {
  const keys = Object.keys(gameSettingsSchema.shape);
  assert.ok(keys.length > 20, "the settings schema looks wrong; the shape is nearly empty");
  for (const key of keys) {
    if (DELIBERATELY_OMITTED.has(key)) {
      continue;
    }
    assert.ok(
      creationSurface.includes(key),
      `${key} is in gameSettingsSchema but the creation dialog never offers it`,
    );
  }
});

test("the omission of stages is documented in the dialog itself", () => {
  // A silent omission is the bug this suite exists to catch, so the one
  // intentional gap has to be explained where a reader will find it.
  assert.match(dialog, /stages/i, "the dialog does not mention why stages is left out");
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
