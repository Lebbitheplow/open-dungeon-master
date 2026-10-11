// What a standalone build may copy (next.config.ts, PR #184). The file
// tracer follows every path the server builds from process.cwd(), so a path
// into run-time state written as a fixed string (.env.server, the live
// database, uploads, generated pictures and narration, downloaded models)
// put that state into .next/standalone whenever the build ran in a checkout
// that held it. Each such path carries /*turbopackIgnore: true*/ where it is
// built; the only unmarked ones are files the server reads from the tree
// itself, which the build must carry. And the MIT notice travels with every
// standalone copy, the image's /app and the apps' payload alike.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

register("./lib/register-alias.mjs", import.meta.url);

let failed = 0;
async function test(name, run) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`not ok - ${name}`);
    console.log(error);
  }
}

// Read from the tree at run time, so the trace has to carry them: the
// bundled world packs (the apps' payload keeps them from the trace), and
// package.json as a module resolution base (standalone always writes one).
const BUILD_INPUTS = [
  { file: "src/lib/worlds/index.ts", text: '"src", "lib", "worlds", "bundled"' },
  { file: "src/lib/image-variants.ts", text: '"package.json"' },
];

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

// A path joined onto the working directory, or the secrets file named bare
// (a relative path resolves against the same directory).
const UNMARKED = /path\.(join|resolve)\(\s*process\.cwd\(\)|\(\s*["']\.env\.server["']/;

function unmarkedPaths() {
  const found = [];
  for (const full of sourceFiles(path.join(repo, "src"))) {
    const file = path.relative(repo, full).split(path.sep).join("/");
    fs.readFileSync(full, "utf8")
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (UNMARKED.test(line)) found.push({ file, line: index + 1, source: line.trim() });
      });
  }
  return found;
}

await test("every run-time path built from process.cwd() is kept out of the trace", () => {
  const leaks = unmarkedPaths().filter(
    (hit) => !BUILD_INPUTS.some((input) => input.file === hit.file && hit.source.includes(input.text)),
  );
  assert.deepEqual(
    leaks.map((hit) => `${hit.file}:${hit.line}  ${hit.source}`),
    [],
    "mark run-time paths with /*turbopackIgnore: true*/, or list a file the server reads from the tree in BUILD_INPUTS",
  );
});

await test("the build inputs left unmarked are still there", () => {
  const hits = unmarkedPaths();
  for (const input of BUILD_INPUTS) {
    assert.ok(
      hits.some((hit) => hit.file === input.file && hit.source.includes(input.text)),
      `${input.file} no longer builds ${input.text}; drop it from BUILD_INPUTS`,
    );
  }
});

await test("a standalone build carries the LICENSE", async () => {
  process.env.DOCKER_BUILD = "1";
  const { default: config } = await import("../next.config.ts");
  assert.equal(config.output, "standalone");
  assert.ok(config.outputFileTracingIncludes["/*"].includes("LICENSE"));
  assert.ok(fs.existsSync(path.join(repo, "LICENSE")));
});

if (failed) {
  process.exit(1);
}
console.log("\nbuild trace checks passed");
