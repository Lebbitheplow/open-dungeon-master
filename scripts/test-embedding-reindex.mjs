// The embedding-model record and the re-embed pass
// (src/lib/dm/embedding-reindex.ts), against a throwaway encrypted database.
// The embedder is stubbed on its globalThis seam (test-workshop-integration
// pattern), so no model is downloaded and every written vector is traceable
// to the stub that wrote it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-reindex-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

// Every embed call is recorded; `fill` marks which "model" wrote a vector.
const calls = [];
function stubModel(fill) {
  globalThis.__odmEmbedderPromise = Promise.resolve((texts) => {
    calls.push(...texts);
    return Promise.resolve({ tolist: () => texts.map(() => new Array(384).fill(fill)) });
  });
}
stubModel(0.1);

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { LEGACY_EMBEDDING_KEY, bufferToVector } = await import(
  "../src/lib/embeddings.ts"
);
const {
  VECTOR_COLUMNS,
  countMissingVectors,
  embedMissingVectors,
  readEmbeddingModelStamp,
  reconcileEmbeddingModel,
  runtimeNotInstalled,
} = await import("../src/lib/dm/embedding-reindex.ts");
const { dedupFactsSemantically } = await import("../src/lib/dm/memory-index.ts");

const OTHER_KEY = "Xenova/paraphrase-multilingual-MiniLM-L12-v2@q8";
const ELSEWHERE_KEY = "Test/never-configured@fp32";
const db = getDatabase();
let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const now = new Date().toISOString();
const gm = createUser("gm", "x");
const campaign = createCampaign(gm.id, {
  title: "Test Table",
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 1,
  difficulty: "normal",
});
const cid = campaign.id;
const vec = (fill) => Buffer.from(new Float32Array(384).fill(fill).buffer);

// One row in every vector column, each already embedded by "model A" (0.1).
function seed() {
  for (const table of ["world_facts", "lore_entries", "campaign_notes", "rule_chunks", "scene_chunks"]) {
    db.prepare(`DELETE FROM ${table} WHERE campaign_id = ?`).run(cid);
  }
  db.prepare(`DELETE FROM chapters WHERE campaign_id = ? AND id = 'ch-closed'`).run(cid);
  db.prepare(
    `INSERT INTO world_facts (id, campaign_id, category, subject, fact, status, embedding, created_at, updated_at)
     VALUES ('fact-1', ?, 'npc', 'Marla', 'Marla owes the party fifty gold.', 'active', ?, ?, ?)`,
  ).run(cid, vec(0.1), now, now);
  db.prepare(
    `INSERT INTO world_facts (id, campaign_id, category, subject, fact, status, embedding, created_at, updated_at)
     VALUES ('fact-old', ?, 'npc', 'Marla', 'Marla ran the mill.', 'superseded', NULL, ?, ?)`,
  ).run(cid, now, now);
  db.prepare(
    `INSERT INTO lore_entries (id, campaign_id, category, title, body, embedding, created_at, updated_at)
     VALUES ('lore-1', ?, 'history', 'The Sundering', 'The old empire fell in a night.', ?, ?, ?)`,
  ).run(cid, vec(0.1), now, now);
  db.prepare(
    `INSERT INTO campaign_notes (id, campaign_id, author_user_id, visibility, title, body, seq, embedding, created_at, updated_at)
     VALUES ('note-1', ?, ?, 'public', 'Suspects', 'The miller lied about the flour.', 1, ?, ?, ?)`,
  ).run(cid, gm.id, vec(0.1), now, now);
  db.prepare(
    `INSERT INTO rule_chunks (id, campaign_id, chunk_index, heading, text, embedding, created_at, updated_at)
     VALUES ('rule-1', ?, 0, 'Flanking', 'Flanking grants advantage.', ?, ?, ?)`,
  ).run(cid, vec(0.1), now, now);
  db.prepare(
    `INSERT INTO chapters (id, campaign_id, chapter_index, seq_start, seq_end, status, title, summary, embedding, created_at, updated_at)
     VALUES ('ch-closed', ?, 99, 1, 10, 'closed', 'The Mill', 'The party found the stolen flour.', ?, ?, ?)`,
  ).run(cid, vec(0.1), now, now);
  db.prepare(
    `INSERT INTO scene_chunks (id, campaign_id, chapter_id, seq_start, seq_end, text, embedding, importance, witnesses_json, created_at)
     VALUES ('scene-1', ?, 'ch-closed', 1, 10, 'The miller wept by the wheel.', ?, 5, '["Marla"]', ?)`,
  ).run(cid, vec(0.1), now);
}

function vectorOf(table, id) {
  return db.prepare(`SELECT embedding FROM ${table} WHERE id = ?`).get(id).embedding;
}
const ROWS = [
  ["world_facts", "fact-1"],
  ["lore_entries", "lore-1"],
  ["campaign_notes", "note-1"],
  ["rule_chunks", "rule-1"],
  ["chapters", "ch-closed"],
  ["scene_chunks", "scene-1"],
];

await test("an install left on the defaults keys the index as the original model", () => {
  // A child with no EMBEDDING_* in its environment and no .env.server in its
  // working directory: exactly a default install.
  const env = { ...process.env };
  delete env.EMBEDDING_MODEL;
  delete env.EMBEDDING_DTYPE;
  const embeddingsUrl = new URL("../src/lib/embeddings.ts", import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `const m = await import(${JSON.stringify(embeddingsUrl)}); console.log(m.EMBEDDING_KEY);`],
    { cwd: dir, env, encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), LEGACY_EMBEDDING_KEY);
});

await test("VECTOR_COLUMNS names every table that stores a vector", () => {
  const withVectors = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all()
    .map((row) => row.name)
    .filter((table) => db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === "embedding"))
    .sort();
  assert.deepEqual(withVectors, VECTOR_COLUMNS.map((column) => column.table).sort());
});

await test("an unstamped database on the original model is stamped and nothing is cleared", () => {
  seed();
  assert.equal(readEmbeddingModelStamp(), null);
  const result = reconcileEmbeddingModel(LEGACY_EMBEDDING_KEY);
  assert.equal(result.cleared, 0);
  assert.equal(readEmbeddingModelStamp(), LEGACY_EMBEDDING_KEY);
  for (const [table, id] of ROWS) {
    assert.ok(bufferToVector(vectorOf(table, id)), `${table} kept its vector`);
  }
  assert.equal(countMissingVectors(), 0);
});

await test("a matching stamp is a no-op", () => {
  const result = reconcileEmbeddingModel(LEGACY_EMBEDDING_KEY);
  assert.deepEqual(result, { previous: LEGACY_EMBEDDING_KEY, current: LEGACY_EMBEDDING_KEY, cleared: 0 });
});

await test("a model change blanks every stored vector and records the new model", () => {
  const result = reconcileEmbeddingModel(OTHER_KEY);
  assert.equal(result.previous, LEGACY_EMBEDDING_KEY);
  assert.equal(result.cleared, ROWS.length);
  assert.equal(readEmbeddingModelStamp(), OTHER_KEY);
  for (const [table, id] of ROWS) {
    assert.equal(bufferToVector(vectorOf(table, id)), null, `${table} was blanked`);
  }
  // scene_chunks.embedding is NOT NULL: blanked, not nulled, and the rest of
  // the row is exactly as indexing wrote it.
  const scene = db.prepare(`SELECT * FROM scene_chunks WHERE id = 'scene-1'`).get();
  assert.equal(scene.embedding.length, 0);
  assert.equal(scene.text, "The miller wept by the wheel.");
  assert.equal(scene.importance, 5);
  assert.equal(scene.witnesses_json, '["Marla"]');
  // The superseded fact never had a vector and is not wanted: not counted.
  assert.equal(countMissingVectors(), ROWS.length);
});

await test("an unstamped database under a new model is treated as the original model's", () => {
  seed();
  db.prepare(`DELETE FROM app_settings WHERE key = 'embedding_model'`).run();
  const result = reconcileEmbeddingModel(OTHER_KEY);
  assert.equal(result.previous, null);
  assert.equal(result.cleared, ROWS.length);
  assert.equal(readEmbeddingModelStamp(), OTHER_KEY);
});

await test("the catch-up re-embeds every blanked vector with the configured model", async () => {
  stubModel(0.2);
  calls.length = 0;
  const missing = await embedMissingVectors();
  assert.equal(missing, ROWS.length);
  assert.equal(countMissingVectors(), 0);
  for (const [table, id] of ROWS) {
    const vector = bufferToVector(vectorOf(table, id));
    assert.ok(vector, `${table} has a vector again`);
    assert.ok(Math.abs(vector[0] - 0.2) < 1e-6, `${table} was written by the new model`);
  }
  // The same text each feature embeds at save or index time.
  for (const text of [
    "Marla owes the party fifty gold.",
    "The Sundering\nThe old empire fell in a night.",
    "Suspects\nThe miller lied about the flour.",
    "Flanking\nFlanking grants advantage.",
    "The Mill. The party found the stolen flour.",
    "The miller wept by the wheel.",
  ]) {
    assert.ok(calls.includes(text), `embedded: ${JSON.stringify(text)}`);
  }
  assert.ok(!calls.includes("Marla ran the mill."), "superseded facts are left alone");
  assert.equal(vectorOf("world_facts", "fact-old"), null);
});

await test("with nothing missing the catch-up never touches the model", async () => {
  globalThis.__odmEmbedderPromise = Promise.reject(new Error("must not load"));
  globalThis.__odmEmbedderPromise.catch(() => undefined);
  assert.equal(await embedMissingVectors(), 0);
  stubModel(0.2);
});

await test("a model that cannot load logs once and leaves search keyword-only", async () => {
  seed();
  assert.equal(reconcileEmbeddingModel(ELSEWHERE_KEY).cleared, ROWS.length);
  const broken = Promise.reject(new Error("offline"));
  broken.catch(() => undefined);
  globalThis.__odmEmbedderPromise = broken;
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    assert.equal(await embedMissingVectors(), ROWS.length);
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1, "one error line, not one per row");
  assert.equal(countMissingVectors(), ROWS.length);
  stubModel(0.3);
  // The next start (or pass) picks them up once the model loads.
  assert.equal(await embedMissingVectors(), ROWS.length);
  assert.equal(countMissingVectors(), 0);
});

await test("only a pruned transformers.js or a missing native build reads as a host without embeddings", () => {
  // What a pruned payload (the Android app) raises through Turbopack, and
  // what plain Node raises for the same absence.
  assert.equal(
    runtimeNotInstalled(
      new Error(
        "Failed to load external module @huggingface/transformers-31f28a0eb9b916d1: " +
          "Error: Cannot find module '@huggingface/transformers-31f28a0eb9b916d1'",
      ),
    ),
    true,
  );
  assert.equal(
    runtimeNotInstalled(new Error("Cannot find package '@huggingface/transformers' imported from /app/x.js")),
    true,
  );
  // The broken standalone build: transformers.js present, its runtime not.
  assert.equal(
    runtimeNotInstalled(
      new Error(
        "Failed to load external module @huggingface/transformers-31f28a0eb9b916d1: " +
          "Error: Cannot find module 'onnxruntime-node'",
      ),
    ),
    false,
  );
  // No native build for this OS and CPU (onnxruntime-node has no Intel Mac one).
  assert.equal(
    runtimeNotInstalled(new Error("Cannot find module '../bin/napi-v6/darwin/x64/onnxruntime_binding.node'")),
    true,
  );
  assert.equal(runtimeNotInstalled(new Error("fetch failed")), false);
});

await test("a host without the runtime notes it once, without an error", async () => {
  seed();
  assert.equal(reconcileEmbeddingModel(OTHER_KEY).cleared, ROWS.length);
  const pruned = Promise.reject(
    new Error("Failed to load external module @huggingface/transformers-abc: Error: Cannot find module '@huggingface/transformers-abc'"),
  );
  pruned.catch(() => undefined);
  globalThis.__odmEmbedderPromise = pruned;
  const errors = [];
  const notes = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...args) => errors.push(args);
  console.log = (...args) => notes.push(args.join(" "));
  try {
    assert.equal(await embedMissingVectors(), ROWS.length);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
  assert.equal(errors.length, 0);
  assert.deepEqual(notes, [
    `[embeddings] No embedding runtime for this host (${process.platform}/${process.arch}); search stays keyword-only.`,
  ]);
  stubModel(0.3);
  assert.equal(await embedMissingVectors(), ROWS.length);
});

await test("concurrent catch-up requests share one pass", async () => {
  db.prepare(`UPDATE lore_entries SET embedding = NULL WHERE id = 'lore-1'`).run();
  calls.length = 0;
  const [first, second] = await Promise.all([embedMissingVectors(), embedMissingVectors()]);
  assert.equal(first, 1);
  assert.equal(second, 1);
  assert.equal(calls.filter((text) => text.startsWith("The Sundering")).length, 1);
});

await test("the semantic fact dedup still embeds, then retires a near-duplicate", async () => {
  const insert = db.prepare(
    `INSERT INTO world_facts (id, campaign_id, category, subject, fact, status, created_at, updated_at)
     VALUES (?, ?, 'location', 'Mill', ?, 'active', ?, ?)`,
  );
  insert.run("dup-a", cid, "The mill stands by the river.", "2020-01-01T00:00:00.000Z", now);
  insert.run("dup-b", cid, "By the river stands the mill.", "2020-01-02T00:00:00.000Z", now);
  stubModel(0.4);
  await dedupFactsSemantically(cid);
  const status = (id) => db.prepare(`SELECT status FROM world_facts WHERE id = ?`).get(id).status;
  assert.equal(status("dup-a"), "active");
  assert.equal(status("dup-b"), "superseded");
  assert.ok(bufferToVector(vectorOf("world_facts", "dup-a")));
});

await test("the backfill script refuses a database indexed with another model", () => {
  // A key no configuration can produce, so the script's own model never matches.
  reconcileEmbeddingModel(ELSEWHERE_KEY);
  const child = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./backfill-embeddings.mjs", import.meta.url))],
    { cwd: dir, env: process.env, encoding: "utf8" },
  );
  assert.equal(child.status, 1);
  assert.match(child.stderr, /was indexed with .* but the configured model is/);
});

console.log(`test-embedding-reindex: ${passed} tests passed`);
removeTempDir(dir);
