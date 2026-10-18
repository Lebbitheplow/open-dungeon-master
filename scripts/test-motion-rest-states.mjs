// Every endless animation in the builder's and the set pieces' styles has a
// rest state twice over: under [data-effects="low"] (the app's Effects
// setting) and under prefers-reduced-motion (the system's). A loop that
// keeps running on a device that asked for stillness is the fault this
// guards; the creator.css header promises it, and until #320 the dice
// broke the promise unseen.
//
// The check is by class: each selector that starts an `infinite` animation
// names a class, and that class must appear in a low-effects rule and in a
// reduced-motion rule that set `animation: none` or `display: none`.
import assert from "node:assert/strict";
import fs from "node:fs";

const SHEETS = ["src/app/styles/creator.css", "src/app/styles/moments.css"];

// The rules of a sheet, flat, each with the @media it sits in (or "").
export function cssRules(text) {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  let at = 0;
  const walk = (media, end) => {
    while (at < end) {
      const open = source.indexOf("{", at);
      if (open === -1 || open >= end) {
        at = end;
        return;
      }
      const head = source.slice(at, open).trim();
      // Find the matching close brace.
      let depth = 1;
      let close = open + 1;
      while (depth && close < source.length) {
        if (source[close] === "{") depth += 1;
        else if (source[close] === "}") depth -= 1;
        close += 1;
      }
      if (head.startsWith("@media") || head.startsWith("@supports") || head.startsWith("@layer")) {
        at = open + 1;
        walk(head.startsWith("@media") ? head : media, close - 1);
        at = close;
      } else {
        if (!head.startsWith("@")) {
          rules.push({ media, selectors: head.split(",").map((part) => part.trim()), body: source.slice(open + 1, close - 1) });
        }
        at = close;
      }
    }
  };
  walk("", source.length);
  return rules;
}

const animationOf = (body) => body.match(/(?:^|;)\s*animation\s*:([^;]*)/)?.[1]?.trim() ?? null;
const stills = (body) => /(?:^|;)\s*animation\s*:\s*none\b/.test(body) || /(?:^|;)\s*display\s*:\s*none\b/.test(body);
// The last class a selector names before any pseudo part: `.die-flicker svg`
// is still the die's flicker, and stilling `.die-flicker` stills it.
const classesOf = (selector) => [...selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((match) => match[1]);

export function restlessLoops(text) {
  const rules = cssRules(text);
  const problems = [];
  for (const rule of rules) {
    const animation = animationOf(rule.body);
    if (!animation || !/\binfinite\b/.test(animation) || /prefers-reduced-motion/.test(rule.media)) continue;
    for (const selector of rule.selectors) {
      if (selector.includes('[data-effects="low"]')) continue;
      const classes = classesOf(selector);
      const rested = (match) =>
        rules.some((other) => match(other) && stills(other.body) && other.selectors.some((sel) => classes.some((name) => classesOf(sel).includes(name))));
      const low = rested((other) => other.selectors.some((sel) => sel.includes('[data-effects="low"]')));
      const reduced = rested((other) => /prefers-reduced-motion:\s*reduce/.test(other.media));
      if (!low) problems.push(`${selector} loops with no rest under [data-effects="low"]`);
      if (!reduced) problems.push(`${selector} loops with no rest under prefers-reduced-motion`);
    }
  }
  return problems;
}

let checked = 0;
for (const sheet of SHEETS) {
  const text = fs.readFileSync(new URL(`../${sheet}`, import.meta.url), "utf8");
  assert.ok(/\binfinite\b/.test(text), `${sheet} still has a loop for this test to check`);
  assert.deepEqual(restlessLoops(text), [], `${sheet} has an endless animation with no rest state`);
  checked += 1;
}

// The check itself fails where it should: a loop with no rest, a loop
// rested for one setting only, and passes a loop rested for both.
assert.deepEqual(restlessLoops(".spin { animation: spin 1s linear infinite; }"), [
  '.spin loops with no rest under [data-effects="low"]',
  ".spin loops with no rest under prefers-reduced-motion",
]);
assert.deepEqual(
  restlessLoops(`.spin { animation: spin 1s linear infinite; }
    [data-effects="low"] .spin { animation: none; }`),
  [".spin loops with no rest under prefers-reduced-motion"],
);
assert.deepEqual(
  restlessLoops(`.spin { animation: spin 1s linear infinite; }
    [data-effects="low"] .spin { animation: none; }
    @media (prefers-reduced-motion: reduce) { .a, .spin { display: none; } }`),
  [],
);
// A one-shot needs no rest rule here (the global reduced-motion cut ends it).
assert.deepEqual(restlessLoops(".pop { animation: pop 300ms both; }"), []);

console.log(`test-motion-rest-states: ${checked} sheets, every loop rests`);
