// Chapter-rewind logic: snapshot row round-trips (BLOB wrapping, embedding
// stripping) and the confirm-dialog warning summary.
import assert from "node:assert/strict";
import {
  CAMPAIGN_SNAPSHOT_COLUMNS,
  SNAPSHOT_TABLES,
  reviveRow,
  rollbackWarnings,
  serializeRow,
} from "../src/lib/dm/rollback-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("snapshot table set covers the in-place world state", () => {
  for (const table of [
    "character_sheets",
    "npcs",
    "locations",
    "world_facts",
    "encounters",
    "battle_maps",
    "overworld_maps",
  ]) {
    assert.ok(SNAPSHOT_TABLES.includes(table), `${table} missing from snapshot set`);
  }
  assert.ok(CAMPAIGN_SNAPSHOT_COLUMNS.includes("story_arc_json"));
  assert.ok(CAMPAIGN_SNAPSHOT_COLUMNS.includes("world_tick_json"));
  assert.ok(CAMPAIGN_SNAPSHOT_COLUMNS.includes("story_summary"));
});

test("serializeRow strips embeddings and wraps other BLOBs", () => {
  const row = serializeRow({
    id: "a",
    hp: 12,
    note: null,
    embedding: Buffer.from([1, 2, 3]),
    portrait: Buffer.from("img"),
  });
  assert.equal(row.embedding, null);
  assert.deepEqual(row.portrait, { __blob: Buffer.from("img").toString("base64") });
  assert.equal(row.hp, 12);
});

test("serialize/revive round-trips through JSON", () => {
  const original = {
    id: "x",
    data: Buffer.from([0, 255, 7, 42]),
    text: "hello",
    count: 3,
    missing: null,
  };
  const revived = reviveRow(JSON.parse(JSON.stringify(serializeRow(original))));
  assert.ok(Buffer.isBuffer(revived.data));
  assert.deepEqual([...revived.data], [0, 255, 7, 42]);
  assert.equal(revived.text, "hello");
  assert.equal(revived.count, 3);
  assert.equal(revived.missing, null);
});

test("rollbackWarnings names every consequence", () => {
  const warnings = rollbackWarnings({
    targetChapterIndex: 3,
    boundarySeq: 120,
    messagesToDelete: 41,
    chaptersToDelete: 2,
    activeEncounter: true,
    inFlightTurn: true,
    pendingRolls: 1,
    pendingProposals: 2,
    sheetsToRemove: ["Nyx"],
  });
  assert.ok(warnings.some((w) => w.includes("41 messages")));
  assert.ok(warnings.some((w) => w.includes("2 later chapters")));
  assert.ok(warnings.some((w) => w.includes("combat")));
  assert.ok(warnings.some((w) => w.includes("DM turn")));
  assert.ok(warnings.some((w) => w.includes("dice")));
  assert.ok(warnings.some((w) => w.includes("offers")));
  assert.ok(warnings.some((w) => w.includes("Nyx")));
});

test("rollbackWarnings singular forms and quiet case", () => {
  const warnings = rollbackWarnings({
    targetChapterIndex: 2,
    boundarySeq: 10,
    messagesToDelete: 1,
    chaptersToDelete: 1,
    activeEncounter: false,
    inFlightTurn: false,
    pendingRolls: 0,
    pendingProposals: 0,
    sheetsToRemove: [],
  });
  assert.ok(warnings.some((w) => w.includes("1 message ")));
  assert.ok(warnings.some((w) => w.includes("1 later chapter ")));
  assert.equal(warnings.length, 2);
});

console.log(`test-rollback-logic: ${passed} tests passed`);
