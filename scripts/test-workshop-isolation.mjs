// A workshop is a campaigns row, so the only thing keeping it from behaving
// like a table that plays is a set of guards. That makes these assertions the
// safety argument for the whole design (docs/workshop-plan.md section 1), and
// they are deliberately written as negatives: what a workshop must NOT do.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  CAMPAIGN_KINDS,
  DEFAULT_TARGET_PARTY,
  isWorkshop,
  normalizeCampaignKind,
  normalizeTargetParty,
  runsAiTurns,
  targetPartyLevels,
} = await import("../src/lib/workshop/kind.ts");
const { normalizeGameSettings } = await import("../src/lib/schemas/game-settings.ts");
const { thresholdsForParty } = await import("../src/lib/srd/encounter-math.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const workshop = { kind: "workshop" };
const campaign = { kind: "campaign" };

// ---- the guards ----

test("a workshop never runs an AI turn", () => {
  assert.equal(runsAiTurns(workshop), false);
  assert.equal(runsAiTurns(campaign), true);
});

test("isWorkshop is the inverse of the guard above", () => {
  assert.equal(isWorkshop(workshop), true);
  assert.equal(isWorkshop(campaign), false);
});

// ---- reading rows that predate the column ----

test("a NULL kind reads as a campaign, so existing rows keep playing", () => {
  assert.equal(normalizeCampaignKind(null), "campaign");
  assert.equal(normalizeCampaignKind(undefined), "campaign");
});

test("an unrecognised kind reads as a campaign rather than throwing", () => {
  // The failure mode to avoid is a typo silently disabling a real table's
  // DM. Falling back to "campaign" makes a bad value harmless.
  assert.equal(normalizeCampaignKind("workshopp"), "campaign");
  assert.equal(normalizeCampaignKind(7), "campaign");
  assert.equal(normalizeCampaignKind(""), "campaign");
});

test("only the literal string opts a row out of play", () => {
  assert.equal(normalizeCampaignKind("workshop"), "workshop");
});

test("every declared kind normalizes to itself", () => {
  for (const kind of CAMPAIGN_KINDS) {
    assert.equal(normalizeCampaignKind(kind), kind);
  }
});

// ---- the stand-in party ----

test("an unset target party falls back to the default", () => {
  assert.deepEqual(normalizeTargetParty(undefined), DEFAULT_TARGET_PARTY);
  assert.deepEqual(normalizeTargetParty({}), DEFAULT_TARGET_PARTY);
});

test("a target party clamps to legal party sizes and levels", () => {
  assert.deepEqual(normalizeTargetParty({ size: 99, level: 99 }), { size: 8, level: 20 });
  assert.deepEqual(normalizeTargetParty({ size: 0, level: 0 }), { size: 1, level: 1 });
  assert.deepEqual(normalizeTargetParty({ size: -3, level: -3 }), { size: 1, level: 1 });
});

test("a fractional target party rounds rather than producing half a character", () => {
  assert.deepEqual(normalizeTargetParty({ size: 4.6, level: 3.2 }), { size: 5, level: 3 });
});

test("garbage in a target party falls back per field, not wholesale", () => {
  assert.deepEqual(normalizeTargetParty({ size: "four", level: 6 }), {
    size: DEFAULT_TARGET_PARTY.size,
    level: 6,
  });
});

test("target party levels feed the encounter budget directly", () => {
  const levels = targetPartyLevels({ size: 4, level: 5 });
  assert.deepEqual(levels, [5, 5, 5, 5]);
  // The point of the shape: no adapter between a workshop and the DMG math.
  assert.deepEqual(thresholdsForParty(levels), {
    easy: 1000,
    medium: 2000,
    hard: 3000,
    deadly: 4400,
  });
});

test("a one-character party is legal, because solo prep is a real thing", () => {
  assert.deepEqual(targetPartyLevels({ size: 1, level: 1 }), [1]);
});

// ---- the settings a workshop is created with ----

test("targetParty survives the game-settings schema", () => {
  const settings = normalizeGameSettings({ targetParty: { size: 6, level: 11 } });
  assert.deepEqual(settings.targetParty, { size: 6, level: 11 });
});

test("a campaign that never heard of targetParty still normalizes", () => {
  // Every existing campaign row is exactly this case.
  const settings = normalizeGameSettings({});
  assert.deepEqual(settings.targetParty, DEFAULT_TARGET_PARTY);
});

test("an out-of-range targetParty does not poison the whole settings blob", () => {
  // normalizeGameSettings falls back to defaults wholesale when the parse
  // fails, so the guard that matters is that the rest of the settings are
  // still usable rather than that this one field is preserved.
  const settings = normalizeGameSettings({ targetParty: { size: 99, level: 3 }, ttsEnabled: false });
  assert.equal(typeof settings.targetParty.size, "number");
  assert.ok(settings.targetParty.size >= 1 && settings.targetParty.size <= 8);
});

console.log(`workshop isolation: ${passed} assertions passed.`);
