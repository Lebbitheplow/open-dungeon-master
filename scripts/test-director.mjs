// Director controls: the one-shot event injector and the absolute command.
import assert from "node:assert/strict";
import {
  ONE_SHOT_EVENT_IDS,
  MAX_ABSOLUTE_COMMAND_LENGTH,
  clampAbsoluteCommand,
  buildOneShotDirective,
  buildAbsoluteCommandDirective,
  buildDirectorBlock,
  isOneShotEventId,
  isArmed,
  oneShotLabel,
  oneShotBlurb,
} from "../src/lib/dm/director-logic.ts";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

check("seven event types, all with labels and directives", () => {
  assert.equal(ONE_SHOT_EVENT_IDS.length, 7);
  for (const id of ONE_SHOT_EVENT_IDS) {
    assert.ok(oneShotLabel(id).length > 0, `${id} has a label`);
    assert.ok(buildOneShotDirective(id).length > 100, `${id} has a real directive`);
  }
});

check("event ids are validated, not trusted", () => {
  assert.equal(isOneShotEventId("combat"), true);
  assert.equal(isOneShotEventId("nonsense"), false);
  assert.equal(isOneShotEventId(""), false);
  assert.equal(isOneShotEventId(null), false);
  assert.equal(isOneShotEventId(42), false);
});

check("every one-shot forbids teleporting and cutting away", () => {
  for (const id of ONE_SHOT_EVENT_IDS) {
    const text = buildOneShotDirective(id);
    assert.match(text, /do not cut away/i, `${id} forbids cutting away`);
    assert.match(text, /current scene/i, `${id} anchors to the current scene`);
    assert.match(text, /genre/i, `${id} keeps the setting's own furniture`);
    assert.match(text, /invites/i, `${id} invites rather than hijacks`);
  }
});

check("mystery and windfall keep something hidden from the table", () => {
  // The whole point of both: the DM privately commits to an answer, so the
  // thread stays consistent and can pay off later instead of evaporating.
  const mystery = buildOneShotDirective("mystery");
  assert.match(mystery, /decide internally what the true explanation is/i);
  assert.match(mystery, /stay consistent with your hidden answer/i);

  const windfall = buildOneShotDirective("windfall");
  assert.match(windfall, /exactly one attached complication/i);
  assert.match(windfall, /decide internally what the catch is/i);
});

check("weird is comedy of obligation, not horror", () => {
  const text = buildOneShotDirective("weird");
  assert.match(text, /comically mundane obligation/i);
  assert.match(text, /no real danger/i);
  assert.match(text, /play it completely straight/i);
});

check("romance prefers an established NPC and never decides for a PC", () => {
  const text = buildOneShotDirective("romance");
  assert.match(text, /prefer an NPC already established/i);
  assert.match(text, /never instant devotion/i);
  assert.match(text, /never decide how a player character feels/i);
});

check("combat scales to the party and states the stakes", () => {
  const text = buildOneShotDirective("combat");
  assert.match(text, /scale it to the party/i);
  assert.match(text, /winning, losing, or fleeing/i);
});

check("every event type has a blurb for the picker", () => {
  for (const id of ONE_SHOT_EVENT_IDS) {
    assert.ok(oneShotBlurb(id).length > 10, `${id} has a real blurb`);
  }
});

check("every directive protects the arc and the engine boundary", () => {
  const blocks = [
    ...ONE_SHOT_EVENT_IDS.map((id) => buildOneShotDirective(id)),
    buildAbsoluteCommandDirective("do the thing"),
  ];
  for (const text of blocks) {
    assert.match(text, /\[NOW\]/, "mentions the arc NOW marker");
    assert.match(text, /this turn only/i, "scoped to one turn");
    assert.match(text, /never decide or state an outcome/i, "defers to the engine");
  }
});

check("absolute command is clamped and whitespace-collapsed", () => {
  assert.equal(clampAbsoluteCommand("  make   it\n\ndarker  "), "make it darker");
  const long = "x".repeat(MAX_ABSOLUTE_COMMAND_LENGTH + 250);
  assert.equal(clampAbsoluteCommand(long).length, MAX_ABSOLUTE_COMMAND_LENGTH);
  assert.equal(clampAbsoluteCommand("   "), "");
});

check("absolute command says out loud that it is not diegetic", () => {
  const text = buildAbsoluteCommandDirective("kill the innkeeper offscreen");
  assert.match(text, /No character hears this/i);
  assert.match(text, /outranks/i);
  assert.ok(text.includes("kill the innkeeper offscreen"));
});

check("an empty absolute command produces no directive", () => {
  assert.equal(buildAbsoluteCommandDirective(""), "");
  assert.equal(buildAbsoluteCommandDirective("   \n  "), "");
});

check("absolute command suppresses a one-shot when both are armed", () => {
  const block = buildDirectorBlock({ oneShot: "combat", absoluteCommand: "go quiet instead" });
  assert.match(block, /No character hears this/i, "the command won");
  assert.ok(block.includes("go quiet instead"));
  assert.ok(
    !block.includes(buildOneShotDirective("combat")),
    "the one-shot directive is not also present",
  );
});

check("a one-shot alone produces its own directive", () => {
  const block = buildDirectorBlock({ oneShot: "mystery", absoluteCommand: "" });
  assert.equal(block, buildOneShotDirective("mystery"));
});

check("nothing armed produces an empty block", () => {
  assert.equal(buildDirectorBlock(null), "");
  assert.equal(buildDirectorBlock({ oneShot: null, absoluteCommand: "" }), "");
  assert.equal(buildDirectorBlock({ oneShot: null, absoluteCommand: "   " }), "");
});

check("a bogus stored one-shot id degrades to nothing rather than throwing", () => {
  assert.equal(buildDirectorBlock({ oneShot: "bogus", absoluteCommand: "" }), "");
});

check("isArmed tracks whether a block would actually be produced", () => {
  assert.equal(isArmed(null), false);
  assert.equal(isArmed({ oneShot: null, absoluteCommand: "  " }), false, "whitespace is disarmed");
  assert.equal(isArmed({ oneShot: "weird", absoluteCommand: "" }), true);
  assert.equal(isArmed({ oneShot: null, absoluteCommand: "hush" }), true);
});

console.log(`director: ${passed} tests passed`);
