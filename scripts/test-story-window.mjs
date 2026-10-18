// The storyteller's window minimums (src/lib/story-window.ts): what each size
// is told, and every place that quotes them (the README, the install and
// text-backend guides, npm run setup) saying the same numbers. That the
// minimums hold for a real turn is scripts/test-tool-profiles.mjs's to show.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const windows = await import("../src/lib/story-window.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

await test("each window is told what it plays", () => {
  const level = (tokens) => windows.storyWindowVerdict(tokens).level;
  assert.equal(level(8_192), "short");
  assert.equal(level(windows.MIN_NARRATION_WINDOW - 1), "short");
  assert.equal(level(windows.MIN_NARRATION_WINDOW), "no-fights", "a model sold as 16K narrates");
  assert.equal(level(16_384), "no-fights");
  assert.equal(level(windows.MIN_COMBAT_WINDOW), "tight");
  assert.equal(level(24_576), "tight");
  assert.equal(level(windows.RECOMMENDED_WINDOW), "ok");
  assert.equal(level(65_536), "ok");
  assert.equal(windows.storyWindowVerdict(65_536).text, "", "enough says nothing");
  assert.match(windows.storyWindowVerdict(8_192).text, /^An 8K window is too small to narrate/);
  assert.match(windows.storyWindowVerdict(20_480).text, /^A 20K window narrates and explores, but fights need 24K/);
  assert.match(windows.storyWindowVerdict(24_576).text, /^A 24K window plays, fights included/);
});

await test("a size is named the way it was set", () => {
  assert.equal(windows.windowLabel(65_536), "64K", "llama-server -c 65536");
  assert.equal(windows.windowLabel(131_072), "128K");
  assert.equal(windows.windowLabel(128_000), "128K", "the catalog's thousands");
  assert.equal(windows.windowLabel(16_000), "16K");
  assert.equal(windows.windowLabel(1_050_000), "1.1M");
  assert.equal(windows.aWindow(8_192), "An 8K");
  assert.equal(windows.aWindow(65_536), "A 64K");
});

await test("llama-server's -c clears each minimum", () => {
  assert.equal(windows.windowFlag(windows.MIN_NARRATION_WINDOW), 16_384);
  assert.equal(windows.windowFlag(windows.MIN_COMBAT_WINDOW), 24_576);
  assert.equal(windows.windowFlag(windows.RECOMMENDED_WINDOW), 32_768);
});

await test("the README, the guides and npm run setup quote the same minimums", () => {
  const label = windows.windowLabel;
  const needs = `at least ${label(windows.MIN_NARRATION_WINDOW)} tokens to narrate and ${label(windows.MIN_COMBAT_WINDOW)} to run fights; ${label(windows.RECOMMENDED_WINDOW)} or more is recommended`;
  assert.ok(windows.STORY_WINDOW_NEEDS.includes(needs), "the app's own sentence");
  for (const file of ["README.md", "docs/install.md", "docs/text-backends.md", "scripts/setup.mjs"]) {
    const text = fs.readFileSync(path.join(root, file), "utf8").replace(/\*\*/g, "").replace(/\$\{dim\("[^"]*"\)\}/g, "").replace(/\s+/g, " ");
    assert.ok(text.includes(needs), `${file} says "${needs}"`);
  }
  const table = fs.readFileSync(path.join(root, "docs/text-backends.md"), "utf8");
  for (const tokens of [windows.MIN_NARRATION_WINDOW, windows.MIN_COMBAT_WINDOW, windows.RECOMMENDED_WINDOW]) {
    assert.ok(table.includes(`| ${label(tokens)} (\`-c ${windows.windowFlag(tokens)}\`) |`), `the table has a ${label(tokens)} row`);
  }
});

console.log(`story-window: ${passed} tests passed`);
