// Writing an NPC by hand. The agency model was already rich; what these
// assertions cover is the two things the forge adds on top of it, which are
// the two things a JSON field cannot say: an axis read as a word, and a
// relation read as an edge that knows whether the other side agrees.
// See docs/workshop-plan.md phase 5.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  ATTITUDES,
  AXIS_LABELS,
  BLANK_PERSONALITY,
  FIELD_LABELS,
  GENERATABLE_FIELDS,
  MAX_RELATIONS,
  applyGeneratedField,
  blankDraft,
  cleanSuggestion,
  describeAxis,
  describeNpc,
  describePersonality,
  describeRelation,
  draftFrom,
  normalizeNpcDraft,
  normalizePersonality,
  parsePersonalityWords,
  personalityVocabulary,
  relationGraph,
  removeRelation,
  setRelation,
} = await import("../src/lib/npcs/forge.ts");
const { PERSONALITY_AXES, parseGoals, parseRelations } = await import(
  "../src/lib/dm/npc-logic.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const draftOf = (input) => {
  const result = normalizeNpcDraft(input);
  assert.ok(!result.error, result.error);
  return result.draft;
};

// ---- axes as words ----

test("every axis the engine drifts has a word at both ends", () => {
  for (const axis of PERSONALITY_AXES) {
    assert.ok(AXIS_LABELS[axis], `${axis} has no labels`);
    assert.ok(AXIS_LABELS[axis].low && AXIS_LABELS[axis].high, `${axis} is missing an end`);
  }
});

test("zero on an axis is a real answer, not a missing one", () => {
  // Most people are unremarkable on most axes; a roster where everyone is
  // extreme on all six is a roster of cartoons.
  assert.equal(describeAxis("warmth", 0), "neither");
});

test("an axis reads as an adjective, and hard values read as very", () => {
  assert.equal(describeAxis("warmth", 1), "warm");
  assert.equal(describeAxis("warmth", 3), "very warm");
  assert.equal(describeAxis("warmth", -1), "cold");
  assert.equal(describeAxis("warmth", -3), "very cold");
});

test("an out-of-range axis is clamped rather than described wrongly", () => {
  assert.equal(describeAxis("boldness", 99), "very bold");
  assert.equal(describeAxis("boldness", -99), "very cautious");
});

test("a description names only the axes that say something", () => {
  const personality = { ...BLANK_PERSONALITY, warmth: 2, drive: -1 };
  const described = describePersonality(personality);
  assert.match(described, /very warm/);
  assert.match(described, /content/);
  assert.ok(!described.includes("neither"), "an unremarkable axis was described anyway");
});

test("no personality at all describes as nothing", () => {
  assert.equal(describePersonality(null), "");
  assert.equal(describePersonality(BLANK_PERSONALITY), "");
});

test("garbage in a personality reads as no personality or as zeroes", () => {
  assert.equal(normalizePersonality(null), null);
  assert.equal(normalizePersonality("warm"), null);
  assert.deepEqual(normalizePersonality({ warmth: "hot" }), BLANK_PERSONALITY);
});

// ---- the draft boundary ----

test("an NPC with no name is refused", () => {
  assert.match(normalizeNpcDraft({}).error, /needs a name/i);
  assert.ok(normalizeNpcDraft({ name: "   " }).error);
});

test("an unknown attitude falls back to indifferent, not to nothing", () => {
  assert.equal(draftOf({ name: "Marla", attitude: "furious" }).attitude, "indifferent");
  for (const attitude of ATTITUDES) {
    assert.equal(draftOf({ name: "Marla", attitude }).attitude, attitude);
  }
});

test("an alias that repeats the name is dropped", () => {
  // It would make the entity resolver do redundant work on every mention.
  const draft = draftOf({ name: "Marla Venn", aliases: ["marla venn", "Captain Marla"] });
  assert.deepEqual(draft.aliases, ["Captain Marla"]);
});

test("duplicate aliases collapse", () => {
  const draft = draftOf({ name: "Marla", aliases: ["Cap", "cap", "CAP", "Venn"] });
  assert.deepEqual(draft.aliases, ["Cap", "Venn"]);
});

test("long text is cut rather than refused", () => {
  const draft = draftOf({ name: "M".repeat(500), trait: "t".repeat(500) });
  assert.equal(draft.name.length, 80);
  assert.equal(draft.trait.length, 200);
});

test("a session goal cannot show more progress than it has target", () => {
  // Otherwise the roster reads "5 of 3" and the DM has to work out which
  // number is lying mid-session.
  const draft = draftOf({
    name: "Marla",
    goals: { session: { text: "Buy the harbour watch", progress: 9, target: 3 } },
  });
  assert.equal(draft.goals.session.progress, 3);
  assert.equal(draft.goals.session.target, 3);
});

test("an empty goal is absent rather than empty", () => {
  const draft = draftOf({ name: "Marla", goals: { scene: "   ", ambition: "" } });
  assert.deepEqual(draft.goals, {});
});

test("an NPC cannot hold an opinion about themselves", () => {
  const draft = draftOf({
    name: "Marla",
    relations: [{ npcName: "Marla", score: 3 }, { npcName: "Toma", score: -1 }],
  });
  assert.equal(draft.relations.length, 1);
  assert.equal(draft.relations[0].npcName, "Toma");
});

test("a normalized draft survives the columns it will be stored in", () => {
  // The forge and the parsers in npc-logic.ts have to agree, or a saved NPC
  // reads back different from the one that was written.
  const draft = draftOf({
    name: "Marla",
    goals: { scene: "Get paid", session: { text: "Own the watch", progress: 1, target: 4 } },
    relations: [{ npcName: "Toma", score: -2, note: "took her berth" }],
  });
  assert.deepEqual(parseGoals(JSON.stringify(draft.goals)), draft.goals);
  assert.deepEqual(parseRelations(JSON.stringify(draft.relations)), draft.relations);
});

test("a blank draft is a valid starting point that will not save", () => {
  const blank = blankDraft();
  assert.equal(blank.attitude, "indifferent");
  assert.ok(normalizeNpcDraft(blank).error, "a nameless blank should still be refused");
});

// ---- relations ----

test("a relation score reads as a standing, not a number", () => {
  assert.equal(describeRelation(-3), "sworn enemy");
  assert.equal(describeRelation(0), "neutral");
  assert.equal(describeRelation(3), "devoted");
  assert.equal(describeRelation(99), "devoted", "an out-of-range score should clamp");
});

test("setting a relation twice edits rather than duplicates", () => {
  let relations = setRelation([], "Toma", -2);
  relations = setRelation(relations, "toma", 1, "made peace");
  assert.equal(relations.length, 1);
  assert.equal(relations[0].score, 1);
  assert.equal(relations[0].note, "made peace");
});

test("a nameless relation is ignored", () => {
  assert.deepEqual(setRelation([], "  ", 2), []);
});

test("relations stop at the cap the parser enforces", () => {
  // The panel must not offer to store something the column silently drops.
  let relations = [];
  for (let index = 0; index < MAX_RELATIONS + 5; index += 1) {
    relations = setRelation(relations, `Person ${index}`, 1);
  }
  assert.equal(relations.length, MAX_RELATIONS);
});

test("removing a relation is case-insensitive, like every other name here", () => {
  const relations = setRelation([], "Toma", 2);
  assert.deepEqual(removeRelation(relations, "TOMA"), []);
});

// ---- the graph ----

const roster = [
  { name: "Marla", relations: [{ npcName: "Toma", score: -2, note: "took her berth" }] },
  { name: "Toma", relations: [{ npcName: "Marla", score: 1 }] },
  { name: "Bregan", relations: [{ npcName: "The Drowned King", score: -3 }] },
];

test("a pair appears once, however many directions it was written from", () => {
  const graph = relationGraph(roster);
  const pairs = graph.edges.map((edge) => [edge.from, edge.to].sort().join(" "));
  assert.equal(new Set(pairs).size, pairs.length, "a pair was drawn twice");
});

test("a mutual link keeps both sides, because disagreement is the story", () => {
  const edge = relationGraph(roster).edges.find((entry) => entry.to === "Toma");
  assert.equal(edge.mutual, true);
  assert.equal(edge.score, -2, "Marla's own opinion was lost");
  assert.equal(edge.backScore, 1, "Toma's opinion was lost");
});

test("a one-sided link says so", () => {
  const oneSided = relationGraph([
    { name: "Marla", relations: [{ npcName: "Toma", score: -2 }] },
    { name: "Toma", relations: [] },
  ]);
  assert.equal(oneSided.edges[0].mutual, false);
  assert.equal(oneSided.edges[0].backScore, undefined);
});

test("a link to somebody who is not written yet is shown, not dropped", () => {
  const graph = relationGraph(roster);
  const dangling = graph.edges.find((edge) => edge.to === "The Drowned King");
  assert.equal(dangling.dangling, true);
  const node = graph.nodes.find((entry) => entry.name === "The Drowned King");
  assert.equal(node.known, false, "the unwritten NPC should be on the graph as unknown");
});

test("everyone on the roster is a node even with no relations at all", () => {
  const graph = relationGraph([{ name: "Alone", relations: [] }]);
  assert.deepEqual(graph.nodes, [{ name: "Alone", known: true }]);
  assert.deepEqual(graph.edges, []);
});

test("an empty roster is an empty graph, not a crash", () => {
  assert.deepEqual(relationGraph([]), { nodes: [], edges: [] });
});

// ---- generation, one field at a time ----

test("every generatable field has a label and is a field of the draft", () => {
  for (const field of GENERATABLE_FIELDS) {
    assert.ok(FIELD_LABELS[field], `${field} has no label`);
  }
});

test("generating one field leaves every other field alone", () => {
  // The point of per-field generation: a DM should be able to accept the
  // model's goals and reject its personality.
  const before = draftOf({ name: "Marla", trait: "one eye", location: "the harbour" });
  const after = applyGeneratedField(before, "ambition", "To own the harbour watch outright");
  assert.equal(after.trait, "one eye");
  assert.equal(after.location, "the harbour");
  assert.equal(after.goals.ambition, "To own the harbour watch outright");
});

test("a generated field that comes back empty changes nothing", () => {
  const before = draftOf({ name: "Marla", trait: "one eye" });
  assert.deepEqual(applyGeneratedField(before, "trait", "   "), before);
});

test("a generated session goal keeps the progress already made", () => {
  const before = draftOf({
    name: "Marla",
    goals: { session: { text: "old goal", progress: 2, target: 4 } },
  });
  const after = applyGeneratedField(before, "session", "Buy out the harbourmaster");
  assert.equal(after.goals.session.text, "Buy out the harbourmaster");
  assert.equal(after.goals.session.progress, 2);
  assert.equal(after.goals.session.target, 4);
});

test("a personality comes back as words and becomes axes", () => {
  const personality = parsePersonalityWords("very warm, cautious, meticulous");
  assert.equal(personality.warmth, 2);
  assert.equal(personality.boldness, -1);
  assert.equal(personality.diligence, 1);
  assert.equal(personality.drive, 0, "an axis nobody mentioned should stay neutral");
});

test("words the axes do not know are ignored rather than guessed at", () => {
  assert.equal(parsePersonalityWords("mysterious and brooding"), null);
});

test("a model that says nothing usable leaves the personality alone", () => {
  const before = draftOf({ name: "Marla", personality: { ...BLANK_PERSONALITY, warmth: 2 } });
  const after = applyGeneratedField(before, "personality", "vibes");
  assert.equal(after.personality.warmth, 2);
});

test("the vocabulary handed to the model is the vocabulary the axes use", () => {
  const vocabulary = personalityVocabulary();
  for (const axis of PERSONALITY_AXES) {
    assert.ok(vocabulary.includes(AXIS_LABELS[axis].low), `${axis} low word is not offered`);
    assert.ok(vocabulary.includes(AXIS_LABELS[axis].high), `${axis} high word is not offered`);
  }
});

// ---- cleaning up after the model ----

test("a quoted answer loses its quotes", () => {
  assert.equal(cleanSuggestion('"A harbourmaster\'s ledger, never out of reach."'), "A harbourmaster's ledger, never out of reach.");
});

test("a bulleted or numbered answer loses its bullet", () => {
  assert.equal(cleanSuggestion("- one eye"), "one eye");
  assert.equal(cleanSuggestion("1. one eye"), "one eye");
  assert.equal(cleanSuggestion("2) one eye"), "one eye");
});

test("a model that labels its answer loses the label", () => {
  assert.equal(cleanSuggestion("Trait: one eye"), "one eye");
  assert.equal(cleanSuggestion("Ambition: to own the watch"), "to own the watch");
});

test("a list of options becomes the first one, not all of them", () => {
  // Asked for one line, models routinely give three. Taking the first is a
  // choice; storing all three would put a menu in the NPC's trait field.
  assert.equal(cleanSuggestion("one eye\nsalt-stained coat\na limp"), "one eye");
});

test("leading blank lines are skipped rather than returned", () => {
  assert.equal(cleanSuggestion("\n\n  one eye  "), "one eye");
});

test("nothing at all cleans to nothing, which the caller treats as a failure", () => {
  assert.equal(cleanSuggestion(""), "");
  assert.equal(cleanSuggestion("   \n  "), "");
});

test("a very long answer is cut rather than stored whole", () => {
  assert.equal(cleanSuggestion("x".repeat(900)).length, 300);
});

// ---- reopening a stored NPC ----

test("a stored NPC opens as the draft that wrote them", () => {
  const stored = {
    name: "Marla",
    aliases: ["Cap"],
    attitude: "friendly",
    trait: "one eye",
    location: "the docks",
    agency: {
      personality: { ...BLANK_PERSONALITY, warmth: -2 },
      goals: { scene: "Get paid" },
      relations: [{ npcName: "Toma", score: -2 }],
    },
  };
  const draft = draftFrom(stored);
  assert.equal(draft.name, "Marla");
  assert.equal(draft.attitude, "friendly");
  assert.equal(draft.personality.warmth, -2);
  assert.deepEqual(draft.relations, [{ npcName: "Toma", score: -2 }]);
});

test("editing a reopened draft does not reach back into the stored row", () => {
  const stored = {
    name: "Marla",
    aliases: ["Cap"],
    attitude: "friendly",
    trait: "",
    location: "",
    agency: {
      personality: { ...BLANK_PERSONALITY },
      goals: { session: { text: "Own the watch", progress: 1, target: 3 } },
      relations: [{ npcName: "Toma", score: -2 }],
    },
  };
  const draft = draftFrom(stored);
  draft.aliases.push("Venn");
  draft.relations[0].score = 3;
  draft.goals.session.progress = 9;
  assert.deepEqual(stored.aliases, ["Cap"]);
  assert.equal(stored.agency.relations[0].score, -2);
  assert.equal(stored.agency.goals.session.progress, 1);
});

test("an unknown attitude on a stored row opens as indifferent", () => {
  const draft = draftFrom({
    name: "Marla",
    aliases: [],
    attitude: "smitten",
    trait: "",
    location: "",
    agency: { personality: null, goals: {}, relations: [] },
  });
  assert.equal(draft.attitude, "indifferent");
});

// ---- the roster line ----

test("the roster line is what a DM would say about them at a glance", () => {
  const draft = draftOf({
    name: "Marla",
    trait: "one eye and a harbourmaster's ledger",
    location: "the Saltmarch docks",
    personality: { ...BLANK_PERSONALITY, warmth: -2, drive: 2 },
  });
  const line = describeNpc(draft);
  assert.match(line, /one eye/);
  assert.match(line, /very cold/);
  assert.match(line, /docks/);
});

test("an NPC with nothing written about them has an empty line, not a stub", () => {
  assert.equal(describeNpc(draftOf({ name: "Marla" })), "");
});

console.log(`npc forge: ${passed} assertions passed.`);
