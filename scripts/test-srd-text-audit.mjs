// The SRD 5.1 text audit of issue #570 stays whole: it started from the text
// bundled in the app (src/lib/rulebook/srd-5.1.json), so every page has a
// row in scripts/fixtures/srd-text-audit.json, and so has every heading of
// the rules, class and race pages, each saying whether the engine plays it
// (held), breaks it (finding), leaves it to the GM (narrated) or has nothing
// to play (not-mechanical). A finding names its gap, or the test it became,
// in the slice's suite (scripts/test-enforce-srd-<slice>.mjs). A rulebook
// rebuilt with new pages or headings fails here until they are read.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import { suite } from "./lib/enforce-harness.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { test, finish } = suite("test-srd-text-audit");
const book = JSON.parse(fs.readFileSync(new URL("../src/lib/rulebook/srd-5.1.json", import.meta.url), "utf8"));
const { rows } = JSON.parse(fs.readFileSync(new URL("./fixtures/srd-text-audit.json", import.meta.url), "utf8"));
const { anchorSlug } = await import("../src/lib/rulebook/markdown.ts");

const STATUSES = new Set(["held", "finding", "narrated", "not-mechanical"]);
const byPage = new Map();
for (const row of rows) {
  byPage.set(row.page, [...(byPage.get(row.page) ?? []), row]);
}

await test("Every page of the bundled SRD 5.1 has a row.", () => {
  const missing = book.pages.filter((page) => !byPage.has(page.id)).map((page) => page.id);
  assert.deepEqual(missing, []);
  const unknown = [...byPage.keys()].filter((id) => !book.pages.some((page) => page.id === id));
  assert.deepEqual(unknown, [], "rows name pages the book has");
});

await test("Every heading of a rules, class or race page has a row.", () => {
  const missing = [];
  for (const page of book.pages.filter((entry) => !["spell", "item", "monster"].includes(entry.kind))) {
    const anchors = new Set(byPage.get(page.id).map((row) => row.anchor));
    for (const [, heading] of page.md.matchAll(/^#{1,6}\s+(.+)$/gm)) {
      if (!anchors.has(anchorSlug(heading.trim()))) {
        missing.push(`${page.id}#${anchorSlug(heading.trim())}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

await test("Every row says what the engine does with it, and why.", () => {
  for (const row of rows) {
    assert.ok(STATUSES.has(row.status), `${row.page} ${row.heading}: ${row.status}`);
    assert.ok(String(row.evidence ?? "").trim(), `${row.page} ${row.heading} gives its evidence`);
  }
});

await test("Every finding names its gap, or the test it became, in its slice's suite.", () => {
  const suites = new Map();
  for (const row of rows.filter((entry) => entry.status === "finding")) {
    const file = new URL(`./test-enforce-srd-${row.slice}.mjs`, import.meta.url);
    if (!suites.has(row.slice)) {
      suites.set(row.slice, fs.readFileSync(file, "utf8"));
    }
    for (const id of String(row.finding ?? "").split(/[,\s]+/).filter(Boolean)) {
      assert.ok(suites.get(row.slice).includes(`"${id}`), `${row.page} ${row.heading}: ${id} is in test-enforce-srd-${row.slice}.mjs`);
    }
  }
});

const counts = {};
for (const row of rows) {
  counts[row.status] = (counts[row.status] ?? 0) + 1;
}
console.log(`  ${rows.length} rows: ${Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(", ")}`);
finish();
