// Six small accessibility fixes from the builder backlog's quick wins, each
// checked where it would regress: the tap targets that reach 44 px (Q4), the
// spell limit note shown whole with its working (Q5), the throw buttons that
// name the set-aside die and wake as their own dice land (Q7), the motion
// that follows the Effects setting (Q8, with test-motion-rest-states.mjs),
// and the level-up moment that waits for a named Dismiss (Q9).
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// The body of the first rule whose selector is exactly `selector`.
function ruleBody(css, selector) {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at !== -1, `a ${selector} rule`);
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
}
const px = (body, prop) => Number(body.match(new RegExp(`(?:^|\\s)${prop}:\\s*(-?\\d+)px`))?.[1]);
// The reach of a button grown by a pseudo-element: its size plus twice the
// ring past its edge (a negative inset).
function reach(css, selector, axis) {
  const own = px(ruleBody(css, selector), axis);
  const ring = ruleBody(css, `${selector}::after`);
  assert.match(ring, /content:\s*""/, `${selector}::after is drawn`);
  assert.match(ring, /position:\s*absolute/, `${selector}::after sits over the button, outside the layout`);
  const inset = ring.match(/inset:\s*(-?\d+)px(?:\s+(-?\d+)(?:px)?)?/);
  assert.ok(inset, `${selector}::after has an inset`);
  const grow = axis === "height" ? Number(inset[1]) : Number(inset[2] ?? inset[1]);
  return own - 2 * grow;
}

await test("Q4: diamonds, help buttons and method options reach 44 px without growing", () => {
  const css = read("src/app/styles/creator.css");
  assert.equal(px(ruleBody(css, ".diamond-button"), "width"), 36, "the diamond keeps its 36 px box");
  assert.ok(reach(css, ".diamond-button", "width") >= 44, "the diamond reaches 44 px across");
  assert.ok(reach(css, ".diamond-button", "height") >= 44, "the diamond reaches 44 px down");
  assert.equal(px(ruleBody(css, ".creator-help"), "width"), 32, "the help button keeps its 32 px box");
  assert.ok(reach(css, ".creator-help", "width") >= 44, "the help button reaches 44 px");
  assert.equal(px(ruleBody(css, ".method-option"), "height"), 30, "the method option is drawn 30 px tall");
  assert.ok(reach(css, ".method-option", "height") >= 44, "the method option reaches 44 px tall");
  // The method option's ::before is its gold fill; the hit ring must not be it.
  assert.match(ruleBody(css, ".method-option::before"), /inset:\s*0;/, "the fill stays on the drawn button");
});

await test("Q4: a chip's remove cross reaches 44 px", async () => {
  const { Chip } = await import("../src/app/characters/builder/steps/shared.tsx");
  const markup = renderToStaticMarkup(createElement(Chip, { label: "Shield", onRemove() {} }));
  const button = markup.match(/<button[^>]*aria-label="Remove Shield"[^>]*>/)?.[0] ?? "";
  assert.ok(button, `a named remove button: ${markup}`);
  assert.match(button, /\brelative\b/, "the cross anchors its ring");
  assert.match(button, /after:absolute/, "the ring sits outside the layout");
  // size-3 is 12 px; -inset-4 adds 16 px on each side.
  assert.match(button, /after:-inset-4\b/, "12 px + 2 x 16 px = 44 px");
  // The quotes come back escaped in the markup.
  assert.match(button, /after:content-\[&#x27;&#x27;\]/, "the ring is drawn");
});

await test("Q4: the lobby's Remove stands apart from Switch, every action 44 px tall", () => {
  const source = read("src/app/campaigns/[campaignId]/LobbyActions.tsx");
  const block = source.slice(source.indexOf("function CharacterActions"), source.indexOf("// Opening the adventure."));
  const edit = block.indexOf("> Edit");
  const swap = block.indexOf("> Switch");
  const remove = block.indexOf("> Remove");
  assert.ok(edit !== -1 && swap > edit && remove > swap, "Edit, Switch, then Remove last");
  assert.equal((block.match(/min-h-11/g) ?? []).length, 3, "each of the three is 44 px tall");
  const removeButton = block.slice(block.lastIndexOf("<button", remove), remove);
  assert.match(removeButton, /\bml-6\b/, "Remove keeps a gap from Switch beyond the row's own");
});

await test("Q5: the spell limit note shows whole, wrapping, with no tooltip", async () => {
  const { SpellBook } = await import("../src/components/sheet/SpellBook.tsx");
  const note = "You can prepare 4 spells: Wisdom modifier (+2) + level (2). Unprepare one to prepare Bless.";
  const markup = renderToStaticMarkup(
    createElement(SpellBook, {
      maxLevel: 1,
      onTile() {},
      notice: note,
      tiles: [{ name: "Bless", level: 1, state: "available" }],
    }),
  );
  const status = markup.match(/<span role="status"[^>]*>([^<]*)<\/span>/);
  assert.ok(status, `the note is a status line: ${markup.slice(0, 600)}`);
  assert.equal(status[1].replace(/&#x27;|&#39;/g, "'"), note, "the whole sentence, not a cut one");
  assert.doesNotMatch(status[0], /\btruncate\b/, "the note is not cut to one line");
  assert.doesNotMatch(status[0], /\btitle=/, "no tooltip holds the rest of it");
  const row = markup.slice(markup.lastIndexOf("<p", markup.indexOf('role="status"')), markup.indexOf('role="status"'));
  assert.match(row, /flex-wrap/, "the note's row wraps");
  assert.doesNotMatch(row, /\bh-4\b/, "the row is not held to one line's height");
});

await test("Q5: a prepared caster's limit carries its working", async () => {
  const { preparedFormula } = await import("../src/app/characters/builder/casting.ts");
  assert.equal(preparedFormula("wis", 2, "cleric", 3), "Wisdom modifier (+2) + level (3)");
  assert.equal(preparedFormula("cha", 1, "paladin", 5), "Charisma modifier (+1) + half your level, rounded down (2)");
  assert.equal(preparedFormula("int", -1, "wizard", 1), "Intelligence modifier (-1) + level (1), and never fewer than 1");
  const step = read("src/app/characters/builder/steps/SpellsGearStep.tsx");
  assert.equal((step.match(/\$\{limitWhy\}/g) ?? []).length, 2, "both prepared-count notes say the working");
});

await test("Q7: a throw's name says which die was set aside", async () => {
  const { rollWord, throwName } = await import("../src/app/characters/builder/abilityDice.ts");
  const thrown = { total: 14, roll: { dice: [6, 2, 5, 3], dropIndex: 1, total: 14, rest: [] } };
  assert.equal(throwName(thrown, "Strength"), "Throw of 14, good, from 6, 5, 3 and a 2 set aside, on Strength");
  assert.equal(throwName(thrown, null), "Throw of 14, good, from 6, 5, 3 and a 2 set aside, not placed");
  assert.equal(throwName({ total: 12, roll: null }, null), `Throw of 12, ${rollWord(12)}, not placed`, "a kept score has no dice to name");
});

await test("Q7: each throw wakes as its own dice land", () => {
  const editor = read("src/app/characters/builder/AbilityEditor.tsx");
  const token = editor.slice(editor.indexOf('className="pool-token"'), editor.indexOf("onClick={() => setHeld(inHand ? null : index)}"));
  assert.match(token, /disabled=\{rolling\}/, "a throw is disabled only while its own dice roll");
  assert.match(token, /draggable=\{!rolling\}/, "and can be dragged once they land");
  assert.match(token, /aria-label=\{throwName\(/, "the name comes from throwName");
  assert.doesNotMatch(token, /disabled=\{anyRolling\}/, "not held until all six land");
  const socket = editor.slice(editor.indexOf('className="pool-socket"'), editor.indexOf("onClick={() => tapSocket(ability)}"));
  assert.doesNotMatch(socket, /anyRolling/, "a landed throw can be placed while others still roll");
});

await test("Q8: the dice toss and the Show me scroll follow the Effects setting", async () => {
  for (const file of ["src/app/characters/builder/AbilityEditor.tsx", "src/app/characters/builder/CharacterBuilder.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /prefers-reduced-motion/, `${file} asks the shared check, not the system setting alone`);
    assert.match(source, /prefersStillMotion\(\)/, `${file} reads prefersStillMotion`);
  }
  const { prefersStillMotion } = await import("../src/lib/effects-mode.ts");
  const store = new Map();
  const stub = (reduced) => {
    globalThis.window = {
      matchMedia: () => ({ matches: reduced }),
      localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) },
      dispatchEvent() {},
    };
    globalThis.navigator ??= {};
  };
  const { writeEffectsMode } = await import("../src/lib/effects-mode.ts");
  stub(false);
  writeEffectsMode("full");
  assert.equal(prefersStillMotion(), false, "full effects, no system ask: motion plays");
  writeEffectsMode("low");
  assert.equal(prefersStillMotion(), true, "low effects alone stills it");
  stub(true);
  writeEffectsMode("full");
  assert.equal(prefersStillMotion(), true, "the system's reduced motion alone stills it");
  delete globalThis.window;
});

await test("Q9: the level-up moment waits for a named Dismiss when still", () => {
  const source = read("src/app/campaigns/[campaignId]/Moments.tsx");
  const moment = source.slice(source.indexOf("export function LevelUpMoment"), source.indexOf("const REST_MS"));
  assert.doesNotMatch(moment, /setTimeout\([^)]*900/, "no 900 ms close under reduced motion");
  assert.match(moment, /useLowEffects\(\)/, "it follows the Effects setting");
  assert.match(moment, /prefersReducedMotion\(\)/, "and the system's");
  assert.match(moment, /if \(still\) return;/, "a still moment sets no timer");
  assert.match(moment, /useEscapeToSkip\(true, onDone\)/, "Escape still skips it");
  const stage = moment.match(/<div className="moment-stage"[^>]*>/)?.[0] ?? "";
  assert.ok(stage, "the stage renders");
  assert.doesNotMatch(stage, /onClick/, "the stage is not a clickable div");
  assert.doesNotMatch(stage, /role=/, "the stage carries no role; the words are the status");
  assert.match(moment, /<button ref=\{dismiss\} type="button" className="moment-dismiss" onClick=\{onDone\}>\s*Dismiss\s*<\/button>/, "a named Dismiss button");
  assert.match(moment, /dismiss\.current\?\.focus/, "Dismiss takes focus, so Enter or Space closes it");
  const css = read("src/app/styles/moments.css");
  assert.ok(px(ruleBody(css, ".moment-dismiss"), "min-height") >= 44, "Dismiss is 44 px tall");
  assert.match(css, /\.moment-stage\[data-still\] \.moment-ring \{ display: none; \}/, "the still card drops the rings");
});

console.log(`test-builder-quick-wins-b: ${passed} passed`);
