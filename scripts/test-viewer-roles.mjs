// Who sees what, per seat and per DM mode. The point of these assertions is
// that a human DM must gain the secrets without a player ever gaining them,
// and that an AI-run campaign behaves exactly as it did before the seat
// existed.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  AI_CAPS,
  capsForRole,
  hasHumanDm,
  isDmSeat,
  narratorIsAi,
  partySlotCount,
  redactRoll,
  rollAccessFor,
  viewerCaps,
  viewerRoleFor,
} = await import("../src/lib/dm/viewer.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const aiSeats = {
  ownerUserId: "owner",
  leadUserId: "lead",
  humanDmUserId: null,
  assistantDmUserId: null,
  dmMode: "ai",
};
const humanSeats = {
  ownerUserId: "owner",
  leadUserId: "lead",
  humanDmUserId: "gm",
  assistantDmUserId: "gm2",
  dmMode: "human",
};
const assistedSeats = { ...humanSeats, dmMode: "assisted" };

test("an AI campaign has no DM seat, whoever you ask about", () => {
  for (const id of ["owner", "lead", "player", "gm"]) {
    assert.equal(isDmSeat(aiSeats, id), false);
  }
  assert.equal(hasHumanDm(aiSeats), false);
});

test("AI mode: the lead holds the story secrets, players hold nothing", () => {
  const lead = viewerCaps(aiSeats, "lead");
  assert.equal(lead.role, "lead");
  assert.equal(lead.secretStory, true);
  assert.equal(lead.steersStory, true);
  // The lead has never seen raw enemy numbers or an unfogged map, and this
  // change must not hand them over.
  assert.equal(lead.enemyNumbers, false);
  assert.equal(lead.fullMap, false);
  assert.equal(lead.narrates, false);
  assert.equal(lead.adjudicates, false);

  const player = viewerCaps(aiSeats, "player");
  assert.equal(player.role, "player");
  assert.equal(player.secretStory, false);
  assert.equal(player.steersStory, false);
});

test("human mode: the DM holds everything and runs no character", () => {
  const dm = viewerCaps(humanSeats, "gm");
  assert.equal(dm.role, "dm");
  assert.equal(dm.secretStory, true);
  assert.equal(dm.enemyNumbers, true);
  assert.equal(dm.fullMap, true);
  assert.equal(dm.narrates, true);
  assert.equal(dm.adjudicates, true);
  assert.equal(dm.needsCharacter, false);
  assert.equal(dm.countsInParty, false);
});

test("the assistant DM has the same in-game powers", () => {
  assert.deepEqual(viewerCaps(humanSeats, "gm2"), viewerCaps(humanSeats, "gm"));
});

test("human mode: the lead drops back to a player's visibility", () => {
  const lead = viewerCaps(humanSeats, "lead");
  assert.equal(lead.role, "lead");
  // The secrets belong to the person running the game now.
  assert.equal(lead.secretStory, false);
  assert.equal(lead.steersStory, false);
  assert.equal(lead.narrates, false);
  assert.equal(lead.adjudicates, false);
  // Still a player at the table.
  assert.equal(lead.needsCharacter, true);
  assert.equal(lead.countsInParty, true);
});

test("no player ever gains a secret in any mode", () => {
  for (const seats of [aiSeats, humanSeats, assistedSeats]) {
    const player = viewerCaps(seats, "somebody-else");
    assert.equal(player.secretStory, false);
    assert.equal(player.enemyNumbers, false);
    assert.equal(player.fullMap, false);
    assert.equal(player.narrates, false);
    assert.equal(player.adjudicates, false);
  }
});

test("assisted mode seats behave like human mode", () => {
  assert.equal(isDmSeat(assistedSeats, "gm"), true);
  assert.deepEqual(viewerCaps(assistedSeats, "gm"), viewerCaps(humanSeats, "gm"));
  assert.deepEqual(viewerCaps(assistedSeats, "lead"), viewerCaps(humanSeats, "lead"));
});

test("only human mode silences the AI narrator", () => {
  assert.equal(narratorIsAi("ai"), true);
  assert.equal(narratorIsAi("assisted"), true);
  assert.equal(narratorIsAi("human"), false);
});

test("a mode set to human with no seat filled is still AI-run", () => {
  const unseated = { ...humanSeats, humanDmUserId: null, assistantDmUserId: null };
  assert.equal(hasHumanDm(unseated), false);
  assert.equal(viewerRoleFor(unseated, "lead"), "lead");
});

test("the AI's own role sees everything and holds no slot", () => {
  assert.equal(AI_CAPS.secretStory, true);
  assert.equal(AI_CAPS.enemyNumbers, true);
  assert.equal(AI_CAPS.fullMap, true);
  assert.equal(AI_CAPS.countsInParty, false);
  assert.deepEqual(capsForRole("ai", "human"), AI_CAPS);
});

test("DM seats do not consume party slots", () => {
  const members = ["gm", "gm2", "lead", "p1", "p2"];
  assert.equal(partySlotCount(humanSeats, members), 3);
  assert.equal(partySlotCount(aiSeats, members), 5);
});


test("a public roll is public, and that is every roll by default", () => {
  const player = capsForRole("player", "human");
  assert.equal(rollAccessFor({ visibility: "public", characterId: "c1" }, player), "full");
});

test("the DM sees every roll whatever the screen says", () => {
  const dm = capsForRole("dm", "human");
  for (const visibility of ["public", "dm", "blind", "self"]) {
    assert.equal(rollAccessFor({ visibility, characterId: "c1" }, dm), "full");
  }
});

test("a blind roll is redacted for the table, not withheld", () => {
  // Seeing that dice were thrown is the point of a blind roll; seeing the
  // number is not.
  const player = capsForRole("player", "human");
  assert.equal(rollAccessFor({ visibility: "blind", characterId: "c1" }, player), "redacted");
});

test("a DM-only roll does not reach the table at all", () => {
  const player = capsForRole("player", "human");
  assert.equal(rollAccessFor({ visibility: "dm", characterId: "c1" }, player), "hidden");
});

test("a self roll reaches its own roller and nobody else", () => {
  const player = capsForRole("player", "human");
  const roll = { visibility: "self", characterId: "c1" };
  assert.equal(rollAccessFor(roll, player, ["c1"]), "full");
  assert.equal(rollAccessFor(roll, player, ["c2"]), "hidden");
  assert.equal(rollAccessFor(roll, player, []), "hidden");
});

test("the lead keeps their own screen in an AI campaign", () => {
  // The lead steers the story there, so a hidden roll is theirs to read.
  const lead = capsForRole("lead", "ai");
  assert.equal(rollAccessFor({ visibility: "dm", characterId: "c1" }, lead), "full");
  // Once a person is running the game, the lead is a player again.
  const demoted = capsForRole("lead", "human");
  assert.equal(rollAccessFor({ visibility: "dm", characterId: "c1" }, demoted), "hidden");
});

test("redaction drops the number and keeps the fact of the roll", () => {
  const redacted = redactRoll({
    visibility: "blind",
    characterId: "c1",
    kind: "skill_check",
    detail: "stealth",
    total: 18,
    success: true,
    breakdown: { terms: [] },
    dc: 15,
  });
  assert.equal(redacted.total, null);
  assert.equal(redacted.success, null);
  assert.equal(redacted.breakdown, null);
  assert.equal(redacted.dc, null);
  assert.equal(redacted.hidden, true);
  // What it was for survives, or the card would read as a bug.
  assert.equal(redacted.kind, "skill_check");
  assert.equal(redacted.detail, "stealth");
});

console.log(`viewer roles: ${passed} tests passed`);
