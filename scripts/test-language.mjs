// The language layer every lexical reader shares (src/lib/language): Unicode
// words, Snowball stop lists and stemmers per table language, and the name
// comparisons that SQLite's ASCII-only NOCASE and \b got wrong.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { compareNames, words, foldName, hasWord } = await import("../src/lib/language/text-logic.ts");
const { stems, stopWordsFor, stemWord } = await import("../src/lib/language/language.ts");
const { TABLE_LANGUAGES } = await import("../src/lib/schemas/game-settings-options.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

test("words are Unicode, and keep the apostrophes and hyphens inside them", () => {
  assert.deepEqual(words("Niccolò e José, nell'Église!"), ["Niccolò", "e", "José", "nell'Église"]);
  assert.deepEqual(words("Marla’s sword, t-uisce, don't"), ["Marla's", "sword", "t-uisce", "don't"]);
  assert.deepEqual(words("'quoted' -- dash"), ["quoted", "dash"]);
});

test("every table language has a stemmer and a stop list", () => {
  for (const language of TABLE_LANGUAGES) {
    assert.ok(stopWordsFor(language).size > 50, language);
    assert.equal(typeof stemWord("test", language), "string", language);
  }
});

test("singular and regular plural share a stem in each language", () => {
  const pairs = {
    english: ["spider", "spiders"],
    italian: ["ragno", "ragni"],
    french: ["araignée", "araignées"],
    spanish: ["ratón", "ratones"],
    german: ["Spinne", "Spinnen"],
  };
  for (const [language, [one, many]] of Object.entries(pairs)) {
    assert.deepEqual(stems(one, language), stems(many, language), language);
  }
});

test("elisions and possessives reach the same stem as the bare word", () => {
  assert.deepEqual(stems("dell'Oracolo", "italian"), stems("oracolo", "italian"));
  assert.deepEqual(stems("l’oracolo", "italian"), stems("oracolo", "italian"));
  assert.deepEqual(stems("l'araignée", "french"), stems("araignée", "french"));
  assert.deepEqual(stems("Marla's", "english"), stems("Marla", "english"));
  assert.deepEqual(stems("Marla’s", "english"), stems("Marla", "english"));
});

test("each language drops its own function words, and only those", () => {
  assert.deepEqual(stems("Porta della Gilda", "italian"), ["port", "gild"]);
  assert.deepEqual(stems("la Tour des Mages", "french").length, 2);
  assert.deepEqual(stems("the house of the guild", "english"), ["hous", "guild"]);
  // Whole-word stop entries: English lists its contractions whole.
  assert.deepEqual(stems("don't it's", "english"), []);
  // An Italian stop word is a scoring word at an English table.
  assert.deepEqual(stems("come", "english"), ["come"]);
  assert.deepEqual(stems("come", "italian"), []);
});

test("names fold by Unicode case and form, not by accent", () => {
  assert.equal(foldName("Église Saint-Martin"), foldName("église saint-martin"));
  assert.equal(foldName("Ölmühle"), "ölmühle");
  // A decomposed "ò" (o + combining grave) is the composed one.
  assert.equal(foldName("Niccolo\u0300"), foldName("Niccol\u00f2"));
  assert.notEqual(foldName("papà"), foldName("papa"));
});

test("names sort by Unicode, case and accents aside, numbers by value, in one order on every host", () => {
  const sorted = ["Zed", "élodie", "Олег", "Room 10", "Åsa", "Dario", "Room 9", "Ärger", "fabio"].sort(compareNames);
  assert.deepEqual(sorted, ["Ärger", "Åsa", "Dario", "élodie", "fabio", "Room 9", "Room 10", "Zed", "Олег"]);
  assert.equal(compareNames("Élodie", "élodie"), 0);
});

test("a name is found as a whole word, never inside a longer one", () => {
  assert.ok(hasWord("Then José nods.", "José"));
  assert.ok(!hasWord("Joséphine nods.", "José"));
  assert.ok(hasWord("il cavallo d'Arturo", "Arturo"));
  assert.ok(hasWord("Jean-Luc waves", "jean-luc"));
  assert.ok(hasWord("O'Brien laughs", "O'Brien"));
  assert.ok(!hasWord("always", "Al"));
  assert.ok(hasWord("Niccolo\u0300 arrives", "niccolò"));
});

// The stemmer is server-only: its browser build fetches and starts a 370 KB
// WebAssembly module as soon as it is imported. No "use client" module may
// reach it through an import a bundle keeps (type-only ones are erased).
test("no browser module imports the stemmer", () => {
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
  const stemmer = path.join(src, "lib", "language", "language.ts");
  const resolve = (from, spec) => {
    const base = spec.startsWith("@/") ? path.join(src, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
    if (!base) {
      return null;
    }
    const stripped = base.replace(/\.tsx?$/, "");
    return [`${stripped}.ts`, `${stripped}.tsx`, path.join(stripped, "index.ts"), path.join(stripped, "index.tsx")].find((file) => existsSync(file)) ?? null;
  };
  const IMPORT = /^\s*(?:import|export)\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm;
  const files = readdirSync(src, { recursive: true })
    .map((file) => path.join(src, String(file)))
    .filter((file) => /\.tsx?$/.test(file));
  for (const entry of files.filter((file) => /^\s*["']use client["']/.test(readFileSync(file, "utf8")))) {
    const seen = new Map([[entry, null]]);
    const queue = [entry];
    while (queue.length) {
      const file = queue.shift();
      for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
        const next = match[1] ? null : resolve(file, match[2] ?? match[3]);
        if (next && !seen.has(next)) {
          seen.set(next, file);
          queue.push(next);
        }
      }
    }
    if (seen.has(stemmer)) {
      const chain = [];
      for (let at = stemmer; at; at = seen.get(at)) {
        chain.unshift(path.relative(src, at));
      }
      assert.fail(`a browser module reaches the stemmer: ${chain.join(" -> ")}`);
    }
  }
});

// Names a person reads sort through compareNames; a bare localeCompare
// sorts by the server's own locale. The ones left compare timestamps, ids or
// keys, where no alphabet applies; a new one has to be put on a side.
const NOT_NAMES = {
  "app/admin/AdminUsagePanel.tsx": 1, // lastActivityAt
  "components/rulebook/PagePrep.tsx": 1, // updatedAt
  "components/ui/ListControls.tsx": 1, // updatedAt, then compareNames
  "lib/ambience/library.ts": 1, // cue ids
  "lib/tts-cast.ts": 1, // voice ids
  "lib/db/overworld.ts": 1, // createdAt
  "lib/dm/call-tracker-logic.ts": 1, // call ids
  "lib/dm/chapter-lod.ts": 3, // chapter ids
  "lib/ops/backup.ts": 1, // createdAt
  "lib/voice/mesh-logic.ts": 1, // joinedAt
  "lib/voice/turn-logic.ts": 1, // raisedAt
  "lib/voice/peers.ts": 1, // joinedAt
  "lib/voice/transcript.ts": 1, // peer ids
  "lib/worldforge/time.ts": 1, // event ids, after compareNames on titles
  "lib/worldforge/web.ts": 1, // entry refs
  "lib/worldforge/format.ts": 1, // story ids
};

test("every name a person reads sorts through compareNames, the same on every server", () => {
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
  const found = {};
  for (const file of readdirSync(src, { recursive: true }).map(String).filter((file) => /\.tsx?$/.test(file))) {
    const count = readFileSync(path.join(src, file), "utf8").match(/\.localeCompare\(/g)?.length ?? 0;
    if (count) {
      found[file.split(path.sep).join("/")] = count;
    }
  }
  for (const [file, count] of Object.entries(found)) {
    assert.ok(file in NOT_NAMES, `${file} sorts with localeCompare; use compareNames for names, or list why not`);
    assert.equal(count, NOT_NAMES[file], `${file} has ${count} localeCompare calls; classify the new one`);
  }
  for (const file of Object.keys(NOT_NAMES)) {
    assert.ok(found[file], `${file} is listed but no longer calls localeCompare`);
  }
});

console.log(`\n${passed} language tests passed`);
