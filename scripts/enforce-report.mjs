// Runs every scripts/test-enforce-*.mjs and gathers what they found.
//
//   node scripts/enforce-report.mjs            print the ledger
//   node scripts/enforce-report.mjs --write    and write it to
//                                              docs/rules-enforcement-ledger.md
//   node scripts/enforce-report.mjs --json     the raw rows
//
// Each suite runs in its own process, as it does under npm test. A suite
// that fails (a rule that was enforced and no longer is, or a gap that has
// closed and still says gap()) is listed first and makes this exit 1.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const docPath = path.join(root, "docs", "rules-enforcement-ledger.md");
const ORDER = { high: 0, medium: 1, low: 2 };

const files = fs
  .readdirSync(path.join(root, "scripts"))
  .filter((name) => /^test-enforce-.*\.mjs$/.test(name))
  .sort();

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "odm-enforce-report-")), "rows.jsonl");
fs.writeFileSync(out, "");

const broken = [];
for (const file of files) {
  const run = spawnSync(process.execPath, [path.join("scripts", file)], {
    cwd: root,
    env: { ...process.env, ODM_ENFORCE_REPORT: out, NODE_NO_WARNINGS: "1" },
    encoding: "utf8",
    timeout: 300000,
  });
  if (run.status !== 0) {
    broken.push({ file, detail: (run.stderr || run.stdout || "").trim().split("\n").slice(0, 12).join("\n") });
  }
}

const rows = fs
  .readFileSync(out, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const gaps = rows
  .flatMap((row) => row.gaps)
  .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.id.localeCompare(b.id));
const enforced = rows.reduce((sum, row) => sum + row.passed, 0);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ suites: rows.length, enforced, gaps, broken }, null, 2));
  process.exit(broken.length ? 1 : 0);
}

const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const lines = [
  `${files.length} suites, ${enforced} rules enforced, ${gaps.length} known gaps ` +
    `(${["high", "medium", "low"].map((level) => `${gaps.filter((gap) => gap.severity === level).length} ${level}`).join(", ")}).`,
  "",
  "| Severity | Gap | Rule | Where | Observed |",
  "|---|---|---|---|---|",
  ...gaps.map(
    (gap) =>
      `| ${gap.severity} | \`${gap.id}\` | ${cell(gap.rule)} | \`${cell(gap.where)}\` | ${cell(gap.observed)} |`,
  ),
  "",
  "| Suite | Enforced | Gaps |",
  "|---|---|---|",
  ...rows.map((row) => `| \`${row.suite}\` | ${row.passed} | ${row.gaps.length} |`),
];
const ledger = lines.join("\n");

if (broken.length) {
  console.log(`BROKEN SUITES (${broken.length}):`);
  for (const entry of broken) {
    console.log(`\n${entry.file}\n${entry.detail}`);
  }
  console.log("");
}
console.log(ledger);

if (process.argv.includes("--write")) {
  const head = [
    "# Rules enforcement ledger",
    "",
    "Written by `node scripts/enforce-report.mjs --write`. Do not edit by hand: the",
    "gaps listed here are the `gap()` calls in `scripts/test-enforce-*.mjs`, and a",
    "gap leaves this list by being fixed and turned into a `test()`. What the",
    "suites are, which ruleset they hold ODM to and the order of repair are in",
    "`docs/rules-enforcement-audit.md`.",
    "",
    "",
  ].join("\n");
  fs.writeFileSync(docPath, `${head}${ledger}\n`);
  console.log(`\nwrote ${path.relative(root, docPath)}`);
}

process.exit(broken.length ? 1 : 0);
