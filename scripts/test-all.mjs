// Runs every scripts/test-*.mjs sequentially; fails on the first nonzero exit.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const tests = readdirSync(scriptsDir)
  .filter((name) => /^test-.*\.mjs$/.test(name) && name !== "test-all.mjs")
  .sort();

if (!tests.length) {
  console.error("No test scripts found.");
  process.exit(1);
}

for (const name of tests) {
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(process.execPath, [path.join(scriptsDir, name)], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`\n${name} failed.`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nAll ${tests.length} test suites passed.`);
