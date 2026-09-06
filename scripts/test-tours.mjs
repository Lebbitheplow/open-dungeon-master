// The guided tours' pure half: which steps survive a page that lacks some
// of their targets, where the card lands, and the once-only flag.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { markTourSeen, placeCard, resolveSteps, tourSeen } = await import("../src/lib/tours/logic.ts");
const { DM_TOUR, PLAYER_TOUR } = await import("../src/lib/tours/table.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("resolveSteps keeps centred steps, lights the first present anchor, drops the rest", () => {
  const steps = [
    { id: "a", title: "", body: "", anchors: [] },
    { id: "b", title: "", body: "", anchors: ["tab-map", "tab-battle"] },
    { id: "c", title: "", body: "", anchors: ["header-voice"] },
  ];
  const out = resolveSteps(steps, (anchor) => anchor === "tab-battle");
  assert.deepEqual(
    out.map((entry) => [entry.step.id, entry.anchor]),
    [
      ["a", ""],
      ["b", "tab-battle"],
    ],
  );
});

test("a player at a bare table (no maps, no voice, no narration) still gets a tour", () => {
  const present = new Set(["composer-modes", "composer-input", "ask-dm", "tab-party", "tab-story", "tab-chat", "header-dice", "header-help"]);
  const out = resolveSteps(PLAYER_TOUR, (anchor) => present.has(anchor));
  assert.equal(out[0].step.id, "welcome");
  assert.ok(out.every((entry) => entry.anchor === "" || present.has(entry.anchor)));
  assert.ok(!out.some((entry) => entry.step.id === "voice"));
  assert.ok(out.some((entry) => entry.step.id === "dice"));
});

test("the DM tour walks the console top to bottom before the shared tabs", () => {
  const ids = DM_TOUR.map((step) => step.id);
  const console = ids.indexOf("console");
  const floor = ids.indexOf("floor");
  const tools = ids.indexOf("tools");
  const party = ids.indexOf("party");
  assert.ok(console < floor && floor < tools && tools < party);
  // Every console step asks for the DM tab first.
  for (const step of DM_TOUR) {
    if (step.anchors.some((anchor) => anchor.startsWith("dm-"))) {
      assert.equal(step.prepare, "open-dm", step.id);
    }
  }
});

test("every step points at a known anchor or none", () => {
  const known = new Set([
    "composer-modes", "composer-input", "composer-talk", "ask-dm",
    "tab-party", "tab-story", "tab-map", "tab-battle", "tab-chat", "tab-dm",
    "header-dice", "header-voice", "header-help",
    "dm-floor", "dm-beats", "dm-delegation", "dm-queue", "dm-console-tabs",
  ]);
  for (const step of [...PLAYER_TOUR, ...DM_TOUR]) {
    for (const anchor of step.anchors) assert.ok(known.has(anchor), `${step.id}: ${anchor}`);
  }
});

const VIEW = { width: 400, height: 800 };
const CARD = { width: 300, height: 160 };

test("placeCard centres with no target and never leaves the viewport", () => {
  assert.deepEqual(placeCard(null, CARD, VIEW), { top: 320, left: 50, side: "center" });
  const edge = placeCard({ top: 20, left: 380, width: 20, height: 20 }, CARD, VIEW);
  assert.ok(edge.left + CARD.width + 12 <= VIEW.width && edge.left >= 12);
});

test("placeCard goes below a target near the top, above one near the bottom", () => {
  assert.equal(placeCard({ top: 20, left: 40, width: 100, height: 40 }, CARD, VIEW).side, "below");
  assert.equal(placeCard({ top: 720, left: 40, width: 100, height: 40 }, CARD, VIEW).side, "above");
});

test("tourSeen round-trips and a broken store counts as seen", () => {
  const map = new Map();
  const store = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
  assert.equal(tourSeen(store, "table-player"), false);
  markTourSeen(store, "table-player");
  assert.equal(tourSeen(store, "table-player"), true);
  assert.equal(tourSeen(store, "table-dm"), false);
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(tourSeen(broken, "x"), true);
  assert.doesNotThrow(() => markTourSeen(broken, "x"));
});

console.log(`test-tours: ${passed} passed`);
