// NPC knowledge boundaries: who was present for what, and what that lets
// an NPC reference.
import assert from "node:assert/strict";
import {
  detectWitnesses,
  isPublicCategory,
  mergeWitnesses,
  normalizeWitnesses,
  npcCouldKnow,
  parseWitnesses,
  renderWitnessNote,
  serializeWitnesses,
} from "../src/lib/dm/witness-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const roster = [
  { name: "Marla Venn", aliases: ["Marla"] },
  { name: "Aldric", aliases: [] },
  { name: "Bo", aliases: [] },
];

test("normalizeWitnesses dedupes case-insensitively and bounds", () => {
  assert.deepEqual(normalizeWitnesses(["Marla", "marla", "  ", "Aldric"]), ["Marla", "Aldric"]);
  assert.equal(normalizeWitnesses(Array.from({ length: 40 }, (_, i) => `N${i}`)).length, 12);
  assert.deepEqual(normalizeWitnesses([]), []);
});

test("witness lists round-trip through the column", () => {
  assert.deepEqual(parseWitnesses(serializeWitnesses(["Marla", "Aldric"])), ["Marla", "Aldric"]);
  assert.deepEqual(parseWitnesses(""), []);
  assert.deepEqual(parseWitnesses("not json"), []);
  assert.deepEqual(parseWitnesses("{}"), []);
});

test("mergeWitnesses unions without duplicating", () => {
  assert.deepEqual(mergeWitnesses(["Marla"], ["marla", "Aldric"]), ["Marla", "Aldric"]);
});

test("detectWitnesses matches whole words and aliases", () => {
  assert.deepEqual(
    detectWitnesses("Marla drew her blade as Aldric backed away.", roster),
    ["Marla Venn", "Aldric"],
  );
  // The short alias resolves to the canonical name, not a second entity.
  assert.deepEqual(detectWitnesses("Marla nodded.", roster), ["Marla Venn"]);
  // No partial-word matches.
  assert.deepEqual(detectWitnesses("The marlin swam past.", roster), []);
  assert.deepEqual(detectWitnesses("Aldrics", roster), []);
  // Names shorter than three characters are skipped as too collision-prone.
  assert.deepEqual(detectWitnesses("Bo waited by the door.", roster), []);
  assert.deepEqual(detectWitnesses("", roster), []);
});

test("public categories are knowable by everyone", () => {
  assert.ok(isPublicCategory("world"));
  assert.ok(isPublicCategory("lore"));
  assert.ok(!isPublicCategory("promise"));
  assert.ok(
    npcCouldKnow(
      { category: "world", subject: "the war", fact: "The war ended.", witnessedBy: ["Aldric"] },
      "Marla Venn",
    ),
    "a public fact needs no witness",
  );
});

test("a private fact is known only to its witnesses", () => {
  const secret = {
    category: "promise",
    subject: "the cellar oath",
    fact: "Marla swore to open the vault.",
    witnessedBy: ["Marla Venn"],
  };
  assert.ok(npcCouldKnow(secret, "Marla Venn"));
  assert.ok(npcCouldKnow(secret, "marla venn"), "matching is case-insensitive");
  assert.ok(!npcCouldKnow(secret, "Aldric"), "the shopkeeper across town was not there");
});

test("unwitnessed facts stay ambient rather than becoming secrets", () => {
  // Existing campaigns have facts recorded before witness tracking existed;
  // treating those as secret would make every NPC abruptly amnesiac.
  const legacy = {
    category: "promise",
    subject: "an old debt",
    fact: "The party owes the guild.",
    witnessedBy: [],
  };
  assert.ok(npcCouldKnow(legacy, "Aldric"));
  assert.ok(npcCouldKnow(legacy, "Marla Venn"));
});

test("renderWitnessNote names only what this NPC missed", () => {
  const facts = [
    { category: "promise", subject: "the cellar oath", fact: "x", witnessedBy: ["Marla Venn"] },
    { category: "npc", subject: "the bribe", fact: "y", witnessedBy: ["Marla Venn"] },
    { category: "world", subject: "the war", fact: "z", witnessedBy: ["Marla Venn"] },
    { category: "promise", subject: "an old debt", fact: "w", witnessedBy: [] },
  ];
  const note = renderWitnessNote("Aldric", facts);
  assert.ok(note.includes("the cellar oath"));
  assert.ok(note.includes("the bribe"));
  assert.ok(!note.includes("the war"), "public facts are never listed as missed");
  assert.ok(!note.includes("an old debt"), "unwitnessed facts are never listed as missed");
  // A witness has nothing to be cautioned about.
  assert.equal(renderWitnessNote("Marla Venn", facts), "");
  assert.equal(renderWitnessNote("Aldric", []), "");
});

console.log(`test-witness: ${passed} tests passed`);
