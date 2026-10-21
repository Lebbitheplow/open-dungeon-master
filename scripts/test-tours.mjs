// The guided tours' pure half: which steps survive a page that lacks some
// of their targets, where the card lands, and the once-only flag.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { placeCard, resolveSteps, skipVanished } = await import("../src/lib/tours/logic.ts");
const { finished, legacyKey, mergeLedgers, parseLedger, readDevice, settle, takeLegacy, writeDevice, deviceKey } = await import(
  "../src/lib/tours/account-logic.ts"
);
const { HAND_TUTORIAL_ID, TOUR_IDS, isTourId, tourVersion } = await import("../src/lib/tours/registry.ts");
const { DM_TOUR, FIRST_TURN_TOUR, PLAYER_TOUR } = await import("../src/lib/tours/table.ts");
const { HUB_TOUR, SHELF_TOUR, SYSTEM_TOURS, systemTourId, workshopTourAnchors } = await import(
  "../src/lib/tours/workshop.ts"
);
const { WORKSHOP_GUIDES, guideFor } = await import("../src/lib/tours/workshop-guide.ts");
const { appendTerm, appendLine, collectTags, insertAt } = await import("../src/lib/workshop/pickers.ts");
const { readFileSync, readdirSync, statSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");
const { join } = await import("node:path");

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
    "composer-modes", "composer-input", "composer-talk", "battle-hand", "ask-dm",
    "party-rail", "initiative-ribbon", "quest-glance",
    "tab-party", "tab-story", "tab-map", "tab-battle", "tab-chat", "tab-dm", "tab-world", "tab-settings", "tab-more",
    "header-dice", "header-voice", "header-help", "header-menu", "header-stage", "header-layout",
    "dm-floor", "dm-beats", "dm-delegation", "dm-queue", "dm-console-tabs",
  ]);
  for (const step of [...PLAYER_TOUR, ...DM_TOUR, ...FIRST_TURN_TOUR]) {
    for (const anchor of step.anchors) assert.ok(known.has(anchor), `${step.id}: ${anchor}`);
  }
});

test("the first-turn tour is short: an action, a question, the character, then Help", () => {
  assert.ok(FIRST_TURN_TOUR.length <= 5 && FIRST_TURN_TOUR.length < PLAYER_TOUR.length);
  const present = new Set(["composer-input", "ask-dm", "tab-party", "header-menu"]);
  const out = resolveSteps(FIRST_TURN_TOUR, (anchor) => present.has(anchor));
  assert.deepEqual(
    out.map((entry) => entry.anchor),
    ["", "composer-input", "ask-dm", "tab-party", "header-menu"],
    "a phone finds each step by its other anchor",
  );
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

// Issue 306: which tours a person finished is the account's record; the
// device keeps a copy per account and what it has not yet saved.
const mapStore = () => {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
};
const at = "2026-10-13T00:00:00.000Z";

test("every tour a page opens by itself is in the registry, at a whole version from 1", () => {
  for (const id of ["table-player", "table-dm", "workshop-shelf", "workshop-hub", HAND_TUTORIAL_ID, ...Object.keys(SYSTEM_TOURS).map(systemTourId)]) {
    assert.ok(isTourId(id), `${id} is a known tour`);
    assert.ok(Number.isInteger(tourVersion(id)) && tourVersion(id) >= 1, `${id} has version ${tourVersion(id)}`);
  }
  assert.equal(new Set(TOUR_IDS).size, TOUR_IDS.length, "no tour is listed twice");
  assert.equal(isTourId("app"), false, "the client shell's own tour is not a server tour");
  assert.equal(isTourId("table-player-x"), false);
  assert.equal(isTourId(undefined), false);
});

test("a ledger keeps only known tours with a whole version, and reads either close as finished", () => {
  const ledger = parseLedger(
    {
      "table-player": { version: 1, how: "ended", at },
      "table-dm": { version: 0, how: "done", at },
      "workshop-hub": { version: 1.5 },
      bogus: { version: 3, how: "done", at },
      "workshop-shelf": "done",
      [HAND_TUTORIAL_ID]: { version: 2, how: "weird" },
    },
    isTourId,
  );
  assert.deepEqual(Object.keys(ledger).sort(), [HAND_TUTORIAL_ID, "table-player"].sort());
  assert.equal(ledger["table-player"].how, "ended");
  assert.equal(ledger[HAND_TUTORIAL_ID].how, "done", "an unknown close reads as done");
  assert.deepEqual(parseLedger(null, isTourId), {});
  assert.deepEqual(parseLedger([1, 2], isTourId), {});
  assert.equal(finished(ledger, "table-player", 1), true, "ended early still finishes it");
  assert.equal(finished(ledger, "table-dm", 1), false);
});

test("a revised tour opens again for anyone who finished an older version", () => {
  const ledger = { "table-player": { version: 1, how: "done", at } };
  assert.equal(finished(ledger, "table-player", 1), true);
  assert.equal(finished(ledger, "table-player", 2), false, "version 2 is not finished by a version-1 record");
  assert.equal(finished({ "table-player": { version: 3, how: "done", at } }, "table-player", 2), true);
});

test("merging keeps the higher version and the first record of a tie", () => {
  const a = { "table-player": { version: 1, how: "done", at: "a" }, "table-dm": { version: 2, how: "done", at: "a" } };
  const b = { "table-player": { version: 2, how: "ended", at: "b" }, "table-dm": { version: 2, how: "ended", at: "b" }, "workshop-hub": { version: 1, how: "done", at: "b" } };
  const merged = mergeLedgers(a, b);
  assert.equal(merged["table-player"].version, 2);
  assert.equal(merged["table-player"].at, "b");
  assert.equal(merged["table-dm"].at, "a", "a second finish of the same version keeps the first");
  assert.ok(merged["workshop-hub"]);
  assert.deepEqual(mergeLedgers(), {});
});

test("the device copy is kept per account, and a second account on the machine starts clean", () => {
  const store = mapStore();
  writeDevice(store, "user-a", { done: { "table-player": { version: 1, how: "done", at } }, pending: {} });
  assert.equal(finished(readDevice(store, "user-a", isTourId).done, "table-player", 1), true);
  assert.deepEqual(readDevice(store, "user-b", isTourId), { done: {}, pending: {} });
  assert.ok(store.map.has(deviceKey("user-a")));
  store.map.set(deviceKey("user-c"), "{not json");
  assert.deepEqual(readDevice(store, "user-c", isTourId), { done: {}, pending: {} }, "a broken copy reads as empty");
  const denied = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };
  assert.deepEqual(readDevice(denied, "user-a", isTourId), { done: {}, pending: {} });
  assert.doesNotThrow(() => writeDevice(denied, "user-a", { done: {}, pending: {} }));
});

test("what the account acknowledged leaves pending but stays done; what it ignored stops being sent", () => {
  const device = {
    done: {},
    pending: {
      "table-player": { version: 1, how: "done", at },
      "table-dm": { version: 2, how: "done", at },
      "workshop-hub": { version: 1, how: "ended", at },
    },
  };
  const account = { "table-player": { version: 1, how: "done", at }, "table-dm": { version: 1, how: "done", at } };
  const settled = settle(device, account, ["workshop-hub"]);
  assert.deepEqual(Object.keys(settled.pending), ["table-dm"], "a newer version than the account holds is sent again");
  assert.deepEqual(Object.keys(settled.done).sort(), ["table-dm", "table-player", "workshop-hub"]);
  assert.equal(settled.done["table-dm"].version, 2);
});

test("the old per-browser flags move to the first account and leave the device", () => {
  const store = mapStore();
  store.setItem(legacyKey("table-player"), "done");
  store.setItem(legacyKey("workshop-shelf"), "done");
  store.setItem(legacyKey("table-dm"), "something else");
  store.setItem(legacyKey("app"), "done");
  const taken = takeLegacy(store, TOUR_IDS, at);
  assert.deepEqual(Object.keys(taken).sort(), ["table-player", "workshop-shelf"]);
  assert.equal(taken["table-player"].version, 1);
  assert.equal(store.getItem(legacyKey("table-player")), null, "taken flags are removed");
  assert.equal(store.getItem(legacyKey("app")), "done", "the client shell's own tour flag is left alone");
  assert.deepEqual(takeLegacy(store, TOUR_IDS, at), {}, "a second account finds nothing to take");
});

test("a step whose target vanished is skipped the way the reader was going", () => {
  assert.equal(skipVanished(6, 1, 16), 7);
  assert.equal(skipVanished(6, -1, 16), 5);
  // Backing onto a vanished first step turns round; past the end closes.
  assert.equal(skipVanished(0, -1, 16), 1);
  assert.equal(skipVanished(15, 1, 16), -1);
  assert.equal(skipVanished(0, -1, 1), -1);
});

test("a lazy step survives an absent anchor; a plain one does not", () => {
  const steps = [
    { id: "a", title: "", body: "", anchors: ["gone"] },
    { id: "b", title: "", body: "", anchors: ["gone"], prepare: "open-it", lazy: true },
  ];
  assert.deepEqual(
    resolveSteps(steps, () => false).map((entry) => [entry.step.id, entry.anchor]),
    [["b", "gone"]],
  );
});

// The tools of a workshop, as the shell lists them.
const SYSTEMS = [
  "world", "storyboard", "party", "maps", "region", "encounters", "cast",
  "factions", "bestiary", "homebrew", "lore", "tables", "rules", "plugin", "share",
];

test("every workshop tool has a tour that opens on the rail and ends on help, and a guide", () => {
  for (const system of SYSTEMS) {
    const tour = SYSTEM_TOURS[system];
    assert.ok(tour && tour.length >= 3, `${system} has a tour`);
    assert.deepEqual(tour[0].anchors, ["system-rail"], `${system} opens on the rail`);
    assert.deepEqual(tour[tour.length - 1].anchors, ["system-help"], `${system} ends on help`);
    assert.equal(systemTourId(system), `workshop-${system}`);
    const guide = guideFor(system);
    assert.ok(guide && guide.steps.length >= 2 && guide.purpose, `${system} has a guide`);
  }
  assert.equal(WORKSHOP_GUIDES.length, SYSTEMS.length);
  assert.ok(SHELF_TOUR.length >= 3 && HUB_TOUR.length >= 3);
});

test("every lazy workshop step names the prepare that makes its target appear", () => {
  for (const step of Object.values(SYSTEM_TOURS).flat()) {
    if (step.lazy) assert.ok(step.prepare, `${step.id} is lazy without a prepare`);
  }
});

// Every anchor a workshop tour points at is carried by some component as a
// data-tour attribute (or, for the rail cells, as an IconRail tour name).
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

// fileURLToPath, not .pathname: on Windows the latter hands back
// "/D:/a/..." and readdirSync then resolves it against the drive,
// scanning "D:\\D:\\a\\..." and failing. That is what red the Windows
// smoke run.
const SOURCE = sourceFiles(fileURLToPath(new URL("../src", import.meta.url)))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

test("every table tour anchor exists in the source as data-tour", () => {
  // The session tabs build theirs as data-tour={`tab-${value}`}.
  for (const step of [...PLAYER_TOUR, ...DM_TOUR]) {
    for (const anchor of step.anchors) {
      const carried = SOURCE.includes(`data-tour="${anchor}"`) || anchor.startsWith("tab-");
      assert.ok(carried, `${step.id}: no component carries data-tour="${anchor}"`);
    }
  }
});

test("every workshop tour anchor exists in the source as data-tour", () => {
  const source = SOURCE;
  for (const anchor of workshopTourAnchors()) {
    // As an attribute only: the anchor's name standing anywhere else in a
    // file (a tour's own step, a prepare name) is not a target.
    const carried = source.includes(`data-tour="${anchor}"`) || source.includes(`tour="${anchor}"`);
    assert.ok(carried, `no component carries data-tour="${anchor}"`);
  }
});

test("every prepare a workshop tour sends is answered by some panel", () => {
  for (const step of [...SHELF_TOUR, ...HUB_TOUR, ...Object.values(SYSTEM_TOURS).flat()]) {
    if (!step.prepare) continue;
    // A view of WorldForge is asked for by "world-view-<view>"; anything
    // else by its own name, read by a useTourPrepare handler.
    const view = step.prepare.startsWith("world-view-") ? step.prepare.slice("world-view-".length) : "";
    const answered = view ? SOURCE.includes(`value: "${view}"`) && SOURCE.includes(`name.startsWith("world-view-")`) : SOURCE.includes(`"${step.prepare.split(":")[0]}"`);
    assert.ok(answered, `${step.id}: nothing answers the prepare "${step.prepare}"`);
  }
});

test("the pick-list helpers append without doubling and insert at the caret", () => {
  assert.equal(appendTerm("", "Insight"), "Insight");
  assert.equal(appendTerm("Insight", "Persuasion"), "Insight, Persuasion");
  assert.equal(appendTerm("Insight, ", "insight"), "Insight, ");
  assert.equal(appendTerm("Common, Goblin", "Goblin"), "Common, Goblin");
  assert.equal(appendLine("", "@table: Gems"), "@table: Gems");
  assert.equal(appendLine("1. A rumour\n", "@npc: Marla"), "1. A rumour\n@npc: Marla");
  assert.deepEqual(insertAt("see the mill", 7, "[[The Mill]]"), {
    text: "see the [[The Mill]] mill",
    caret: 20,
  });
  assert.deepEqual(insertAt("", 0, "[[A]]"), { text: "[[A]]", caret: 5 });
  assert.deepEqual(collectTags([{ tags: ["crypt", "Undead"] }, { tags: ["undead", "act two"] }, {}]), [
    "act two",
    "crypt",
    "Undead",
  ]);
});

// A tour whose words or targets change must be raised a version in
// registry.ts, or the people who finished it never see what changed.
// scripts/fixtures/tour-content.json holds each tour's version and a
// fingerprint of its steps as last released. Change a tour, raise its
// version, then record both here (node scripts/test-tours.mjs --record).
// The Hand's card tutorial keeps its steps in its component, so it is not
// fingerprinted here.
const { createHash } = await import("node:crypto");
const TOUR_CONTENT = {
  "table-player": [...PLAYER_TOUR, ...FIRST_TURN_TOUR],
  "table-dm": DM_TOUR,
  "workshop-shelf": SHELF_TOUR,
  "workshop-hub": HUB_TOUR,
  ...Object.fromEntries(Object.entries(SYSTEM_TOURS).map(([system, steps]) => [systemTourId(system), steps])),
};
const fingerprint = (steps) =>
  createHash("sha256")
    .update(JSON.stringify(steps.map(({ id, title, body, anchors, prepare, lazy }) => [id, title, body, anchors, prepare ?? "", Boolean(lazy)])))
    .digest("hex")
    .slice(0, 16);
const recordPath = new URL("./fixtures/tour-content.json", import.meta.url);
if (process.argv.includes("--record")) {
  const { writeFileSync } = await import("node:fs");
  const record = Object.fromEntries(Object.entries(TOUR_CONTENT).map(([id, steps]) => [id, { version: tourVersion(id), content: fingerprint(steps) }]));
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}
`);
  console.log(`recorded ${Object.keys(record).length} tours`);
}
const recorded = JSON.parse(readFileSync(recordPath, "utf8"));

test("a tour whose content changed has its version raised, and the record says so", () => {
  assert.deepEqual(Object.keys(recorded).sort(), Object.keys(TOUR_CONTENT).sort(), "a tour is missing from the record, or the record names one that is gone");
  for (const [id, steps] of Object.entries(TOUR_CONTENT)) {
    const now = { version: tourVersion(id), content: fingerprint(steps) };
    const then = recorded[id];
    if (now.content !== then.content && now.version === then.version) {
      assert.fail(`${id} changed but is still version ${now.version}: raise it in src/lib/tours/registry.ts, then record it`);
    }
    assert.ok(now.version >= then.version, `${id} went back from version ${then.version} to ${now.version}`);
    assert.deepEqual(now, then, `${id} is not recorded as it stands: run node scripts/test-tours.mjs --record`);
  }
});

console.log(`test-tours: ${passed} passed`);
