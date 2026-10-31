// Issue 668: the "Previously" recap that opens a session was posted as a
// system line and took the faint italic system style, lighter than the
// narration, so it was easy to miss. It stays a system line (the recap
// filter, the export and the voice read it as one) but the table draws it
// as a card at narration weight under a "Previously" heading.
import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./lib/register-jsx.mjs", import.meta.url);

const { SystemMessage } = await import("../src/app/campaigns/[campaignId]/MessageParts.tsx");
const { RECAP_PREFIX, systemNoteWords } = await import("../src/lib/campaign-types.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const recap = `${RECAP_PREFIX}You crossed the ford at dusk and the miller's daughter vanished from the mill.`;

test("the recap is drawn as its own card under a Previously heading", () => {
  const html = renderToStaticMarkup(createElement(SystemMessage, { content: recap, glyph: "cue-bell" }));
  assert.match(html, /session-recap/);
  assert.match(html, /aria-label="Previously"/);
  assert.match(html, />Previously</, "a visible heading");
  assert.match(html, /session-recap-text/);
  assert.match(html, /You crossed the ford at dusk/);
  assert.doesNotMatch(html, /Previously: You crossed/, "the prefix is the heading, not printed twice");
  assert.doesNotMatch(html, /session-sysline/, "not the faint system line");
});

test("any other system line keeps the system style", () => {
  const html = renderToStaticMarkup(createElement(SystemMessage, { content: "Seren walked out on the party.", glyph: "system-party" }));
  assert.match(html, /session-sysline/);
  assert.doesNotMatch(html, /session-recap/);
});

test("the recap keeps the words a stored line has always had", () => {
  // Older app shells draw it as a plain line; its text is unchanged.
  assert.equal(RECAP_PREFIX, "Previously: ");
  assert.equal(systemNoteWords(recap), recap);
});

console.log(`system lines: ${passed} checks passed`);
