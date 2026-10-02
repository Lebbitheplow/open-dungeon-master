// Who a roll names, wherever it is read: the chronicle card (blind or not),
// cinematic mode's toast and chronicle line, the DM's GAME STATE, the beat
// drafts and the post-fight summary. An attack or damage roll names its
// attacker in front and its target in the detail; a roll without an attacker
// (the roll tools, a roll stored before the attacker was recorded) reads as
// it always has, with the sheet it concerns in front.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-roll-labels");
const world = await openWorld();
const { getDatabase } = await import("../src/lib/db/core.ts");
const { insertRoll, listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { listMembers } = await import("../src/lib/db/campaigns.ts");
const { rollExpression } = await import("../src/lib/dice.ts");
const { redactRoll } = await import("../src/lib/dm/viewer.ts");
const { buildGameStateBlock } = await import("../src/lib/dm/prompt.ts");
const { beatSourceLines } = await import("../src/lib/dm/beats.ts");
const { computeEncounterSummary } = await import("../src/lib/dm/encounter-summary.ts");
const { rollCardLabel, rollChronicleLead, rollToastLead } = await import("../src/lib/roll-labels.ts");

const aria = world.addHero({ name: "Aria" });
world.addHero({ name: "Bren" });
world.addHero({ name: "Cora" });
const sera = world.addHero({ name: "Sera", class: "wizard" });
const sheetName = (roll) => (roll.characterId ? world.sheet(roll.characterId)?.name : undefined);

function store(faces, expression, fields) {
  world.dice(...faces);
  const result = rollExpression(expression);
  world.clearDice();
  return insertRoll({ campaignId: world.campaignId, requestedBy: "dm", result, ...fields });
}

const asSheet = (sheet) => ({ kind: "sheet", id: sheet.id, name: sheet.name });
const goblin = { kind: "enemy", id: "enemy-goblin", name: "Goblin" };
const wizard = { kind: "enemy", id: "enemy-wizard", name: "Wizard" };
const shaman = { kind: "enemy", id: "enemy-shaman", name: "Shaman" };
const wolf = { kind: "pet", id: aria.id, name: "Wolf" };

// The eight pinned rolls, with characterId as the engine stores it: the PC
// the roll concerns (the target of an enemy's blow), null for an area.
const eight = [
  store([12], "1d20+5", { characterId: aria.id, kind: "attack", detail: "Longsword vs Goblin", attacker: asSheet(aria) }),
  store([6], "1d8+3", { characterId: aria.id, kind: "damage", detail: "Longsword vs Goblin", attacker: asSheet(aria) }),
  store([20], "1d20+4", { characterId: aria.id, kind: "attack", detail: "Club vs Aria", attacker: goblin }),
  store([5], "1d6+2", { characterId: aria.id, kind: "damage", detail: "Club vs Aria", attacker: goblin }),
  store([3, 4, 5, 6, 2, 1, 3, 4], "8d6", { characterId: null, kind: "damage", detail: "Fireball on Goblin 1, Goblin 2", attacker: asSheet(sera) }),
  store([6, 6, 6, 6, 6, 6, 6, 6], "8d6", { characterId: null, kind: "damage", detail: "Fireball on Aria, Bren, Cora", attacker: wizard }),
  store([20], "1d20+4", { characterId: aria.id, kind: "attack", detail: "Bite vs Goblin", attacker: wolf }),
  store([7], "1d8", { characterId: aria.id, kind: "damage", detail: "Sacred Flame vs Aria", attacker: shaman }),
];

await test("The chronicle card puts the attacker in front and names each creature once.", () => {
  assert.deepEqual(eight.map((roll) => rollCardLabel(roll, sheetName(roll))), [
    "Aria · Attack roll (Longsword vs Goblin)",
    "Aria · Damage (Longsword vs Goblin)",
    "Goblin · Attack roll (Club vs Aria)",
    "Goblin · Damage (Club vs Aria)",
    "Sera · Damage (Fireball on Goblin 1, Goblin 2)",
    "Wizard · Damage (Fireball on Aria, Bren, Cora)",
    "Wolf · Attack roll (Bite vs Goblin)",
    "Shaman · Damage (Sacred Flame vs Aria)",
  ]);
});

await test("A blind roll keeps the names and loses the numbers.", () => {
  const blind = redactRoll(eight[2]);
  assert.equal(blind.total, null);
  assert.equal(blind.breakdown, null);
  assert.deepEqual(blind.attacker, goblin);
  assert.equal(rollCardLabel(blind, sheetName(blind)), "Goblin · Attack roll (Club vs Aria)");
});

await test("Cinematic mode's toast and chronicle line name the attacker the same way.", () => {
  const leads = [
    "Aria · Longsword vs Goblin",
    "Aria · Longsword vs Goblin",
    "Goblin · Club vs Aria",
    "Goblin · Club vs Aria",
    "Sera · Fireball on Goblin 1, Goblin 2",
    "Wizard · Fireball on Aria, Bren, Cora",
    "Wolf · Bite vs Goblin",
    "Shaman · Sacred Flame vs Aria",
  ];
  assert.deepEqual(eight.map((roll) => rollToastLead(roll, sheetName(roll))), leads);
  assert.deepEqual(eight.map((roll) => rollChronicleLead(roll, sheetName(roll))), leads);
});

const gameState = (rolls) =>
  buildGameStateBlock({ campaign: world.campaign(), members: listMembers(world.campaignId), sheets: world.sheets(), recentRolls: rolls, storySummary: "" })
    .split("\n")
    .filter((line) => / rolled -?\d+/.test(line));

await test("The DM's GAME STATE names the attacker as the roller.", () => {
  // The block shows the last five rolls, so the eight go in two reads.
  assert.deepEqual([...gameState(eight.slice(0, 4)), ...gameState(eight.slice(4))], [
    "- Aria: attack (Longsword vs Goblin) rolled 17",
    "- Aria: damage (Longsword vs Goblin) rolled 9",
    "- Goblin: attack (Club vs Aria) rolled 24 (natural 20)",
    "- Goblin: damage (Club vs Aria) rolled 7",
    "- Sera: damage (Fireball on Goblin 1, Goblin 2) rolled 28",
    "- Wizard: damage (Fireball on Aria, Bren, Cora) rolled 48",
    "- Wolf: attack (Bite vs Goblin) rolled 24 (natural 20)",
    "- Shaman: damage (Sacred Flame vs Aria) rolled 7",
  ]);
});

await test("The beat drafts name the attacker as the roller.", () => {
  const lines = beatSourceLines(world.campaignId, "").map((line) => line.text).filter((text) => text.startsWith("Roll:"));
  assert.deepEqual(lines, [
    "Roll: Aria rolled Longsword vs Goblin for 17.",
    "Roll: Aria rolled Longsword vs Goblin for 9.",
    "Roll: Goblin rolled Club vs Aria for 24.",
    "Roll: Goblin rolled Club vs Aria for 7.",
    "Roll: Sera rolled Fireball on Goblin 1, Goblin 2 for 28.",
    "Roll: Wizard rolled Fireball on Aria, Bren, Cora for 48.",
    "Roll: Wolf rolled Bite vs Goblin for 24.",
    "Roll: Shaman rolled Sacred Flame vs Aria for 7.",
  ]);
});

// A combat roll stored with no attacker: the row a roll tool writes, and the
// row every roll stored before the column has (NULL).
const legacy = store([20], "1d20+4", { characterId: aria.id, kind: "attack", detail: "Goblin: Club", attacker: null });
const check = store([11], "1d20+2", { characterId: aria.id, kind: "skill_check", detail: "Aria: Perception" });

await test("A roll without an attacker reads exactly as it did before.", () => {
  const raw = getDatabase().prepare("SELECT attacker_json FROM rolls WHERE id = ?").get(legacy.id);
  assert.equal(raw.attacker_json, null);
  assert.equal(listRecentRolls(world.campaignId, 1)[0].attacker, null);
  assert.equal(rollCardLabel(legacy, "Aria"), "Aria · Attack roll (Goblin: Club)");
  assert.equal(rollToastLead(legacy, "Aria"), "Aria · Goblin: Club");
  assert.equal(rollChronicleLead(legacy, "Aria"), "Goblin: Club");
  assert.equal(rollCardLabel(check, "Aria"), "Aria · Skill check (Aria: Perception)");
  assert.equal(rollChronicleLead({ ...check, detail: "" }, "Aria"), "Aria · Skill check");
  // One table names a roll kind, on the cards and in cinematic mode alike.
  assert.equal(rollChronicleLead({ ...legacy, detail: "" }, "Aria"), "Aria · Attack roll");
  assert.equal(rollToastLead({ ...check, characterId: null, detail: "" }, undefined), "The DM · Skill check");
  assert.deepEqual(gameState([legacy, check]), ["- Aria: attack (Goblin: Club) rolled 24 (natural 20)", "- Aria: skill check (Aria: Perception) rolled 13"]);
  const beats = beatSourceLines(world.campaignId, "").map((line) => line.text).filter((text) => text.startsWith("Roll:"));
  assert.deepEqual(beats.slice(-2), ["Roll: Aria rolled Goblin: Club for 24.", "Roll: Aria rolled Aria: Perception for 13."]);
});

await test("The post-fight summary credits a natural 20 to the PC who rolled it, and damage dealt is unchanged.", () => {
  const rolls = [
    ...eight.map((roll) => ({ characterId: roll.characterId, attacker: roll.attacker, kind: roll.kind, total: roll.total, applied: roll.applied, crit: roll.breakdown.crit ?? null })),
    // Aria's own natural 20 and her applied damage.
    { characterId: aria.id, attacker: asSheet(aria), kind: "attack", total: 25, crit: "nat20" },
    { characterId: aria.id, attacker: asSheet(aria), kind: "damage", total: 11, applied: true, crit: null },
    // A roll with no attacker is the characterId sheet's, as before.
    { characterId: sera.id, kind: "attack", total: 1, crit: "nat1" },
  ];
  const summary = computeEncounterSummary({
    outcome: "victory", rounds: 2, startedAt: "2026-10-01T10:00:00.000Z", endedAt: "2026-10-01T10:05:00.000Z",
    enemies: [{ status: "dead" }], sheets: world.sheets().map((sheet) => ({ id: sheet.id, name: sheet.name })), rolls, audits: [],
  });
  const line = (sheet) => summary.fighters.find((fighter) => fighter.characterId === sheet.id);
  // The goblin's and the wolf's natural 20s are not Aria's.
  assert.equal(line(aria).nat20s, 1);
  assert.equal(line(aria).dealt, 11);
  assert.equal(line(sera).nat1s, 1);
  assert.equal(summary.totals.nat20s, 1);
});

world.close();
finish();
