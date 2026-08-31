// The storyboard: the graph, the suggestions, and what the board compiles
// into at the campaign end.
//
// Two things here are worth more than the rest. The suggestions, because
// they are arithmetic rather than a model call and therefore can be asserted
// at all. And the compile, because it is the test of whether the node kinds
// were chosen correctly: every kind has to land somewhere that already
// exists, and a kind that compiles into nothing should not exist.
// See docs/workshop-plan.md phase 7.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  BEAT_KINDS,
  BEAT_HINTS,
  BEAT_LABELS,
  MAX_EDGES,
  MAX_SUGGESTIONS,
  boardGraph,
  checkBeat,
  emptyInventory,
  normalizeBeatKind,
  normalizeLinks,
  suggestTopics,
} = await import("../src/lib/workshop/board.ts");
const { MIN_ARC_BEATS, compileBoard, summarizeCompile } = await import(
  "../src/lib/workshop/board-compile.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

let next = 0;
function card(kind, title, overrides = {}) {
  next += 1;
  return {
    id: overrides.id ?? `b${next}`,
    kind,
    title,
    body: "",
    links: {},
    edges: [],
    x: 0,
    y: 0,
    ...overrides,
  };
}

// ---- the shape of a card ----

test("every kind has a label and a hint, so none needs documentation", () => {
  for (const kind of BEAT_KINDS) {
    assert.ok(BEAT_LABELS[kind], `${kind} has no label`);
    assert.ok(BEAT_HINTS[kind], `${kind} has no hint`);
    // The hint says where the card lands, which is the only thing a DM
    // choosing between seven kinds actually needs to know.
    assert.match(BEAT_HINTS[kind], /Becomes/);
  }
});

test("a card needs a title and nothing else", () => {
  assert.ok("error" in checkBeat({ title: "  " }));
  const checked = checkBeat({ title: "The mill" });
  assert.equal(checked.beat.title, "The mill");
  assert.equal(checked.beat.body, "");
  // The board is where half-formed ideas go. A form that refuses one is a
  // form a DM stops opening.
  assert.deepEqual(checked.beat.links, {});
});

test("an unknown kind reads as something happening rather than throwing", () => {
  assert.equal(normalizeBeatKind("nonsense"), "event");
  assert.equal(normalizeBeatKind("secret"), "secret");
});

test("links keep only the four fields, and only when they are set", () => {
  const links = normalizeLinks({ npcId: "n1", mapId: "", nonsense: "x", locationId: "l1" });
  assert.deepEqual(links, { npcId: "n1", locationId: "l1" });
});

test("edges are bounded and deduplicated", () => {
  const checked = checkBeat({
    title: "Busy",
    edges: ["a", "a", "b", ...Array.from({ length: 20 }, (_, i) => `x${i}`)],
  });
  assert.ok(checked.beat.edges.length <= MAX_EDGES);
  assert.equal(new Set(checked.beat.edges).size, checked.beat.edges.length);
});

// ---- the graph ----

test("edges point both ways once the graph is built", () => {
  const a = card("hook", "A rumour", { id: "a", edges: ["b"] });
  const b = card("event", "What is true", { id: "b" });
  const board = boardGraph([a, b]);
  assert.deepEqual(board.nodes.find((n) => n.id === "a").out, ["b"]);
  assert.deepEqual(board.nodes.find((n) => n.id === "b").in, ["a"]);
});

test("an arrow to a deleted card is dropped and counted, not drawn to nowhere", () => {
  const board = boardGraph([card("hook", "Dangling", { id: "a", edges: ["gone"] })]);
  assert.deepEqual(board.nodes[0].out, []);
  assert.equal(board.brokenEdges, 1);
});

test("a card cannot point at itself", () => {
  const board = boardGraph([card("event", "Ouroboros", { id: "a", edges: ["a"] })]);
  assert.deepEqual(board.nodes[0].out, []);
});

test("reading order follows the arrows from the beginning of a chain", () => {
  const board = boardGraph([
    card("event", "Third", { id: "c" }),
    card("hook", "First", { id: "a", edges: ["b"] }),
    card("event", "Second", { id: "b", edges: ["c"] }),
  ]);
  assert.deepEqual(board.order, ["a", "b", "c"]);
});

test("a board that is all cycles still produces an order", () => {
  // A board is a graph a person drew, so it can loop. The answer wanted is
  // the order the cards read in, not a proof that the story is acyclic.
  const board = boardGraph([
    card("event", "A", { id: "a", edges: ["b"] }),
    card("event", "B", { id: "b", edges: ["a"] }),
  ]);
  assert.equal(board.order.length, 2);
  assert.equal(new Set(board.order).size, 2);
});

// ---- suggestions ----

test("an empty board suggests nothing, because there is nothing to notice", () => {
  assert.deepEqual(suggestTopics([], emptyInventory()), []);
});

test("a board with no reason to go says so first", () => {
  const suggestions = suggestTopics(
    [card("setting", "The mill"), card("event", "The wheel stops")],
    emptyInventory(),
  );
  assert.equal(suggestions[0].id, "missing:hook");
  assert.equal(suggestions[0].kind, "hook");
});

test("a hook with nothing after it is a promise with no payoff", () => {
  const suggestions = suggestTopics(
    [
      card("setting", "The mill", { id: "s" }),
      card("hook", "A missing daughter", { id: "h" }),
    ],
    emptyInventory(),
  );
  const payoff = suggestions.find((entry) => entry.id === "payoff:h");
  assert.ok(payoff, "a dangling hook went unnoticed");
  assert.equal(payoff.kind, "event");
  assert.match(payoff.reason, /A missing daughter/);
});

test("a fight nothing leads to wants a reason to be in it", () => {
  const suggestions = suggestTopics(
    [
      card("hook", "Go to the mill", { id: "h", edges: ["e"] }),
      card("setting", "The mill", { id: "s" }),
      card("encounter", "Wolves in the yard", { id: "f" }),
      card("event", "The wheel stops", { id: "e" }),
    ],
    emptyInventory(),
  );
  assert.ok(suggestions.some((entry) => entry.id === "reason:f"));
});

test("a secret nothing reveals is scenery", () => {
  const suggestions = suggestTopics(
    [
      card("hook", "Go", { id: "h", edges: ["e"] }),
      card("event", "Something", { id: "e" }),
      card("setting", "Here", { id: "s" }),
      card("secret", "The miller did it", { id: "x" }),
    ],
    emptyInventory(),
  );
  const reveal = suggestions.find((entry) => entry.id === "reveal:x");
  assert.ok(reveal);
  assert.match(reveal.reason, /never learns/);
});

test("something written in the workshop that the board never uses is noticed", () => {
  // The check a DM cannot do by eye once the workshop has thirty NPCs.
  const suggestions = suggestTopics(
    [
      card("hook", "Go", { id: "h", edges: ["e"] }),
      card("setting", "Here", { id: "s" }),
      card("event", "Something", { id: "e", links: { npcId: "npc-1" } }),
    ],
    {
      ...emptyInventory(),
      npcs: [
        { id: "npc-1", name: "Marla" },
        { id: "npc-2", name: "The smith" },
      ],
    },
  );
  assert.ok(suggestions.some((entry) => entry.id === "unused:npcs:npc-2"));
  // Marla IS used, so she is not suggested.
  assert.ok(!suggestions.some((entry) => entry.id === "unused:npcs:npc-1"));
});

test("suggestions are ranked and capped", () => {
  const suggestions = suggestTopics(
    Array.from({ length: 30 }, (_, index) => card("hook", `Hook ${index}`)),
    emptyInventory(),
  );
  assert.ok(suggestions.length <= MAX_SUGGESTIONS);
  for (let index = 1; index < suggestions.length; index += 1) {
    assert.ok(suggestions[index - 1].weight >= suggestions[index].weight);
  }
});

test("suggestion ids are stable across a reorder, so they can be acted on", () => {
  const cards = [
    card("hook", "A", { id: "h" }),
    card("setting", "B", { id: "s" }),
    card("secret", "C", { id: "x" }),
  ];
  const first = suggestTopics(cards, emptyInventory()).map((entry) => entry.id).sort();
  const second = suggestTopics([...cards].reverse(), emptyInventory())
    .map((entry) => entry.id)
    .sort();
  assert.deepEqual(first, second);
});

test("places and history are allowed to sit on their own", () => {
  // A board of nothing but a place and its history is a legitimate early
  // board. Flagging both as unconnected would make the panel noise.
  const suggestions = suggestTopics(
    [card("setting", "The mill"), card("backstory", "The flood")],
    emptyInventory(),
  );
  assert.ok(!suggestions.some((entry) => entry.id.startsWith("link:")));
});

// ---- the compile ----

const board = [
  card("backstory", "The flood", { id: "bs", body: "The river took the lower village." }),
  card("setting", "The mill", { id: "st", body: "Half-drowned and still turning." }),
  card("hook", "A missing daughter", { id: "h", edges: ["e1"] }),
  card("event", "The wheel stops", { id: "e1", body: "Something is jamming it.", edges: ["f"] }),
  card("encounter", "Wolves in the yard", { id: "f", body: "Three of them, hungry." }),
  card("secret", "The miller did it", { id: "x", body: "For the insurance." }),
  card("npc_moment", "Marla confesses", { id: "m" }),
];

test("every kind lands somewhere, which is the test of the kind list", () => {
  const compiled = compileBoard(board);
  assert.equal(compiled.lore.length, 2);
  assert.equal(compiled.quests.length, 1);
  assert.equal(compiled.encounters.length, 1);
  assert.equal(compiled.notes.length, 1);
  // event and npc_moment both become arc beats.
  assert.equal(compiled.arcBeats.length, 2);
  const landed =
    compiled.lore.length +
    compiled.quests.length +
    compiled.encounters.length +
    compiled.notes.length +
    compiled.arcBeats.length;
  assert.equal(landed, board.length, "a card compiled into nothing");
});

test("history and places keep the right lore category", () => {
  const compiled = compileBoard(board);
  assert.equal(compiled.lore.find((entry) => entry.title === "The flood").category, "history");
  assert.equal(compiled.lore.find((entry) => entry.title === "The mill").category, "geography");
});

test("a secret becomes a DM-only note and nothing the party can read", () => {
  const compiled = compileBoard(board);
  assert.equal(compiled.notes.length, 1);
  assert.equal(compiled.notes[0].title, "The miller did it");
  // It must not also appear anywhere readable.
  assert.ok(!compiled.lore.some((entry) => entry.title === "The miller did it"));
  assert.ok(!compiled.quests.includes("The miller did it"));
  assert.ok(!compiled.arcBeats.some((beat) => beat.includes("The miller did it")));
});

test("an arc beat folds the body in behind the title", () => {
  const compiled = compileBoard(board);
  assert.ok(compiled.arcBeats.includes("The wheel stops: Something is jamming it."));
  // A card with no body is just its title.
  assert.ok(compiled.arcBeats.includes("Marla confesses"));
});

test("the premise comes from the board rather than being invented", () => {
  const compiled = compileBoard(board);
  assert.match(compiled.premise, /The flood/);
  // With no history, a place will do.
  assert.match(compileBoard([card("setting", "The mill")]).premise, /The mill/);
  // With neither, there is no premise and the arc cannot be written.
  assert.equal(compileBoard([card("hook", "Go")]).premise, "");
});

test("arc beats come out in the order the arrows say, not the order typed", () => {
  const compiled = compileBoard([
    card("event", "Last", { id: "z" }),
    card("event", "First", { id: "a", edges: ["b"] }),
    card("event", "Middle", { id: "b", edges: ["z"] }),
    card("setting", "Somewhere", { id: "s" }),
  ]);
  assert.deepEqual(compiled.arcBeats, ["First", "Middle", "Last"]);
});

test("emptyKinds counts cards, not output, so shared destinations do not hide gaps", () => {
  // event and npc_moment both become arc beats. A board with events and no
  // character moments is still missing character moments.
  const compiled = compileBoard([card("event", "Something"), card("setting", "Here")]);
  assert.ok(compiled.emptyKinds.includes("npc_moment"));
  assert.ok(!compiled.emptyKinds.includes("event"));
});

// ---- what the import will say ----

test("the summary lists what will be created", () => {
  const summary = summarizeCompile(compileBoard(board), false);
  assert.ok(summary.lines.some((line) => /lore entries/.test(line)));
  assert.ok(summary.lines.some((line) => /prepared encounter/.test(line)));
  assert.ok(summary.lines.some((line) => /story arc of 2 beats/.test(line)));
  assert.equal(summary.arcRefusal, "");
});

test("a campaign with an arc keeps it, and is told so before the button", () => {
  // Overwriting a spine the table has been playing would delete the
  // campaign's memory of itself. Everything else still lands.
  const summary = summarizeCompile(compileBoard(board), true);
  assert.match(summary.arcRefusal, /already has a story arc/);
  assert.ok(!summary.lines.some((line) => /story arc/.test(line)));
  assert.ok(summary.lines.length > 0, "the rest of the board was refused too");
});

test("too few beats refuses the arc and says how many are needed", () => {
  const thin = compileBoard([card("setting", "Here"), card("event", "One thing")]);
  const summary = summarizeCompile(thin, false);
  assert.match(summary.arcRefusal, new RegExp(`at least ${MIN_ARC_BEATS}`));
});

test("no premise refuses the arc with the fix rather than an error", () => {
  const summary = summarizeCompile(
    compileBoard([card("event", "A"), card("event", "B")]),
    false,
  );
  assert.match(summary.arcRefusal, /Add a place or a piece of history/);
});

console.log(`workshop board: ${passed} assertions passed.`);
