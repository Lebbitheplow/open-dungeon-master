// Pacts (issue 503 Phases 5 and 7), the pure half: recruiting DCs and who a
// companion recruits how, once per long rest, the rung a recruit moves to,
// the leader by drive, the plan and its moment, when a pact is ready, the
// tells and the watch, what a player may do in secret at each table, and
// the record's round trip.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const logic = await import("../src/lib/dm/pact-logic.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const axes = (overrides = {}) => ({ drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0, ...overrides });
const held = (value, faction = "") => ({ value, strength: "cares", faction });

test("the DC follows the target's regard for the party: devoted is nearly impossible, wary is easy, nobody is neutral", () => {
  assert.equal(logic.recruitDc(90, 0), 28);
  assert.equal(logic.recruitDc(60, 0), 22);
  assert.equal(logic.recruitDc(0, 0), 13);
  assert.equal(logic.recruitDc(null, 0), 13, "no dealings yet reads as neutral");
  assert.equal(logic.recruitDc(-20, 0), 10);
  assert.equal(logic.recruitDc(-100, 0), 5);
});

test("shared values ease it, two a value, never below 5", () => {
  assert.equal(logic.recruitDc(0, 1), 11);
  assert.equal(logic.recruitDc(0, 3), 7);
  assert.equal(logic.recruitDc(-20, 3), 5);
  assert.equal(logic.sharedValues([held("protects_innocent"), held("keeps_oaths")], [held("keeps_oaths"), held("mercenary")]), 1);
  assert.equal(logic.sharedValues([held("faction_loyalty", "The Watch")], [held("faction_loyalty", "the watch")]), 1, "the same faction");
  assert.equal(logic.sharedValues([held("faction_loyalty", "The Watch")], [held("faction_loyalty", "The Guild")]), 0, "another faction is no common cause");
});

test("regard for the party is the mean of a companion's standing with each character", () => {
  assert.equal(logic.partyRegard([]), null);
  assert.equal(logic.partyRegard([40, -20]), 10);
});

test("only a wavering companion recruits: uneasy or worse", () => {
  assert.equal(logic.wavering(0), false);
  assert.equal(logic.wavering(1), true);
  assert.equal(logic.wavering(4), true);
});

test("once per long rest: one attempt a round, the round named by the last rest's end", () => {
  assert.equal(logic.recruitRound(undefined), -1);
  assert.equal(logic.recruitRound(480), 480);
  assert.equal(logic.attemptAllowed(null, -1), true, "never tried");
  assert.equal(logic.attemptAllowed(-1, -1), false, "tried on the road before any rest");
  assert.equal(logic.attemptAllowed(480, 480), false, "tried this round");
  assert.equal(logic.attemptAllowed(480, 1920), true, "a new rest, a new round");
});

test("a bold companion with little composure argues openly with Persuasion; a composed one works in private with its better skill", () => {
  assert.equal(logic.recruitStyle(axes({ boldness: 2, composure: -1 })), "open");
  assert.equal(logic.recruitStyle(axes({ boldness: 2, composure: 1 })), "secret");
  assert.equal(logic.recruitStyle(null), "secret");
  assert.deepEqual(logic.recruitSkill("open", { persuasion: 1, deception: 5 }), { skill: "persuasion", mod: 1 });
  assert.deepEqual(logic.recruitSkill("secret", { persuasion: 1, deception: 5 }), { skill: "deception", mod: 5 });
  assert.deepEqual(logic.recruitSkill("secret", { persuasion: 3, deception: 3 }), { skill: "persuasion", mod: 3 });
});

test("a recruit moves one rung down from where it stands, never past a warning", () => {
  assert.equal(logic.recruitedRung(0, 0), 1);
  assert.equal(logic.recruitedRung(0, 1), 2, "its standing already made it uneasy");
  assert.equal(logic.recruitedRung(2, 0), 2, "held at a warning");
  assert.equal(logic.recruitedRung(3, 0), 3, "never moved back up");
});

test("the member with the most drive leads, then the boldest, then by name", () => {
  const member = (name, personality) => ({ name, personality });
  assert.equal(logic.pickLeader([member("Seren", axes({ drive: 1 })), member("Thorne", axes({ drive: 2 }))]).name, "Thorne");
  assert.equal(logic.pickLeader([member("Seren", axes({ boldness: 1 })), member("Thorne", axes())]).name, "Seren");
  assert.equal(logic.pickLeader([member("Thorne", null), member("Seren", null)]).name, "Seren");
  assert.equal(logic.pickLeader([]), null);
});

test("the plan: strike at a Turn table with good odds; sabotage for a driven leader with a tactic; else leave", () => {
  const plan = (leader, tactics, odds, setting) => logic.choosePlan({ leader, tactics, odds, setting });
  assert.deepEqual(plan(axes(), [null], "good", "turn"), { plan: "strike", tactic: null });
  assert.deepEqual(plan(axes({ boldness: -1 }), [null], "good", "turn"), { plan: "leave", tactic: null }, "a timid leader never strikes");
  assert.deepEqual(plan(axes(), [null], "good", "leave"), { plan: "leave", tactic: null }, "Leave never fights");
  assert.deepEqual(plan(axes({ drive: 1 }), ["denounce", "theft"], "even", "leave"), { plan: "sabotage", tactic: "theft" });
  assert.deepEqual(plan(axes({ composure: 1 }), ["false_trail"], "against", "leave"), { plan: "sabotage", tactic: "false_trail" });
  assert.deepEqual(plan(axes(), ["theft"], "against", "leave"), { plan: "leave", tactic: null });
});

test("a class's harmless tactic: a rogue steals, a ranger lays a false trail, a cleric, paladin or bard denounces", () => {
  assert.equal(logic.tacticFor("rogue"), "theft");
  assert.equal(logic.tacticFor("Ranger"), "false_trail");
  for (const id of ["cleric", "paladin", "bard"]) {
    assert.equal(logic.tacticFor(id), "denounce");
  }
  assert.equal(logic.tacticFor("wizard"), null);
});

test("when it goes: the night watch, the road for a false trail, a fight (or the night) for a strike", () => {
  assert.equal(logic.triggerFor("leave", null), "night_watch");
  assert.equal(logic.triggerFor("sabotage", "theft"), "night_watch");
  assert.equal(logic.triggerFor("sabotage", "false_trail"), "road");
  assert.equal(logic.triggerFor("strike", null), "fight");
  assert.equal(logic.firesAt("leave", "night_watch", "long_rest"), true);
  assert.equal(logic.firesAt("leave", "night_watch", "travel"), false);
  assert.equal(logic.firesAt("sabotage", "road", "travel"), true);
  assert.equal(logic.firesAt("sabotage", "road", "long_rest"), false);
  assert.equal(logic.firesAt("strike", "fight", "own_turn"), true);
  assert.equal(logic.firesAt("strike", "fight", "long_rest"), true);
  assert.equal(logic.firesAt("leave", "night_watch", "own_turn"), false);
});

test("ready: one member at its breaking point, or two at a warning together", () => {
  assert.equal(logic.pactReady([1, 1]), false);
  assert.equal(logic.pactReady([4]), true);
  assert.equal(logic.pactReady([2]), false);
  assert.equal(logic.pactReady([2, 3]), true);
});

test("a watcher notices only when its passive score beats the check: a tie stays hidden", () => {
  assert.equal(logic.notices(15, 14), true);
  assert.equal(logic.notices(15, 15), false);
  assert.equal(logic.notices(10, 18), false);
});

test("player pacts need Leave or Turn and another player", () => {
  assert.equal(logic.playerPactProblem("leave", 2), null);
  assert.equal(logic.playerPactProblem("turn", 3), null);
  assert.match(logic.playerPactProblem("talk", 3), /Leave or Turn/);
  assert.match(logic.playerPactProblem("leave", 1), /solo campaign/);
});

test("the ceiling: Leave allows theft and harmless schemes; harm and attacking another player need Turn", () => {
  assert.equal(logic.secretKindProblem("leave", "steal"), null);
  assert.equal(logic.secretKindProblem("leave", "scheme"), null);
  assert.match(logic.secretKindProblem("leave", "harm"), /needs a table set to Turn/);
  assert.match(logic.secretKindProblem("leave", "attack"), /needs a table set to Turn/);
  assert.equal(logic.secretKindProblem("turn", "attack"), null);
  assert.match(logic.secretKindProblem("talk", "steal"), /keeps its companions/);
});

test("what a secret action rolls and what the watch notices it with", () => {
  assert.equal(logic.secretSkillFor("steal", "stealth"), "sleight_of_hand", "theft is always Sleight of Hand");
  assert.equal(logic.secretSkillFor("scheme", undefined), "deception");
  assert.equal(logic.secretSkillFor("scheme", "stealth"), "stealth");
  assert.equal(logic.watchSenseFor("deception"), "insight");
  assert.equal(logic.watchSenseFor("stealth"), "perception");
});

test("the approach: four answers, a card safe for a lock screen, words that name the plan", () => {
  assert.deepEqual([...logic.APPROACH_CHOICES], ["join", "play_along", "report", "refuse"]);
  assert.equal(logic.isApproachChoice("join"), true);
  assert.equal(logic.isApproachChoice("betray"), false);
  assert.equal(logic.approachSummary("Brin"), "A private offer for Brin");
  assert.match(logic.approachWords("Seren", { plan: "sabotage", tactic: "theft", trigger: "night_watch" }), /Seren takes you aside.*steal the party's best thing in the night, then leave together, at the night watch/);
  const args = logic.approachArgs(JSON.stringify({ pactId: "p1", recruiter: "Seren", portraitUrl: "", look: { race: "elf" } }));
  assert.deepEqual(args, { pactId: "p1", recruiter: "Seren", portraitUrl: "", look: { gender: "", race: "elf", class: "" } });
  assert.equal(logic.approachArgs("{}"), null);
});

test("the record round-trips, and what does not parse is dropped", () => {
  const members = [
    { kind: "companion", npcId: "n1", name: "Seren", sheetId: "s1" },
    { kind: "player", characterId: "c1", name: "Brin", userId: "u1", stance: "spy" },
    { kind: "nobody" },
  ];
  assert.deepEqual(logic.parseMembers(JSON.stringify(members)), members.slice(0, 2));
  assert.deepEqual(logic.parseMembers("not json"), []);
  const secret = { id: "x", characterId: "c1", name: "Brin", kind: "steal", text: "take it", skill: "sleight_of_hand", rollId: "r", total: 17, watch: 12, caught: false, revealed: false, targetId: "c2", targetName: "Kael", item: "Spyglass", itemJson: "{}", at: 60 };
  assert.deepEqual(logic.parseSecrets(JSON.stringify([secret, { id: "y", kind: "explode" }])), [secret]);
  const pact = { members: logic.parseMembers(JSON.stringify(members)) };
  assert.deepEqual(logic.companionMembers(pact).map((member) => member.name), ["Seren"]);
  assert.deepEqual(logic.playerMembers(pact).map((member) => member.name), ["Brin"]);
});

test("the storyteller's line names the members, the plan, a spy for what she is, and says never to say it", () => {
  const pact = {
    members: [
      { kind: "companion", npcId: "n1", name: "Seren", sheetId: "s1" },
      { kind: "player", characterId: "c1", name: "Brin", userId: "u1", stance: "spy" },
    ],
    plan: "leave",
    tactic: null,
    trigger: "night_watch",
    refusedBy: ["Kael"],
    secrets: [],
  };
  const line = logic.pactLine(pact, "Seren", true);
  assert.match(line, /A pact: Seren, Brin \(only playing along: a spy\), led by Seren, mean to leave the party together, at the night watch/);
  assert.match(line, /It is ready/);
  assert.match(line, /Approached and refused: Kael/);
  assert.match(line, /never say it/);
});

const { playerOpportunities } = await import("../src/lib/agents/webhook-opportunities.ts");

test("the whisper webhook: an offer only this player answers and an unread whisper wake an agent seat, even while the DM narrates", () => {
  const base = {
    active: true, paused: false, busy: true, floor: { mode: "open", userIds: [], respondedUserIds: [] }, floorSeq: 0,
    userId: "u1", characterId: "c1", rolls: [], turn: null, narration: null, lastPlayerSeq: 0,
  };
  assert.deepEqual(playerOpportunities(base), [], "nothing private: nothing while busy");
  const woken = playerOpportunities({ ...base, offers: ["p1"], unreadWhisperId: "w1" });
  assert.deepEqual(woken.map((entry) => [entry.type, entry.opportunityId, entry.proposalId]), [
    ["offer_received", "offer:p1", "p1"],
    ["whisper_received", "whisper:w1", undefined],
  ]);
  assert.deepEqual(playerOpportunities({ ...base, paused: true, offers: ["p1"] }), [], "a paused table wakes nobody");
});

console.log(`test-pacts: ${passed} passed`);
