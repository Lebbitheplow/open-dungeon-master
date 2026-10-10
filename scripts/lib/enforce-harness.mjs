// The test helpers every scripts/test-enforce-*.mjs shares.
//
// The enforcement suites ask one question of each rule: does the ENGINE hold
// it, in state a test can read, or does it only get said? So a check here
// never reads narration. It reads a sheet, an encounter row, a roll record
// or a refusal from a handler.
//
// Two kinds of check:
//
//   test(name, fn)   The rule is enforced today. A throw fails the suite.
//
//   gap(id, meta, fn)   The rule is NOT enforced today, and fn asserts what
//     enforcing it would look like. A failed assertion is the expected
//     result and is recorded as a finding; the suite stays green. Any other
//     throw (a TypeError, a missing fixture, a refused setup call) is the
//     test breaking, not the rule, and FAILS the suite: a broken setup must
//     not pass for an open gap. The moment fn stops
//     throwing the suite FAILS, naming the gap as closed, so a fix cannot
//     land without its gap() becoming a test(). That is the ratchet: the
//     list of gaps in these files is always the true list.
//
//   meta = { rule, where, severity, note? }
//     rule      the rule as ODM's ruleset states it, in one sentence
//     where     the file and function that would have to hold it
//     severity  "high" (a player can gain or keep something the rules deny),
//               "medium" (a wrong number or a missing refusal with a narrow
//               reach), "low" (cosmetic, or reachable only by a DM's hand)
//
// With ODM_ENFORCE_REPORT set to a path, finish() appends the suite's
// findings to that file as JSON lines, which scripts/enforce-report.mjs turns
// into docs/rules-enforcement-ledger.md.
import fs from "node:fs";

const SEVERITIES = new Set(["high", "medium", "low"]);

export function suite(name) {
  const failures = [];
  const gaps = [];
  const closed = [];
  const ids = new Set();
  let passed = 0;

  async function test(label, fn) {
    try {
      await fn();
      passed += 1;
    } catch (error) {
      failures.push({ label, error });
    }
  }

  async function gap(id, meta, fn) {
    if (ids.has(id)) {
      failures.push({ label: id, error: new Error(`gap id "${id}" is used twice in ${name}`) });
      return;
    }
    ids.add(id);
    if (!meta?.rule || !meta?.where || !SEVERITIES.has(meta?.severity)) {
      failures.push({
        label: id,
        error: new Error(`gap "${id}" needs rule, where and a severity of high, medium or low`),
      });
      return;
    }
    try {
      await fn();
    } catch (error) {
      if (error?.name !== "AssertionError" && error?.code !== "ERR_ASSERTION") {
        failures.push({ label: `${id} (the gap's setup threw, not its assertion)`, error });
        return;
      }
      gaps.push({
        suite: name,
        id,
        ...meta,
        observed: String(error?.message ?? error).split("\n")[0].slice(0, 400),
      });
      return;
    }
    closed.push(id);
  }

  function finish() {
    const reportPath = process.env.ODM_ENFORCE_REPORT;
    if (reportPath) {
      fs.appendFileSync(
        reportPath,
        `${JSON.stringify({ suite: name, passed, gaps, closed, failed: failures.map((f) => f.label) })}\n`,
      );
    }
    for (const entry of gaps) {
      console.log(`  GAP [${entry.severity}] ${entry.id}: ${entry.rule}`);
    }
    console.log(`${name}: ${passed} enforced, ${gaps.length} known gaps`);
    const problems = [
      ...failures.map(
        ({ label, error }) => `FAILED ${label}\n    ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n    ")}`,
      ),
      ...closed.map(
        (id) => `CLOSED ${id}: this gap is now enforced. Turn its gap() into a test().`,
      ),
    ];
    if (problems.length) {
      throw new Error(`${name}: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`);
    }
  }

  return { test, gap, finish };
}

// 5e's two universal formulas, written here from the rulebook rather than
// imported from the engine, so a test compares the engine to the rule and
// not to itself.
export const abilityMod = (score) => Math.floor((score - 10) / 2);
export const proficiencyBonus = (level) => 2 + Math.floor((level - 1) / 4);
