// No model is named in src/ (issue #265, after #273): the backends list their
// models and the models.dev catalog describes them, so a model ID written
// into the code is one that will retire and keep being sent. This reads the
// catalog snapshot ODM ships (src/lib/model-registry/snapshot.json) and fails
// on any name in the app's code (src/, and the scripts/lib modules src/
// imports) or in the configuration it ships (docker-compose*.yml and the
// .env*.example files, whose values a copy or a `docker compose up` sends)
// that is a model, as a string literal or as a word anywhere on a line (a
// hint's "e.g. ...", a page's text, a command shown to copy):
//   - a model ID from the snapshot;
//   - a name shaped like a model the snapshot does not list:
//     a family it knows (gpt, qwen, gemma, grok...) or a speech or picture
//     family its providers carry few of (tts, whisper...), then a version
//     digit, as in tts-1, whisper-1, distil-large-v3 or gpt-4o-mini-tts;
//   - a weights file (.safetensors, .gguf, .onnx...);
//   - a regular expression that picks behaviour from a versioned name, such
//     as /^gpt-6\.1-sol/.
// Offline: the snapshot is in the repository.
//
// What it cannot see: a name with no version digit that the catalog does not
// list (a bare "kokoro" reads like any other word), and a guess written
// without a version (/mini|nano/). The names ODM keeps on purpose are listed
// below and checked to still be there, so both lists stay true.
//
// Comment lines are skipped on purpose: a comment sends nothing, and the
// names in them are mostly records of where something was measured or
// examples of a format, true as written. A comment claiming what an alias
// points to today goes stale like a default does; that is for review. In the
// configuration files a comment is a "#" line, so an example left commented
// out (#OPENROUTER_MODEL=...) is not sent either.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");

// Models ODM downloads and runs itself are pinned dependencies, not retired
// by a provider. Each is matched by its exact name, so one without a version
// digit is found too, and one no longer in the code fails the test.
const PINNED = new Map([
  ["kokoro", "Kokoro-FastAPI's model name, the narration server ODM sets up (src/lib/tts-backend.ts)"],
  ["onnx-community/whisper-base", "the built-in speech engine's Whisper (src/lib/stt-builtin.ts)"],
  ["onnx/encoder_model_quantized.onnx", "the built-in Whisper's encoder file"],
  ["onnx/decoder_model_merged_quantized.onnx", "the built-in Whisper's decoder file"],
  ["Xenova/all-MiniLM-L6-v2", "the CPU embedding model retrieval runs on (src/lib/embeddings.ts)"],
]);

// Folders whose names are all such dependencies.
const PINNED_PATHS = new Map([
  ["src/lib/image-models/", "the curated ComfyUI catalog: the files ODM downloads into ComfyUI and paints with on this machine"],
]);

// Names still in the code, by the one file they may stay in, waiting on
// the change that removes them. An entry no longer found fails the test too,
// so this list only shrinks.
const LEFTOVERS = new Map([
  ["src/app/setup/StartHints.tsx", {
    ids: ["qwen3.6-35b-a3b", "qwen3.6-35b-a3b-q8_0.gguf", "qwen3.6-35b", "gpt-oss-20b", "gpt-oss-20b-mxfp4.gguf"],
    why: "the guided setup's instructions for starting a model server, which name the model to download: the recommended storyteller, and gpt-oss-20b as the 16 GB minimum (the maintainer's call, 2026-10-19, docs/text-backends.md)",
  }],
]);

// Every catalog ID, lower case, and the part after the last slash of an
// OpenRouter-style "vendor/model" ID when that part has a digit in it:
// "qwen/qwen3.6-35b" is also caught as "qwen3.6-35b", but "openrouter/auto"
// does not turn every "auto" in the code into a model.
function catalogIds(snapshot) {
  const ids = new Set();
  for (const provider of Object.values(snapshot.providers ?? {})) {
    for (const id of Object.keys(provider.models ?? {})) {
      const lower = id.toLowerCase();
      ids.add(lower);
      const tail = lower.slice(lower.lastIndexOf("/") + 1);
      if (tail !== lower && /\d/.test(tail)) ids.add(tail);
    }
  }
  return ids;
}

// The speech and picture families the catalog's providers carry few of.
const MORE_FAMILIES = ["tts", "whisper", "distil", "dall", "sdxl"];

// The word each catalog family starts with ("claude" of "claude-opus",
// "qwen" of "qwen3.6"): three letters at least, so the o-series' "o" and
// Hunyuan's "hy" do not make every o1 or hy2 in the code a model, and two
// models at least, so a one-off like OpenRouter's "auto" router does not
// make Tailwind's grid-cols-[auto_1fr] one (its ID is still matched whole).
function modelFamilies(snapshot) {
  const counts = new Map();
  for (const provider of Object.values(snapshot.providers ?? {})) {
    for (const model of Object.values(provider.models ?? {})) {
      const head = /^[a-z]+/.exec(String(model.family ?? "").toLowerCase())?.[0] ?? "";
      if (head.length >= 3) counts.set(head, (counts.get(head) ?? 0) + 1);
    }
  }
  return new Set([...MORE_FAMILIES, ...[...counts].filter(([, count]) => count >= 2).map(([head]) => head)]);
}

// Tailwind classes ("text-stone-300", "text-2xl") start with "text", which
// is also the head of OpenAI's text-embedding family.
const TAILWIND = /^-?[a-z]+(-[a-z]+)*-(\d{2,3}|\d?xl)(\/\d+)?$/;
const WEIGHTS = /\.(safetensors|gguf|ckpt|onnx|pt|bin)$/;

function modelShaped(text, families) {
  if (!/^[\w.:/@+-]+$/.test(text) || TAILWIND.test(text)) return false;
  if (WEIGHTS.test(text)) return true;
  const tail = text.slice(text.lastIndexOf("/") + 1);
  const head = /^[a-z]+/.exec(tail)?.[0] ?? "";
  return families.has(head) && /\d/.test(tail.slice(head.length));
}

// A family word with a version inside a regular expression, its escapes
// read as the characters they match: /^gpt-6\.1-sol/ holds "gpt-6.1-sol".
function versionedInPattern(pattern, families) {
  const plain = pattern.replace(/\\([.\-_:/])/g, "$1").toLowerCase();
  return (plain.match(/[a-z]+[-_.:]?\d/g) ?? []).some((word) => families.has(/^[a-z]+/.exec(word)[0]));
}

// String literals ("", '' and template strings without ${}), the words of
// every line, and regular expression literals, outside comment lines:
// [{ id, path, line }], the id lower case, each once a line.
const LITERAL = /(["'`])((?:(?!\1)[^\\\n$]){2,100})\1/g;
const WORD_GAP = /[^\w.:/@+-]+/;
const PATTERN = /(?<![\w)\]$])\/((?:\\.|[^/\n\\*])(?:\\.|[^/\n\\])*)\/[dgimsuyv]*/g;
const codeComment = (trimmed) => trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
const configComment = (trimmed) => trimmed.startsWith("#");
function namedModels(files, ids, families) {
  const pinned = new Set([...PINNED.keys(), ...LEFTOVERS.keys()].map((id) => id.toLowerCase()));
  const found = [];
  for (const file of files) {
    const comment = file.config ? configComment : codeComment;
    file.text.split("\n").forEach((raw, index) => {
      const trimmed = raw.trim();
      if (comment(trimmed)) return;
      // A compose default, ${NAME:-value}, is its own word.
      const line = file.config ? raw.replace(/:-/g, " ") : raw;
      const named = new Set();
      const words = line.split(WORD_GAP).map((word) => word.replace(/^[.:/]+|[.:/]+$/g, ""));
      for (const text of [...[...line.matchAll(LITERAL)].map((match) => match[2].trim()), ...words]) {
        const id = text.toLowerCase();
        if (id && !named.has(id) && (ids.has(id) || pinned.has(id) || modelShaped(id, families))) {
          named.add(id);
          found.push({ id, path: file.path, line: index + 1 });
        }
      }
      const code = line.replace(LITERAL, '""');
      for (const match of code.matchAll(PATTERN)) {
        if (versionedInPattern(match[1], families)) found.push({ id: `/${match[1]}/`, path: file.path, line: index + 1 });
      }
    });
  }
  return found;
}

// The app's code: src/, and every scripts/lib module it imports (and those
// modules' own imports), since that code runs in the server too.
function appFiles() {
  const read = (rel) => ({ path: rel, text: fs.readFileSync(path.join(root, rel), "utf8") });
  const files = fs
    .readdirSync(path.join(root, "src"), { recursive: true })
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".d.ts"))
    .map((name) => read(path.join("src", name).split(path.sep).join("/")));
  const IMPORT = /(?:from\s+|import\(\s*)["']([^"']+\.mjs)["']/g;
  const seen = new Set();
  const queue = files.flatMap((file) => [...file.text.matchAll(IMPORT)].map((match) => match[1]).filter((spec) => spec.includes("scripts/lib/")).map((spec) => `scripts/lib/${spec.split("scripts/lib/")[1]}`));
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const file = read(rel);
    files.push(file);
    for (const match of file.text.matchAll(IMPORT)) {
      if (match[1].startsWith("./")) queue.push(path.posix.join(path.posix.dirname(rel), match[1]));
    }
  }
  return files;
}

// The configuration the repository ships beside the code: the compose files
// a Docker install starts from, and the example env files people copy.
function configFiles() {
  return fs
    .readdirSync(root)
    .filter((name) => /^docker-compose.*\.ya?ml$/.test(name) || /^\.env.*\.example$/.test(name))
    .map((name) => ({ path: name, text: fs.readFileSync(path.join(root, name), "utf8"), config: true }));
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const snapshot = JSON.parse(fs.readFileSync(path.join(root, "src/lib/model-registry/snapshot.json"), "utf8"));
const ids = catalogIds(snapshot);
const families = modelFamilies(snapshot);

test("the matcher finds catalog IDs in code and leaves words and comments alone", () => {
  const fakeIds = catalogIds({
    providers: {
      openai: { models: { "gpt-9": {} } },
      openrouter: { models: { "qwen/qwen9-35b": {}, "openrouter/auto": {} } },
    },
  });
  const found = namedModels([{
    path: "src/a.ts",
    text: [
      'const model = "gpt-9";',
      "const local = 'qwen9-35b';",
      "const routed = `qwen/qwen9-35b`;",
      'const mode = "auto";',
      '// the old default was "gpt-9"',
      "const built = `${prefix}gpt-9`;",
    ].join("\n"),
  }], fakeIds, new Set());
  assert.deepEqual(found.map((hit) => `${hit.line}:${hit.id}`), ["1:gpt-9", "2:qwen9-35b", "3:qwen/qwen9-35b", "6:gpt-9"]);
});

test("in a configuration file a value is read and a # comment is not", () => {
  const found = namedModels([{
    path: "docker-compose.yml",
    config: true,
    text: [
      "      OPENAI_COMPAT_MODEL: ${OPENAI_COMPAT_MODEL:-gpt-9}",
      "OPENROUTER_MODEL=gpt-9",
      "#OPENROUTER_MODEL=gpt-9",
      "  # the old default was gpt-9",
    ].join("\n"),
  }], catalogIds({ providers: { openai: { models: { "gpt-9": {} } } } }), new Set());
  assert.deepEqual(found.map((hit) => hit.line), [1, 2]);
});

test("names the catalog does not list are found by their shape, and words, styles and the SRD source are not", () => {
  const found = namedModels([{
    path: "src/b.ts",
    text: [
      'const narration = "tts-1";',
      'form.append("model", "whisper-1");',
      'upstream.set("model", "distil-large-v3");',
      'const voice = "gpt-4o-mini-tts";',
      'const checkpoint = "SomeCheckpointXL_V6.0.safetensors";',
      "const RESPONSES_ONLY = [/^gpt-6\\.1-sol/];",
      'const big = "text-2xl";',
      'const tone = "text-stone-300";',
      'const source = "open5e";',
      'const kind = "whisper";',
      "const half = width / 2 / scale;",
      'const route = "/api/campaigns";',
      'hint="Anything small is plenty; e.g. gemma9:e4b-it-qat."',
      "<span>llama.cpp with Qwen9-35B-A3B, 64K window:</span>",
      "const hy2 = [hy1, o1];",
    ].join("\n"),
  }], new Set(), families);
  assert.deepEqual([...new Set(found.map((hit) => hit.line))], [1, 2, 3, 4, 5, 6, 13, 14]);
});

test("the snapshot is the catalog, not an empty or broken file", () => {
  assert.ok(ids.size > 500, `only ${ids.size} model IDs in the snapshot`);
  for (const family of ["gpt", "qwen", "gemma", "grok", "claude"]) assert.ok(families.has(family), family);
});

const files = [...appFiles(), ...configFiles()];
const found = namedModels(files, ids, families);
const leftover = (hit) => Boolean(LEFTOVERS.get(hit.path)?.ids.includes(hit.id));
const pinnedHere = (hit) => PINNED.has(hit.id) || [...PINNED.keys()].some((id) => id.toLowerCase() === hit.id) || [...PINNED_PATHS.keys()].some((prefix) => hit.path.startsWith(prefix));

test("the scripts/lib modules the server imports are read too, and the shipped configuration", () => {
  assert.ok(files.some((file) => file.path === "scripts/lib/openai-tool-route.mjs"));
  for (const name of ["docker-compose.yml", ".env.example", ".env.docker.example"]) {
    assert.ok(files.some((file) => file.path === name), name);
  }
});

test("the app's code names no model outside the pinned and leftover lists", () => {
  const unexpected = found.filter((hit) => !pinnedHere(hit) && !leftover(hit));
  assert.deepEqual(
    unexpected.map((hit) => `${hit.path}:${hit.line} names ${hit.id}`),
    [],
    "Read the model from the backend or the catalog instead (src/lib/model-registry), or, for a model ODM downloads and runs itself, add it to PINNED. In a shipped configuration file, leave the value blank or comment the example out.",
  );
});

test("every pinned name and leftover is still there, so a removed one comes off its list", () => {
  const stale = [
    ...[...PINNED.keys()].filter((id) => !found.some((hit) => hit.id === id.toLowerCase())),
    ...[...LEFTOVERS].flatMap(([path, { ids: left }]) => left.filter((id) => !found.some((hit) => hit.path === path && hit.id === id)).map((id) => `${path}: ${id}`)),
  ];
  const emptyPaths = [...PINNED_PATHS.keys()].filter((prefix) => !found.some((hit) => hit.path.startsWith(prefix)));
  assert.deepEqual([...stale, ...emptyPaths], [], "These are gone from the code: delete them from PINNED, PINNED_PATHS or LEFTOVERS in scripts/test-no-model-ids.mjs.");
});

console.log(`${passed} no-model-ids tests passed`);
