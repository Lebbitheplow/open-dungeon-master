// Assisted mode: what a human DM has handed to the AI, how long they handed
// the table over for, and how a model's answer for one monster becomes an
// adjudication the engine will take.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  clampCoverBrief,
  clampCoverTurns,
  consumeCover,
  coverActive,
  coverInEffect,
  coverPromptBlock,
  DELEGATIONS,
  DELEGATION_HINTS,
  DELEGATION_LABELS,
  delegated,
  describeCover,
  MAX_COVER_TURNS,
  MONSTER_ACTIONS,
  monsterAdjudication,
  normalizeCover,
  parseMonsterDecision,
} = await import("../src/lib/dm/delegation.ts");
const { ADJUDICATION_NAMES } = await import("../src/lib/dm/invoke-catalog.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const ALL_ON = { monsters: true, narration: true, cover: true };

// ---- the toggles ----

test("every delegation has a label and a hint", () => {
  for (const which of DELEGATIONS) {
    assert.ok(DELEGATION_LABELS[which], `${which} needs a label`);
    assert.ok(DELEGATION_HINTS[which], `${which} needs a hint`);
  }
});

test("nothing is delegated outside assisted mode", () => {
  for (const which of DELEGATIONS) {
    assert.equal(delegated("human", ALL_ON, which), false);
    assert.equal(delegated("ai", ALL_ON, which), false);
    assert.equal(delegated("assisted", ALL_ON, which), true);
  }
});

test("a toggle switched off is off in assisted mode too", () => {
  const assist = { ...ALL_ON, monsters: false };
  assert.equal(delegated("assisted", assist, "monsters"), false);
  assert.equal(delegated("assisted", assist, "narration"), true);
});

// ---- covering ----

test("a cover with answers left is active, one spent down is not", () => {
  assert.equal(coverActive({ turnsLeft: 3, brief: "", byUserId: "u", startedAt: "t" }), true);
  assert.equal(coverActive({ turnsLeft: 0, brief: "", byUserId: "u", startedAt: "t" }), false);
  assert.equal(coverActive(null), false);
});

test("the AI answers only while assisted mode delegated cover and answers remain", () => {
  const running = { turnsLeft: 3, brief: "", byUserId: "u", startedAt: "t" };
  const spent = { ...running, turnsLeft: 0 };
  // The wake guard in src/lib/dm/loop.ts and the action route both read this:
  // an assisted table with a live cover is the one case where player activity
  // may wake the AI on a human-run table.
  assert.equal(coverInEffect("assisted", ALL_ON, running), true);
  assert.equal(coverInEffect("assisted", ALL_ON, spent), false);
  assert.equal(coverInEffect("assisted", ALL_ON, null), false);
  assert.equal(coverInEffect("assisted", { ...ALL_ON, cover: false }, running), false);
  assert.equal(coverInEffect("human", ALL_ON, running), false);
  assert.equal(coverInEffect("ai", ALL_ON, running), false);
});

test("spending an answer counts down and then stops", () => {
  let cover = { turnsLeft: 2, brief: "b", byUserId: "u", startedAt: "t" };
  cover = consumeCover(cover);
  assert.equal(cover.turnsLeft, 1);
  cover = consumeCover(cover);
  assert.equal(cover.turnsLeft, 0);
  // A spent cover is kept rather than nulled, so the console can say the DM
  // has the table back instead of going blank.
  const spent = consumeCover(cover);
  assert.equal(spent.turnsLeft, 0);
  assert.equal(spent.brief, "b");
});

test("consuming null stays null", () => {
  assert.equal(consumeCover(null), null);
});

test("the count is clamped to something a session can survive", () => {
  assert.equal(clampCoverTurns(9999), MAX_COVER_TURNS);
  assert.equal(clampCoverTurns(-4), 0);
  assert.equal(clampCoverTurns("nonsense"), 0);
  assert.equal(clampCoverTurns(3.4), 3);
});

test("a brief is collapsed to one line and capped", () => {
  assert.equal(clampCoverBrief("  keep it\n\n light  "), "keep it light");
  assert.ok(clampCoverBrief("x".repeat(900)).length <= 400);
  assert.equal(clampCoverBrief(undefined), "");
});

test("an unreadable stored cover reads as nobody handed anything over", () => {
  assert.equal(normalizeCover(null), null);
  assert.equal(normalizeCover("hello"), null);
  // No author means no deliberate handover, so it does not count as one.
  assert.equal(normalizeCover({ turnsLeft: 5 }), null);
});

test("a stored cover survives a round trip with its count clamped", () => {
  const cover = normalizeCover({
    turnsLeft: 500,
    brief: "  do not   leave town ",
    byUserId: "u1",
    startedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(cover.turnsLeft, MAX_COVER_TURNS);
  assert.equal(cover.brief, "do not leave town");
  assert.equal(cover.byUserId, "u1");
});

test("the table is told plainly, in the singular and the plural", () => {
  assert.match(
    describeCover({ turnsLeft: 1, brief: "", byUserId: "u", startedAt: "t" }),
    /one more time/,
  );
  assert.match(
    describeCover({ turnsLeft: 4, brief: "", byUserId: "u", startedAt: "t" }),
    /next 4 times/,
  );
  assert.equal(
    describeCover({ turnsLeft: 0, brief: "", byUserId: "u", startedAt: "t" }),
    "The DM has the table back.",
  );
  assert.equal(describeCover(null), "");
});

test("the prompt block is empty unless a cover is running", () => {
  assert.equal(coverPromptBlock(null), "");
  assert.equal(
    coverPromptBlock({ turnsLeft: 0, brief: "x", byUserId: "u", startedAt: "t" }),
    "",
  );
});

test("the prompt block names the count and carries the brief", () => {
  const block = coverPromptBlock({
    turnsLeft: 3,
    brief: "they are haggling",
    byUserId: "u",
    startedAt: "t",
  });
  assert.match(block, /3 answers left/);
  assert.match(block, /they are haggling/);
  // The load-bearing instruction: a stand-in must not spend the story.
  assert.match(block, /Do not spend the story/);
});

test("a cover with no brief still produces a usable block", () => {
  const block = coverPromptBlock({ turnsLeft: 1, brief: "", byUserId: "u", startedAt: "t" });
  assert.match(block, /1 answer left/);
  assert.ok(!block.includes("on their way out"));
});

// ---- monster turns ----

test("every monster action but hold is a real adjudication", () => {
  for (const action of MONSTER_ACTIONS) {
    if (action === "hold") {
      continue;
    }
    assert.ok(
      ADJUDICATION_NAMES.includes(action),
      `${action} is offered to the model but is not in the catalog`,
    );
  }
});

test("a well-formed decision parses", () => {
  const decision = parseMonsterDecision(
    '{"action":"enemy_attack","targetCharacterId":"c1","attack":"Scimitar","why":"nearest"}',
  );
  assert.equal(decision.action, "enemy_attack");
  assert.equal(decision.targetCharacterId, "c1");
  assert.equal(decision.attack, "Scimitar");
});

test("a decision inside prose still parses", () => {
  const decision = parseMonsterDecision('Sure!\n{"action":"hold"}\nHope that helps.');
  assert.equal(decision.action, "hold");
});

test("anything unusable parses to null so the engine fallback runs", () => {
  assert.equal(parseMonsterDecision(""), null);
  assert.equal(parseMonsterDecision("no json here"), null);
  assert.equal(parseMonsterDecision("{not json}"), null);
  // An action outside the shortlist is refused rather than passed through:
  // the model must not reach the party's half of the catalog.
  assert.equal(parseMonsterDecision('{"action":"heal","targetCharacterId":"c1"}'), null);
});

test("an attack becomes enemy_attack with the enemy filled in", () => {
  const call = monsterAdjudication("e1", {
    action: "enemy_attack",
    targetCharacterId: "c2",
    attack: "Bite",
    condition: "",
    why: "closest",
  });
  assert.equal(call.name, "enemy_attack");
  assert.equal(call.args.enemyId, "e1");
  assert.equal(call.args.targetCharacterId, "c2");
  assert.equal(call.args.attack, "Bite");
});

test("a blank attack is left off so the server picks from the stat block", () => {
  const call = monsterAdjudication("e1", {
    action: "enemy_attack",
    targetCharacterId: "c2",
    attack: "",
    condition: "",
    why: "",
  });
  assert.equal("attack" in call.args, false);
});

test("hold and a targetless attack both mean the monster does nothing", () => {
  const hold = { action: "hold", targetCharacterId: "", attack: "", condition: "", why: "" };
  assert.equal(monsterAdjudication("e1", hold), null);
  assert.equal(
    monsterAdjudication("e1", { ...hold, action: "enemy_attack" }),
    null,
  );
});

test("fleeing needs no target and carries the reason", () => {
  const call = monsterAdjudication("e1", {
    action: "enemy_flees",
    targetCharacterId: "",
    attack: "",
    condition: "",
    why: "bloodied and cornered",
  });
  assert.equal(call.name, "enemy_flees");
  assert.equal(call.args.reason, "bloodied and cornered");
});

test("a condition with nothing named is refused rather than half-applied", () => {
  const base = {
    action: "set_enemy_condition",
    targetCharacterId: "c1",
    attack: "",
    condition: "",
    why: "",
  };
  assert.equal(monsterAdjudication("e1", base), null);
  const call = monsterAdjudication("e1", { ...base, condition: "frightened" });
  assert.equal(call.name, "set_enemy_condition");
  assert.equal(call.args.condition, "frightened");
});

console.log(`delegation: ${passed} tests passed`);
