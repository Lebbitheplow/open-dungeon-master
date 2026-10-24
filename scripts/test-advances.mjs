// NPCs who make the first move, and who a character is drawn to (issue 501),
// the pure half: attraction matching both ways, the roll's clamp and its
// cadence, cooldowns and windows, who may court whom (exclusivity, presence,
// companions and guests), the table's safety tools, who answers, and what
// the DM and the Director are told.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const attraction = await import("../src/lib/attraction.ts");
const logic = await import("../src/lib/dm/advance-logic.ts");
const director = await import("../src/lib/dm/director-logic.ts");
const profiles = await import("../src/lib/dm/tool-profiles.ts");
const view = await import("../src/lib/dm/sheet-view.ts");

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

// ---- who a character is drawn to ----

test("an attraction reads back as known genders and a trimmed note, anything else as blank", () => {
  const read = attraction.normalizeAttraction({ genders: ["Male", "Robot", "Male", "Female"], note: `  only   the ${"x".repeat(80)}` });
  assert.deepEqual(read.genders, ["Female", "Male"], "unknown dropped, repeats folded, in the fixed order");
  assert.equal(read.note.length, attraction.ATTRACTION_NOTE_MAX);
  assert.ok(read.note.startsWith("only the x"), "inner space folded");
  assert.deepEqual(attraction.normalizeAttraction('{"genders":["Nonbinary"],"note":""}'), { genders: ["Nonbinary"], note: "" });
  assert.deepEqual(attraction.normalizeAttraction("not json"), { genders: [], note: "" });
  assert.deepEqual(attraction.normalizeAttraction(""), { genders: [], note: "" });
  assert.deepEqual(attraction.normalizeAttraction(null), { genders: [], note: "" });
  assert.equal(attraction.attractionBlank(attraction.normalizeAttraction(undefined)), true);
  assert.equal(attraction.attractionBlank({ genders: [], note: "kind people" }), false);
  assert.equal(attraction.attractionJson({ genders: [], note: "" }), "", "a blank one stores as nothing");
});

test("blank fits anyone; a chosen set fits only its genders; an unspecified gender fits only blank", () => {
  const blank = { genders: [], note: "" };
  const women = { genders: ["Female"], note: "" };
  assert.equal(attraction.drawnTo(blank, "Male"), true);
  assert.equal(attraction.drawnTo(blank, ""), true);
  assert.equal(attraction.drawnTo(undefined, "Nonbinary"), true);
  assert.equal(attraction.drawnTo(women, "Female"), true);
  assert.equal(attraction.drawnTo(women, "Male"), false);
  assert.equal(attraction.drawnTo(women, ""), false, "the server never guesses a gender");
  assert.equal(attraction.drawnTo({ genders: [], note: "the brave" }, "Male"), true, "a note alone limits nothing");
});

test("an attraction fits both ways or not at all", () => {
  const mira = { gender: "Female", attraction: { genders: ["Male"], note: "" } };
  const kael = { gender: "Male", attraction: { genders: [], note: "" } };
  const sera = { gender: "Female", attraction: { genders: ["Female"], note: "" } };
  assert.equal(attraction.attractionFits(mira, kael), true);
  assert.equal(attraction.attractionFits(kael, mira), true);
  assert.equal(attraction.attractionFits(mira, sera), false, "Mira is drawn to men only");
  assert.equal(attraction.attractionFits(sera, { gender: "Male", attraction: null }), false, "Sera is drawn to women only");
});

test("the DM reads an attraction in words, and a tool's words become one", () => {
  assert.equal(attraction.attractionWords({ genders: ["Female", "Nonbinary"], note: "" }), "women and nonbinary people");
  assert.equal(attraction.attractionWords({ genders: ["Female", "Male", "Nonbinary"], note: "rarely" }), "women, men and nonbinary people (rarely)");
  assert.equal(attraction.attractionWords({ genders: [], note: "whoever makes them laugh" }), "whoever makes them laugh");
  assert.equal(attraction.attractionWords({ genders: [], note: "" }), "");
  assert.deepEqual(attraction.attractionFromTold(["men", "Women", "elves"]), { genders: ["Female", "Male"], note: "" });
  assert.deepEqual(attraction.attractionFromTold(["Nonbinary"]), { genders: ["Nonbinary"], note: "" });
  assert.equal(attraction.attractionFromTold([]), null, "nothing said is nothing written");
  assert.equal(attraction.attractionFromTold(undefined), null);
});

// ---- the roll ----

test("the chance is 10 plus 5 per point of Charisma modifier, clamped to 5 and 35", () => {
  assert.equal(logic.advanceChance(0), 10);
  assert.equal(logic.advanceChance(3), 25);
  assert.equal(logic.advanceChance(5), 35);
  assert.equal(logic.advanceChance(9), 35, "clamped high");
  assert.equal(logic.advanceChance(-1), 5);
  assert.equal(logic.advanceChance(-5), 5, "clamped low");
  assert.equal(logic.advanceRollSucceeds(25, 3), true, "at the chance succeeds");
  assert.equal(logic.advanceRollSucceeds(26, 3), false, "one over fails");
  assert.equal(logic.advanceRollSucceeds(1, -5), true);
});

test("a pair rolls on every 8th AI turn, never inside its cooldown", () => {
  assert.equal(logic.ADVANCE_EVERY, 8);
  assert.equal(logic.rollDue(0, 0), false, "no turn has finished");
  assert.equal(logic.rollDue(7, 0), false);
  assert.equal(logic.rollDue(8, 0), true);
  assert.equal(logic.rollDue(16, 20), false, "cooling down");
  assert.equal(logic.rollDue(24, 20), true, "the cooldown is over");
  assert.equal(logic.DECLINE_COOLDOWN, 24);
});

test("a window opened after turn 8 is open for the next three AI turns and then closes", () => {
  const until = 8 + logic.ADVANCE_WINDOW;
  assert.equal(logic.windowOpen(until, 8), true);
  assert.equal(logic.windowTurnsLeft(until, 8), 3);
  assert.equal(logic.windowOpen(until, 10), true);
  assert.equal(logic.windowTurnsLeft(until, 10), 1);
  assert.equal(logic.windowOpen(until, 11), false);
  assert.equal(logic.windowOpen(0, 0), false, "none was ever opened");
});

// ---- the table's own limits ----

test("one word list for lines and veils, matched at the start of a word", () => {
  for (const said of ["Romance", "no romantic subplots", "Flirting", "seduction", "love interests"]) {
    assert.equal(logic.namesRomance(said), true, said);
  }
  for (const said of ["spiders", "aromantic characters", "gore"]) {
    assert.equal(logic.namesRomance(said), false, said);
  }
});

test("a family table, or a line or veil naming romance, rules advances out", () => {
  assert.match(logic.romanceSafetyBlock({ boundaries: "family", lines: [], veils: [] }), /family table/);
  assert.match(logic.romanceSafetyBlock({ boundaries: "standard", lines: ["romance"], veils: [] }), /line at "romance"/);
  assert.match(logic.romanceSafetyBlock({ boundaries: "mature", lines: [], veils: ["Seduction scenes"] }), /veiled "Seduction scenes"/);
  assert.equal(logic.romanceSafetyBlock({ boundaries: "standard", lines: ["spiders"], veils: ["torture"] }), null);
  assert.equal(logic.romanceSafetyBlock(undefined), null);
});

// ---- presence ----

test("an NPC is in the scene where the party is, or when the narration names them", () => {
  assert.equal(logic.presentInScene({ name: "Mira", location: "Highmoor" }, "Highmoor", ""), true);
  assert.equal(logic.presentInScene({ name: "Mira", location: "the Gilded Goose, Highmoor" }, "Highmoor", ""), true);
  assert.equal(logic.presentInScene({ name: "Mira", location: "Highmoor" }, "Low Fen", ""), false);
  assert.equal(logic.presentInScene({ name: "Mira", location: "" }, "Low Fen", "Mira waves from the dock."), true);
  assert.equal(logic.presentInScene({ name: "Mira", location: "" }, "", "Miranda waves."), false, "a whole name, never part of another");
});

// ---- who may court whom ----

const kael = { name: "Kael", gender: "Male", attraction: null, open: true, isCompanion: false };
const mira = {
  name: "Mira",
  kind: "npc",
  present: true,
  status: "active",
  approval: 60,
  romance: "none",
  warmth: 1,
  gender: "Female",
  attraction: { genders: ["Male"], note: "" },
  committedElsewhere: false,
  pendingAdvance: false,
};

test("a suitor who likes them enough, in the scene, free and drawn both ways may court", () => {
  assert.equal(logic.suitorProblem(mira, kael), null);
  assert.equal(logic.suitorProblem({ ...mira, romance: "interested" }, kael), null, "an unspoken pull may become the open step");
});

test("every rule says why it refuses", () => {
  const cases = [
    [{ ...mira }, { ...kael, open: false }, /has not opened Kael/],
    [{ ...mira }, { ...kael, isCompanion: true }, /no player answers for them/],
    [{ ...mira }, { ...kael, awaiting: true }, /already has an advance waiting/],
    [{ ...mira, kind: "companion", companionKind: "guest" }, kael, /guest ally/],
    [{ ...mira, status: "parted" }, kael, /not with the party/],
    [{ ...mira, present: false }, kael, /not in this scene/],
    [{ ...mira, romance: "courting" }, kael, /past the first move/],
    [{ ...mira, approval: 54 }, kael, /courting needs 55/],
    [{ ...mira, committedElsewhere: true }, kael, /already with someone else/],
    [{ ...mira, pendingAdvance: true }, kael, /already has an advance waiting/],
    [{ ...mira, attraction: { genders: ["Female"], note: "" } }, kael, /not drawn to each other/],
    [{ ...mira }, { ...kael, attraction: { genders: ["Male"], note: "" } }, /not drawn to each other/],
  ];
  for (const [suitor, target, why] of cases) {
    assert.match(logic.suitorProblem(suitor, target) ?? "", why);
  }
});

test("a lasting companion may court; the best suitor is who feels most, then the warmest, then by name", () => {
  const brannoc = { ...mira, name: "Brannoc", kind: "companion", companionKind: "party", approval: 60, warmth: 2 };
  const ilse = { ...mira, name: "Ilse", approval: 70, warmth: -2 };
  assert.equal(logic.suitorProblem(brannoc, kael), null);
  assert.equal(logic.pickSuitor([mira, brannoc, ilse], kael).name, "Ilse", "most approval first");
  assert.equal(logic.pickSuitor([mira, brannoc], kael).name, "Brannoc", "then warmth");
  assert.equal(logic.pickSuitor([{ ...mira, name: "Zed" }, { ...mira, name: "Ada" }], kael).name, "Ada", "then the name");
  assert.equal(logic.pickSuitor([{ ...mira, approval: 20 }], kael), null, "nobody eligible");
});

test("an NPC's move needs the open window, except from a person running the table", () => {
  const check = { windowOpen: false, fromConsole: false, safety: null, to: "courting" };
  assert.match(logic.npcAdvanceProblem(mira, kael, check), /only the server opens that moment/);
  assert.equal(logic.npcAdvanceProblem(mira, kael, { ...check, windowOpen: true }), null);
  assert.equal(logic.npcAdvanceProblem(mira, kael, { ...check, fromConsole: true }), null, "the human DM's console, same rules, no window");
  assert.match(logic.npcAdvanceProblem(mira, kael, { ...check, windowOpen: true, to: "married" }), /always the open step to courting/);
  assert.match(logic.npcAdvanceProblem(mira, kael, { ...check, windowOpen: true, safety: "This is a family table, so no NPC makes a romantic advance." }), /family table/);
  assert.match(logic.npcAdvanceProblem(mira, { ...kael, open: false }, { ...check, fromConsole: true }), /has not opened/, "the console still needs the opt-in");
});

test("only the character's own player answers an advance; the lead may only withdraw it", () => {
  assert.equal(logic.canResolveAdvance("approve", true, false), true);
  assert.equal(logic.canResolveAdvance("decline", true, false), true);
  assert.equal(logic.canResolveAdvance("approve", false, true), false, "the lead never answers for them");
  assert.equal(logic.canResolveAdvance("decline", false, true), false);
  assert.equal(logic.canResolveAdvance("cancel", false, true), true);
  assert.equal(logic.canResolveAdvance("cancel", true, false), false, "the player declines instead");
});

// ---- what the DM is told ----

test("the DM's cue names the move and never the answer", () => {
  const cue = logic.advanceCue("Mira", "Kael", 3);
  assert.match(cue, /Mira is ready to make a romantic move toward Kael/);
  assert.match(cue, /romance_advance with initiator npc/);
  assert.match(cue, /Never decide how Kael feels/);
  assert.match(logic.advanceCue("Mira", "Kael", 1), /last reply/);
  assert.doesNotMatch(cue, /drawnTo/, "nothing to settle when she is decided");
  assert.match(logic.advanceCue("Mira", "Kael", 2, true), /settle it with set_npc drawnTo, and it stays/, "an undecided suitor is settled once");
  assert.equal(logic.advanceSummary("Mira", "Kael"), "Mira asks to court Kael");
});

test("each answer is told to the DM as itself", () => {
  assert.match(logic.advanceResolutionNote("approved", "Mira", "Kael"), /Kael said yes to Mira: they are now openly courting/);
  assert.match(logic.advanceResolutionNote("declined", "Mira", "Kael"), /Kael turned Mira down/);
  assert.match(logic.advanceResolutionNote("expired", "Mira", "Kael"), /no answer/);
  assert.match(logic.advanceResolutionNote("cancelled", "Mira", "Kael"), /withdrawn/);
});

test("the relationship rules change only while somebody is open, and only at a table that allows it", () => {
  assert.equal(logic.advanceRulesLine([]), "");
  assert.match(logic.advanceRulesLine(["Kael"]), /Kael is open to advances/);
  assert.match(logic.advanceRulesLine(["Kael", "Nysa"]), /Kael, Nysa are open/);
  const sheets = [
    { name: "Kael", isCompanion: false, openToAdvances: true },
    { name: "Nysa", isCompanion: false, openToAdvances: false },
    { name: "Brannoc", isCompanion: true, openToAdvances: true },
  ];
  const settings = { relationships: "on", romance: "on", safety: { boundaries: "standard", lines: [], veils: [] } };
  assert.deepEqual(logic.openToAdvanceNames({ gameSettings: settings }, sheets), ["Kael"], "never a companion");
  assert.deepEqual(logic.openToAdvanceNames({ gameSettings: { ...settings, romance: "off" } }, sheets), []);
  assert.deepEqual(logic.openToAdvanceNames({ gameSettings: { ...settings, safety: { boundaries: "family" } } }, sheets), []);
});

// ---- the Director's Romance cue ----

test("the Romance cue is offered only where romance is played and the safety tools allow it", () => {
  const on = { relationships: "on", romance: "on", safety: { boundaries: "standard", lines: [], veils: [] } };
  assert.equal(director.romanceCueAllowed(on), true);
  assert.equal(director.romanceCueAllowed({ ...on, romance: "off" }), false);
  assert.equal(director.romanceCueAllowed({ ...on, relationships: "off" }), false);
  assert.equal(director.romanceCueAllowed({ ...on, safety: { boundaries: "family" } }), false);
  assert.ok(director.availableOneShots(on).includes("romance"));
  assert.ok(!director.availableOneShots({ ...on, romance: "off" }).includes("romance"));
  const armed = { oneShot: "romance", absoluteCommand: "" };
  assert.equal(director.buildDirectorBlock(armed, { ...on, romance: "off" }), "", "a cue armed before romance went off is dropped");
  assert.match(director.buildDirectorBlock(armed, on), /open to advances from NPCs/, "toward a character open to advances, or interest shown only");
  assert.match(director.buildDirectorBlock(armed), /romantic beat/, "the preview without settings is unchanged");
});

// ---- small models ----

test("an open window offers the relationships group to a compact call", () => {
  assert.ok(profiles.autoGroups({ inEncounter: false, advanceReady: true }).has("relationships"));
  assert.ok(!profiles.autoGroups({ inEncounter: false }).has("relationships"));
});

// ---- privacy ----

test("the opt-in is blanked for everyone but the owner and a DM seat, like the notes", () => {
  const sheet = { id: "s1", userId: "kael-player", notes: "", openToAdvances: true };
  assert.equal(view.publicSheet(sheet).openToAdvances, false);
  const ai = { dmMode: "ai", humanDmUserId: "", assistantDmUserId: "" };
  assert.equal(view.sheetForViewer(sheet, ai, "kael-player").openToAdvances, true, "the owner");
  assert.equal(view.sheetForViewer(sheet, ai, "lead").openToAdvances, false, "the lead of an AI table");
  const human = { dmMode: "human", humanDmUserId: "dm", assistantDmUserId: "" };
  assert.equal(view.sheetForViewer(sheet, human, "dm").openToAdvances, true, "a person running the table");
  const closed = { id: "s2", userId: "x", notes: "", openToAdvances: false };
  assert.equal(view.publicSheet(closed), closed, "nothing to blank, nothing copied");
});

console.log(`test-advances: ${passed} passed`);
