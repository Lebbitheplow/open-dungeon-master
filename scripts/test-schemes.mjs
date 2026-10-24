// Scheming NPCs and the storyteller's secrets (issue 501, #503 Phase 0.2),
// the pure half: the act on a relationship row (it shows a warmth, keeps the
// gap as the true meter moves, is seen through by some, comes out to all),
// who may run one on whom, an NPC's Deception from their nature, and the one
// visibility tier above the lead's: which seats read a storyteller secret, a
// fact tagged one, a context-trace row tagged one, and a recap.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const scheme = await import("../src/lib/dm/scheme-logic.ts");
const viewer = await import("../src/lib/dm/viewer.ts");
const facts = await import("../src/lib/dm/fact-logic.ts");
const budget = await import("../src/lib/dm/context-budget.ts");
const recap = await import("../src/lib/dm/recap-logic.ts");

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

// ---- the act ----

test("an act starts where they truly stand, so a start alone shows nothing new, and keeps the motive short and tidy", () => {
  const act = scheme.startPretense(`  the   vault ${"key ".repeat(60)}`, -20, "2026-10-23T00:00:00.000Z");
  assert.equal(act.shown, -20, "no jump: the warmth has to be played");
  assert.equal(scheme.outwardApproval({ approval: -20, pretense: act }), -20);
  assert.ok(act.motive.startsWith("the vault key"), "inner space folded");
  assert.equal(act.motive.length, scheme.MOTIVE_MAX);
  assert.deepEqual(act.exposedTo, []);
  assert.equal(act.revealed, false);
  assert.equal(scheme.startPretense("a ring", 72, "").shown, 72);
  assert.equal(scheme.startPretense("a ring", 400, "").shown, 100, "clamped to the meter");
});

test("an act reads back from its column, and anything else reads as none", () => {
  const act = scheme.startPretense("the vault key", 0, "2026-10-23T00:00:00.000Z");
  assert.deepEqual(scheme.parsePretense(scheme.serializePretense(act)), act);
  assert.equal(scheme.parsePretense(""), null);
  assert.equal(scheme.parsePretense("not json"), null);
  assert.equal(scheme.parsePretense('{"shown":40}'), null, "no motive, no act");
  assert.equal(scheme.serializePretense(null), "");
  const odd = scheme.parsePretense('{"motive":"x","shown":400,"exposedTo":["a","a",""],"revealed":"yes"}');
  assert.equal(odd.shown, 100, "clamped to the meter");
  assert.deepEqual(odd.exposedTo, ["a"]);
  assert.equal(odd.revealed, false, "only true reveals");
});

// An act played up to courting's warmth over a few scenes.
const played = (truth) => ({ ...scheme.startPretense("the vault key", truth, ""), shown: 55 });

test("every outward rule reads the act while it runs, and the truth once it is out", () => {
  const act = played(-10);
  assert.equal(scheme.outwardApproval({ approval: -10, pretense: act }), 55);
  assert.equal(scheme.outwardApproval({ approval: -10, pretense: null }), -10);
  assert.equal(scheme.outwardApproval({ approval: -10, pretense: scheme.revealPretense(act) }), -10);
  assert.equal(scheme.actRunning(act), true);
  assert.equal(scheme.actRunning(scheme.revealPretense(act)), false);
  assert.equal(scheme.actRunning(null), false);
});

test("outside a beat, the act moves as the true meter does, so a slight lands on both", () => {
  const act = played(-10);
  assert.equal(scheme.followTrueMeter(act, -10, -2).shown, 63, "a gift shows");
  assert.equal(scheme.followTrueMeter(act, -10, -40).shown, 25, "and a slight");
  assert.equal(scheme.followTrueMeter({ ...act, shown: 95 }, -10, 10).shown, 100, "clamped");
  const out = scheme.revealPretense(act);
  assert.equal(scheme.followTrueMeter(out, -10, 20), out, "an act that came out moves no more");
});

test("a warm beat is worth its face value to an act, less each repeat as with anyone; a cold beat nothing", () => {
  assert.equal(scheme.actFaceValue(6, 0), 6);
  assert.equal(scheme.actFaceValue(6, 1), 4, "6 x 0.6");
  assert.equal(scheme.actFaceValue(6, 2), 2, "6 x 0.3");
  assert.equal(scheme.actFaceValue(6, 3), 0, "the fourth identical move is worth nothing");
  assert.equal(scheme.actFaceValue(6, 9), 0);
  assert.equal(scheme.actFaceValue(-8, 0), 0, "a cold beat is the truth's to move");
});

test("a warm beat lands on the act at face value whatever they truly feel; a cold one moves both", () => {
  const act = scheme.startPretense("the vault key", -20, "");
  const warmed = scheme.actAfterBeat(act, 6, -20, -23);
  assert.equal(warmed.shown, -14, "the act lands though the deed grated on her (-3 to the truth)");
  const chilled = scheme.actAfterBeat(warmed, 0, -23, -31);
  assert.equal(chilled.shown, -22, "a slight lands on both alike");
  assert.equal(scheme.actAfterBeat({ ...act, shown: 98 }, 9, 0, 9).shown, 100, "clamped");
  const out = scheme.revealPretense(act);
  assert.equal(scheme.actAfterBeat(out, 6, -20, -14), out, "an act that came out is not built any more");
});

test("seeing through an act adds each character once; a reveal is for everyone", () => {
  const act = scheme.startPretense("the vault key", 0, "");
  const seen = scheme.exposeTo(scheme.exposeTo(act, ["kael"]), ["kael", "nysa"]);
  assert.deepEqual(seen.exposedTo, ["kael", "nysa"]);
  assert.equal(scheme.revealPretense(seen).revealed, true);
});

// ---- who may run one on whom ----

const mira = { name: "Mira", kind: "npc", status: "active", gender: "Female", attraction: { genders: ["Male"], note: "" }, actToward: null };
const kael = { name: "Kael", gender: "Male", attraction: { genders: [], note: "" }, open: true, isCompanion: false };

test("only toward a character open to advances, by an NPC drawn to them and they to the NPC", () => {
  assert.equal(scheme.schemeStartProblem(mira, kael, null), null);
  assert.match(scheme.schemeStartProblem(mira, { ...kael, open: false }, null), /has not opened Kael to advances/);
  assert.match(scheme.schemeStartProblem(mira, { ...kael, gender: "Female" }, null), /not drawn to each other/);
  assert.match(scheme.schemeStartProblem(mira, { ...kael, attraction: { genders: ["Male"], note: "" } }, null), /not drawn to each other/, "both ways");
  assert.equal(scheme.schemeStartProblem({ ...mira, attraction: null }, kael, null), null, "an NPC left blank is open to anyone");
});

test("no act toward a companion, by a companion, after the end, while apart, or two at once", () => {
  assert.match(scheme.schemeStartProblem(mira, { ...kael, isCompanion: true }, null), /is a companion/);
  assert.match(scheme.schemeStartProblem({ ...mira, kind: "companion" }, kael, null), /only an NPC keeps up an act/);
  assert.match(scheme.schemeStartProblem({ ...mira, status: "ended" }, kael, null), /finished/);
  assert.match(scheme.schemeStartProblem({ ...mira, status: "parted" }, kael, null), /not with the party/);
  assert.match(scheme.schemeStartProblem({ ...mira, actToward: "Nysa" }, kael, null), /already keeping up an act toward Nysa/);
});

test("the table's safety tools rule an act out as they rule out an honest advance", () => {
  const problem = scheme.schemeStartProblem(mira, kael, "This is a family table, so no NPC makes a romantic advance.");
  assert.match(problem, /family table, so no NPC makes a romantic advance\. An act of romance is ruled out with it\./);
});

test("a reveal needs an act that has not come out", () => {
  assert.match(scheme.schemeRevealProblem("Mira", "Kael", null), /keeps up no act/);
  const act = scheme.startPretense("the vault key", 0, "");
  assert.equal(scheme.schemeRevealProblem("Mira", "Kael", act), null);
  assert.match(scheme.schemeRevealProblem("Mira", "Kael", scheme.revealPretense(act)), /already come out/);
});

// ---- seeing through it ----

test("an NPC with no stat block lies as well as their nature lets them, the same every time", () => {
  assert.equal(scheme.deceptionFromNature(null), 2, "an unremarkable person");
  assert.equal(scheme.deceptionFromNature({ drive: 0, empathy: 0, composure: 0 }), 2);
  assert.equal(scheme.deceptionFromNature({ drive: 3, empathy: -3, composure: 3 }), 7, "a cold, driven, composed liar");
  assert.equal(scheme.deceptionFromNature({ drive: -3, empathy: 3, composure: -3 }), 0, "an open book");
  const axes = { drive: 1, empathy: -1, composure: 2 };
  assert.equal(scheme.deceptionFromNature(axes), scheme.deceptionFromNature({ ...axes }));
});

// ---- who sees what ----

test("players read the act, the lead included; the one who saw through it reads the truth; the storyteller reads it all", () => {
  const act = scheme.exposeTo(played(-10), ["nysa-sheet"]);
  const bond = { approval: -10, pretense: act };
  const lead = scheme.bondTruthFor({ storyteller: false, ownedCharacterIds: ["bram-sheet"] }, bond);
  assert.equal(lead.approval, 55);
  assert.equal(lead.act, null, "no motive for the lead");
  assert.equal(lead.seenThrough, false);
  const nysa = scheme.bondTruthFor({ storyteller: false, ownedCharacterIds: ["nysa-sheet"] }, bond);
  assert.equal(nysa.approval, -10);
  assert.equal(nysa.seenThrough, true);
  assert.equal(nysa.act, null, "the truth, never the motive");
  const dm = scheme.bondTruthFor({ storyteller: true, ownedCharacterIds: [] }, bond);
  assert.equal(dm.approval, -10);
  assert.equal(dm.act.motive, "the vault key");
  assert.equal(dm.act.shownTier, "friendly");
  assert.deepEqual(dm.act.seenThroughBy, ["nysa-sheet"]);
  const out = scheme.bondTruthFor({ storyteller: false, ownedCharacterIds: [] }, { approval: -10, pretense: scheme.revealPretense(act) });
  assert.equal(out.approval, -10);
  assert.equal(out.unmasked, true);
  assert.equal(out.seenThrough, false, "out to everyone: nobody's private knowledge any more");
  assert.deepEqual(scheme.bondTruthFor({ storyteller: false, ownedCharacterIds: [] }, { approval: 12, pretense: null }), { approval: 12, seenThrough: false, unmasked: false, act: null });
});

test("the DM is told plainly that it is an act, what the table sees, who saw through it, and how to build it", () => {
  const act = played(-10);
  const line = scheme.actLine("Mira", "Kael", act, ["Nysa"]);
  assert.match(line, /Mira's warmth toward Kael is an ACT: the table sees friendly \(\+55\)/);
  assert.match(line, /Motive: the vault key\./);
  assert.match(line, /Seen through by Nysa/);
  assert.match(scheme.actNote("Mira", "Kael", act), /is an act: the table sees friendly \(\+55\)\. Play that/);
  assert.match(scheme.SCHEME_RULES, /check_notice with sense insight and againstMonster set to the schemer.s name/);
  assert.match(scheme.SCHEME_RULES, /relationship_end with reason betrayal and by npc/);
  assert.match(scheme.SCHEME_RULES, /An act starts where they truly stand, and the table sees nothing change until you play it/);
  assert.match(scheme.SCHEME_RULES, /every warm beat lands on the warmth the table sees at its face value/);
  assert.equal(scheme.seenThroughWhisper("Kael", "Mira", "Kael"), "Kael sees through Mira: the warmth Mira shows Kael is an act. Only you know.");
  assert.match(scheme.seenThroughWhisper("Nysa", "Mira", "Kael"), /the warmth Mira shows Kael is an act/);
});

// ---- the storyteller tier ----

const seats = { ownerUserId: "owner", leadUserId: "lead", humanDmUserId: null, assistantDmUserId: null, dmMode: "ai" };

test("at an AI table the lead holds the story's secrets but not the storyteller's", () => {
  const lead = viewer.viewerCaps(seats, "lead");
  assert.equal(lead.secretStory, true);
  assert.equal(lead.storytellerSecrets, false);
  assert.equal(viewer.storytellerSees(lead), false);
  assert.equal(viewer.storytellerSees(viewer.viewerCaps(seats, "someone")), false);
  assert.equal(viewer.storytellerSees(viewer.AI_CAPS), true, "the AI plays the act");
});

test("at a table a person runs, that person is the storyteller; the lead is a player", () => {
  for (const dmMode of ["human", "assisted", "steered"]) {
    const run = { ...seats, dmMode, humanDmUserId: "dm", assistantDmUserId: "co" };
    assert.equal(viewer.storytellerSees(viewer.viewerCaps(run, "dm")), true, dmMode);
    assert.equal(viewer.storytellerSees(viewer.viewerCaps(run, "co")), true, `${dmMode}: the co-DM`);
    assert.equal(viewer.storytellerSees(viewer.viewerCaps(run, "lead")), false, `${dmMode}: the lead`);
  }
});

test("one tag strips a storyteller secret for everyone but the storyteller", () => {
  const items = [{ id: "a" }, { id: "b", secret: viewer.STORYTELLER_SECRET }, { id: "c", secret: null }];
  const lead = viewer.viewerCaps(seats, "lead");
  assert.deepEqual(viewer.withoutStorytellerSecrets(items, lead).map((item) => item.id), ["a", "c"]);
  assert.deepEqual(viewer.withoutStorytellerSecrets(items, viewer.AI_CAPS).map((item) => item.id), ["a", "b", "c"]);
});

test("a storyteller fact: never in a player's view, never in the lead's ?secrets=1, always in the DM's prompt", () => {
  assert.equal(facts.parseKnownBy("storyteller"), "storyteller");
  assert.equal(facts.serializeKnownBy("storyteller"), "storyteller");
  assert.equal(facts.factVisibleTo("storyteller", [], false), false);
  assert.equal(facts.factVisibleTo("storyteller", [], true), false, "the lead's secrets are not enough");
  assert.equal(facts.factVisibleTo("storyteller", [], true, true), true, "the storyteller's are");
  assert.equal(facts.factVisibleTo("dm", [], true, false), true, "a DM secret is the lead's as before");
  assert.equal(facts.isSecretFact("storyteller"), true);
  assert.equal(facts.isSecretFact("party"), false);
  const rendered = facts.renderFactsForPrompt([
    { category: "npc", subject: "Mira", fact: "Mira serves the guild.", pinned: true, knownBy: "storyteller" },
    { category: "npc", subject: "Ilse", fact: "Ilse sells bread.", pinned: true, knownBy: "party" },
  ]);
  assert.match(rendered.dmOnly, /Mira serves the guild/);
  assert.doesNotMatch(rendered.party, /Mira/);
});

test("the Context tab loses a storyteller row and its tokens for the lead, and keeps it for the storyteller", () => {
  const trace = {
    limitTokens: 8000,
    promptTokens: 1000,
    blocks: [
      { id: "game-state", kind: "state", tokens: 700, included: true, reason: "always included", position: 1 },
      { id: "storyteller", kind: "state", tokens: 120, included: true, reason: "secret", position: 2, secret: "storyteller" },
    ],
  };
  const lead = budget.traceForViewer(trace, viewer.viewerCaps(seats, "lead"));
  assert.deepEqual(lead.blocks.map((block) => block.id), ["game-state"]);
  assert.equal(lead.promptTokens, 880);
  assert.equal(budget.traceForViewer(trace, viewer.AI_CAPS), trace, "untouched for the storyteller");
  const plain = { ...trace, blocks: [trace.blocks[0]] };
  assert.equal(budget.traceForViewer(plain, viewer.viewerCaps(seats, "lead")), plain, "nothing to strip, nothing copied");
});

test("a storyteller secret never rides a recap, even the DM's track", () => {
  const material = recap.recapMaterial(
    {
      facts: [
        { subject: "Mira", fact: "Mira serves the guild.", knownBy: "storyteller" },
        { subject: "Ilse", fact: "Ilse fled north.", knownBy: "dm" },
      ],
      quests: [],
      arcs: [],
    },
    true,
  );
  assert.equal(material.facts.length, 1);
  assert.match(material.facts[0], /Ilse fled north/);
});

console.log(`test-schemes: ${passed} passed`);
