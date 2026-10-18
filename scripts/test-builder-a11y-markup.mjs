// The character builder's accessibility fixes, checked where a screen reader
// would meet them: in the markup the components render, and in the styles
// and source a reader depends on. The axe scenario (browser 32-builder-a11y)
// covers the live builder; these checks need no server and name the exact
// fix that would regress.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-dialog-inline.mjs", import.meta.url);
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// B11. A field's caption names it: the block is a group labelled by the
// caption, and a native control can take the caption as its own label.
{
  const { Field } = await import("../src/app/characters/builder/steps/shared.tsx");
  const markup = renderToStaticMarkup(
    createElement(Field, { label: "Background" }, createElement("button", { type: "button" }, "Acolyte")),
  );
  const group = markup.match(/^<div role="group" aria-labelledby="([^"]+)"/);
  assert.ok(group, `a Field is a group labelled by its caption: ${markup}`);
  assert.ok(markup.includes(`<span id="${group[1]}"`), "the caption carries the id the group points at");
  assert.ok(markup.includes(">Acolyte</button>"), "the picker trigger keeps its own name, the value it holds");
  assert.ok(!markup.includes("<label"), "a Field stays a div, so a click on its caption opens nothing inside");

  const named = renderToStaticMarkup(createElement(Field, { label: "Appearance", captionId: "look" }, null));
  assert.ok(named.includes('aria-labelledby="look"') && named.includes('<span id="look"'), "a given caption id is used");

  const finish = read("src/app/characters/builder/steps/FinishStep.tsx");
  const appearance = finish.slice(finish.indexOf('<Field label="Appearance"'), finish.indexOf("</Field>", finish.indexOf('<Field label="Appearance"')));
  assert.ok(appearance.includes("captionId={appearanceId}"), "the Appearance field names its caption");
  assert.ok(appearance.includes("aria-labelledby={appearanceId}"), "the Appearance textarea is labelled by its caption");
  console.log("ok: builder field captions name their fields (B11)");
}

// B12. The score summary is a table: a caption, column headers and a row
// header for each ability, so each number is read against its column.
{
  const { AbilitySummary } = await import("../src/app/characters/builder/AbilitySummary.tsx");
  const rows = [
    { ability: "str", label: "Strength", base: 15, bonus: 2, added: 0 },
    { ability: "dex", label: "Dexterity", base: 14, bonus: 0, added: 1 },
  ];
  const markup = renderToStaticMarkup(createElement(AbilitySummary, { method: "standard", rows, who: "" }));
  assert.ok(markup.includes("<table"), "the summary is a table");
  assert.ok(markup.includes("<caption"), "the table has a caption");
  const columns = [...markup.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((match) => match[1]);
  assert.deepEqual(columns, ["Ability", "Base", "Racial", "Added", "Final", "Mod"]);
  const rowHeads = [...markup.matchAll(/<th scope="row"/g)].length;
  assert.equal(rowHeads, 2, "each ability heads its own row");
  assert.ok(markup.includes('<span class="sr-only">none</span>'), "an empty bonus reads as none, not a dot");
  console.log("ok: the score summary is a table with column and row headers (B12)");
}

// B10. The spell level row and the spellbook step switch are toggle buttons
// in a labelled group, not tabs without panels.
{
  const { SpellBook } = await import("../src/components/sheet/SpellBook.tsx");
  const markup = renderToStaticMarkup(createElement(SpellBook, { tiles: [], maxLevel: 2 }));
  assert.ok(!markup.includes('role="tab'), "no tab or tablist without a panel");
  assert.ok(markup.includes('role="group" aria-label="Spell level"'), "the level buttons are a labelled group");
  const row = markup.slice(markup.indexOf('aria-label="Spell level"'), markup.indexOf("</div>", markup.indexOf('aria-label="Spell level"')));
  const buttons = [...row.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
  assert.ok(buttons.length, "the row has level buttons");
  for (const button of buttons) assert.ok(button.includes('aria-pressed="false"'), `a level is a toggle button: ${button}`);

  const step = read("src/app/characters/builder/steps/SpellsGearStep.tsx");
  assert.ok(!step.includes('role="tab'), "the spellbook step switch is no tab strip");
  assert.ok(step.includes('role="group" aria-label="Spellbook step"'), "the step switch is a labelled group");
  assert.ok(step.includes("aria-pressed={mounted && phase === key}"), "each step button says whether it is on");
  console.log("ok: spell levels and spellbook steps are toggle-button groups (B10)");
}

// B13. With rolled scores an empty socket and a shut Reroll stay in the tab
// order (aria-disabled, not disabled) and point at the note that says why.
{
  const editor = read("src/app/characters/builder/AbilityEditor.tsx");
  const socket = editor.slice(editor.indexOf('className="pool-socket"'), editor.indexOf("</button>", editor.indexOf('className="pool-socket"')));
  // Natively disabled only with no pool at all; it opens while later throws
  // are still landing (Q7, test-builder-quick-wins-b.mjs).
  assert.ok(socket.includes("disabled={!pool}"), "an empty socket is not natively disabled");
  assert.ok(socket.includes("aria-disabled={(slot === null && held === null) || undefined}"), "an empty socket is aria-disabled");
  assert.ok(socket.includes("aria-describedby={pool ? poolNoteId : undefined}"), "the socket points at the tray's note");
  assert.ok(socket.includes("Pick up a throw from the tray first"), "an empty socket says what to do first");
  const reroll = editor.slice(editor.indexOf("onClick={throwPool}"), editor.indexOf("Reroll", editor.indexOf("onClick={throwPool}")));
  assert.ok(reroll.includes("disabled={anyRolling || asking}"), "a shut reroll is not natively disabled");
  assert.ok(reroll.includes("aria-disabled={!rerollOpen || undefined}"), "a shut reroll is aria-disabled");
  assert.ok(reroll.includes("aria-describedby={poolNoteId}"), "the reroll points at the note that states the rule");
  assert.ok(editor.includes('<p id={poolNoteId} className="pool-note"'), "the note carries the id");
  const css = read("src/app/styles/creator.css");
  assert.ok(css.includes('.pool-socket[aria-disabled="true"] { cursor: default; }'), "an aria-disabled socket looks inert");
  console.log("ok: empty score sockets and a shut reroll stay reachable and explained (B13)");
}

// B5. Under reduced motion the "Show me" highlight is a still outline. The
// global rule cuts every animation to 0.01ms, so an animation alone ends
// transparent before anyone sees it.
{
  const css = read("src/app/styles/creator.css");
  const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((match) => match[1]);
  const flash = blocks.find((block) => block.includes("[data-builder-target][data-flash]"));
  assert.ok(flash, "a reduced-motion rule styles the Show me highlight");
  assert.match(flash, /animation: none !important/);
  assert.match(flash, /outline: 3px solid/);
  console.log("ok: the Show me highlight stays visible with reduced motion (B5)");
}

// B14. The roster's portrait spinner is a polite status with words a screen
// reader hears, not a tooltip alone.
{
  const page = read("src/app/characters/page.tsx");
  const pending = page.slice(page.indexOf("portraitPending(character) ?"), page.indexOf(") : (", page.indexOf("portraitPending(character) ?")));
  assert.ok(pending.includes('role="status"'), "the painting spinner is a status");
  assert.match(pending, /<span className="sr-only">Painting .*portrait\.\.\.<\/span>/, "the status has words");
  console.log("ok: the portrait painting spinner is announced (B14)");
}

// B15. The companion dialog's close button has a name, as the shared
// Dialog's does.
{
  const dialog = read("src/app/campaigns/[campaignId]/CompanionBuilderDialog.tsx");
  const closes = [...dialog.matchAll(/<Dialog\.Close\b[^>]*>/g)].map((match) => match[0]);
  assert.ok(closes.length, "the companion dialog has a close button");
  for (const close of closes) assert.ok(close.includes('aria-label="Close"'), `named close: ${close}`);
  console.log("ok: the companion dialog's close button is named (B15)");
}
