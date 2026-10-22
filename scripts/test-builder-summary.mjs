// Backlog F3: an edit opens on a summary, which is also where a new build
// ends. One row per step with its picks in plain words, an Edit to that
// step and "Back to summary" from it, and every pick still owed said in
// words with a Fix that goes to its field (summary.ts, steps/SummaryPanel.tsx,
// the step flow in CharacterBuilder.tsx). The clicks themselves are walked
// in scripts/browser/scenarios/61-builder-summary.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { createElement, isValidElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const submit = await import("../src/app/characters/builder/submit.ts");
const { summaryRows, summaryOwedCount, someNames } = await import("../src/app/characters/builder/summary.ts");
const { SummaryPanel } = await import("../src/app/characters/builder/steps/SummaryPanel.tsx");
const { Wizard } = await import("../src/components/ui/Wizard.tsx");

// Windows CI checks out with CRLF.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const none = { identity: [], ancestry: [], calling: [], abilities: [], spells: [] };
const complete = {
  name: "Wren",
  background: "Sage",
  race: "High Elf",
  klass: "Wizard",
  subclass: "School of Evocation",
  level: 3,
  abilities: { str: 8, dex: 14, con: 13, int: 16, wis: 12, cha: 10 },
  casts: true,
  cantrips: ["Fire Bolt", "Light", "Mage Hand", "Prestidigitation"],
  spells: ["Magic Missile", "Shield"],
  gear: [{ name: "Quarterstaff", qty: 1 }, { name: "Spellbook", qty: 1 }, { name: "Dagger", qty: 2 }],
  alignment: "Neutral Good",
  portrait: false,
  appearance: true,
  backstory: false,
  owed: none,
};

// Every node of an element tree that is not rendered, so a handler on it
// can be called as a click would.
function walk(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, out));
  } else if (isValidElement(node)) {
    out.push(node);
    walk(node.props.children, out);
  }
  return out;
}

await test("one row per step, in step order, in plain words", () => {
  const rows = summaryRows(complete);
  assert.deepEqual(rows.map((row) => row.key), ["identity", "ancestry", "calling", "abilities", "spells-gear", "finish"]);
  assert.deepEqual(rows.map((row) => row.label), ["Name and background", "Ancestry", "Class", "Ability scores", "Spells and gear", "Finishing touches"]);
  assert.deepEqual(rows[0].lines, ["Wren", "Sage background"]);
  assert.deepEqual(rows[1].lines, ["High Elf"]);
  assert.deepEqual(rows[2].lines, ["Wizard, level 3", "School of Evocation"]);
  assert.deepEqual(rows[3].lines, ["Str 8, Dex 14, Con 13, Int 16, Wis 12, Cha 10"]);
  assert.deepEqual(rows[4].lines, [
    "Cantrips: Fire Bolt, Light, Mage Hand and 1 more",
    "Spells: Magic Missile and Shield",
    "Gear: 4 items, Quarterstaff, Spellbook and Dagger",
  ]);
  assert.deepEqual(rows[5].lines, ["Alignment Neutral Good", "No portrait yet", "Appearance written", "No backstory yet"]);
  assert.equal(summaryOwedCount(rows), 0);
  assert.equal(someNames([]), "");
  assert.equal(someNames(["Light"]), "Light");
});

await test("an empty build says what is not chosen, and a fighter's row is Gear", () => {
  const rows = summaryRows({ ...complete, name: " ", background: undefined, race: undefined, klass: undefined, abilities: null, casts: false, gear: [] });
  assert.deepEqual(rows[0].lines, ["No name yet", "No background chosen"]);
  assert.deepEqual(rows[1].lines, ["No ancestry chosen"]);
  assert.deepEqual(rows[2].lines, ["No class chosen"]);
  assert.deepEqual(rows[3].lines, ["Not set yet"]);
  assert.equal(rows[4].label, "Gear");
  assert.deepEqual(rows[4].lines, ["No gear packed"]);
});

await test("each row lists what its step still owes, from the same blocks the gates hold", () => {
  const state = { name: "", backgroundSkills: [], bonusLanguages: [], racialAsi: [], racialSkills: [], feats: [], repeatSkills: [] };
  const owed = {
    ...none,
    identity: submit.identityBlocks(state, undefined),
    ancestry: submit.ancestryBlocks(state, undefined),
    calling: submit.callingBlocks(undefined),
    abilities: submit.abilitiesBlocks({ abilities: null }),
  };
  const rows = summaryRows({ ...complete, owed });
  assert.deepEqual(rows[0].owed.map((pick) => pick.target), owed.identity.map((block) => block.target));
  assert.deepEqual(rows[1].owed.map((pick) => [pick.target, pick.message]), [["race", "Choose where your hero comes from (race)."]]);
  assert.deepEqual(rows[2].owed.map((pick) => pick.label), ["Class"]);
  assert.deepEqual(rows[3].owed.map((pick) => pick.target), ["scores"]);
  assert.deepEqual(rows[4].owed, []);
  assert.deepEqual(rows[5].owed, [], "finishing touches never hold a save");
  assert.equal(summaryOwedCount(rows), rows[0].owed.length + 3);
});

await test("the panel has a heading per row and says a missing pick in words, with a Fix", () => {
  const owed = { ...none, calling: [{ target: "subclass", message: "Pick a subclass for your Wizard." }] };
  const rows = summaryRows({ ...complete, subclass: undefined, owed });
  const markup = renderToStaticMarkup(createElement(SummaryPanel, { rows, onEdit: () => {}, onFix: () => {} }));
  const headings = [...markup.matchAll(/<h4[^>]*>([^<]+)<\/h4>/g)].map((match) => match[1]);
  assert.deepEqual(headings, rows.map((row) => row.label), "each row is a heading under the step's own");
  assert.match(markup, /One pick is still to choose\. Fix goes straight to each one\./);
  assert.match(markup, /data-summary-row="calling" data-owed="1"/);
  assert.match(markup, /Still to choose:/, "the missing pick is said, not only coloured");
  assert.match(markup, /Pick a subclass for your Wizard\./);
  const fix = markup.match(/<button[^>]*data-summary-fix="subclass"[^>]*>Fix<\/button>/)?.[0];
  assert.ok(fix, "a Fix beside the missing pick");
  assert.match(fix, /aria-label="Fix Subclass"/, "its name starts with the word it shows");
  assert.match(fix, /min-h-10/, "a 40px target");
  const edits = [...markup.matchAll(/<button[^>]*data-summary-edit="([^"]+)"[^>]*aria-label="([^"]+)"[^>]*>Edit<\/button>/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(edits.map(([key]) => key), rows.map((row) => row.key));
  assert.equal(edits[3][1], "Edit Ability scores");
  assert.match(markup, /sm:flex-row/, "a row stacks on a phone and sits in a line from sm up");

  const done = renderToStaticMarkup(createElement(SummaryPanel, { rows: summaryRows(complete), onEdit: () => {}, onFix: () => {} }));
  assert.match(done, /Every step is complete\. Edit any row to change it\./);
  assert.doesNotMatch(done, /Still to choose|data-summary-fix/);
});

await test("Edit goes to its row's step and Fix to the owed pick", () => {
  const owed = { ...none, spells: [{ target: "spells", message: "Pick 2 more spells." }, { target: "gear", message: "Too much to carry." }] };
  const rows = summaryRows({ ...complete, owed });
  const edited = [];
  const fixed = [];
  const tree = walk(SummaryPanel({ rows, onEdit: (key) => edited.push(key), onFix: (target) => fixed.push(target) }));
  const buttons = tree.filter((node) => node.type === "button");
  for (const button of buttons) button.props.onClick();
  assert.deepEqual(edited, ["identity", "ancestry", "calling", "abilities", "spells-gear", "finish"]);
  assert.deepEqual(fixed, ["spells", "gear"]);
});

await test("an edit opens on the summary, and every step offers the way back once it is seen", () => {
  const builder = read("src/app/characters/builder/CharacterBuilder.tsx");
  assert.match(builder, /useState\(initial \? STEP_ORDER\.length - 1 : 0\)/, "an edit's first step is the last, the summary");
  assert.match(builder, /useState\(Boolean\(initial\)\)/, "an edit has seen the summary from the start");
  assert.match(builder, /if \(step === STEP_ORDER\.length - 1 && !summarySeen\) \{\n\s+setSummarySeen\(true\);/, "a new build sees it on arrival");
  assert.match(builder, /secondary: \{ label: "Back to summary", onClick: \(\) => backToSummary\(entry\.key\) \}/);
  assert.match(builder, /index === STEP_ORDER\.length - 1\n\s+\? entry/, "the summary itself has no Back to summary");
  assert.match(builder, /steps=\{flow\}/);
  assert.match(builder, /summary=\{summary\}/);
  assert.match(builder, /onFix=\{\(target\) => \{\n\s+setCameFrom\(STEP_OF_TARGET\[target\] as SummaryRowKey\);\n\s+changePick\(target\);/, "Fix goes to the step, then the field");
  assert.match(builder, /\[data-summary-edit="\$\{returnTo\.row\}"\]/, "back on the summary, focus returns to the row's Edit");
  assert.match(builder, /section\[data-active\] \.wizard-step-heading`\)\n\s+\?\.focus\(\{ preventScroll: true \}\);/, "an edit arrives with focus on the summary heading");
  // Save on the summary waits for the first pick owed, and its Show me goes
  // where that row's Fix would.
  assert.match(builder, /canContinue: !busy && !firstOwed,\n\s+blocker: firstOwed\?\.message \?\? null,\n\s+onBlocked: firstOwed \? \(\) => changePick\(firstOwed\.target\) : undefined,/);
  // Saving from any step, the stepper and the names stay.
  assert.match(builder, /finishFromAnyStep=\{Boolean\(initial\)\}/);
  assert.match(builder, /jumpAhead\n/);
  assert.match(builder, /variant="diamonds"\s+stepNames/);
  assert.match(builder, /title: "Check your hero and finish"/);
  // The quiz's character still ends on the summary.
  assert.match(builder, /setStep\(STEP_ORDER\.length - 1\);\n\s+\}\n\s+\},\n\s+\}\);/);

  const finish = read("src/app/characters/builder/steps/FinishStep.tsx");
  assert.match(finish, /<SummaryPanel rows=\{summary\} onEdit=\{editRow\} onFix=\{onFix\} \/>/);
  assert.match(finish, /<div id=\{touchesId\}/, "the finishing touches row comes down to them");
});

await test("the wizard footer shows Back to summary as a named button", () => {
  const steps = [
    { key: "identity", title: "Name", content: null, secondary: { label: "Back to summary", onClick: () => {} } },
    { key: "finish", title: "Check", content: null },
  ];
  const markup = renderToStaticMarkup(createElement(Wizard, { steps, title: "Wren", onDone: () => {}, step: 0, onStepChange: () => {} }));
  assert.match(markup, /<button type="button" data-wizard-secondary=""[^>]*min-h-11[^>]*>Back to summary<\/button>/);
});

await test("the step names keep their own row above the step heading", () => {
  const css = read("src/app/styles/creator.css");
  const rule = css.slice(css.indexOf(".diamond-stepper {"), css.indexOf("}", css.indexOf(".diamond-stepper {")));
  assert.doesNotMatch(rule, /(^|\s)padding:/, "no shorthand padding outranks the names' row");
  const stepper = read("src/components/ui/DiamondStepper.tsx");
  assert.match(stepper, /named && "pb-7"/);
  assert.match(stepper, /text-\[0\.6875rem\] leading-none/, "the names grow with the text");
  assert.match(css, /@container \(width < 22rem\) \{\n\s+\.diamond-step:not\(\[data-state="current"\]\) \[data-diamond-name\] \{ visibility: hidden; \}/, "too narrow for six, only the current name is printed");
});

await test("the edit page's level-up note points to the summary", () => {
  const page = read("src/app/characters/[characterId]/edit/page.tsx");
  assert.match(page, /on its summary/);
  assert.match(page, /with a Fix that goes to it/);
});

console.log(`test-builder-summary: ${passed} passed`);
