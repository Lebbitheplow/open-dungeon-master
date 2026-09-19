// Emphasis in DM narration: **bold** and *italic* become spans, never asterisks.
import assert from "node:assert/strict";
import { parseInlineMarkdown } from "../src/lib/dm/inline-markdown.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const plain = (text) => ({ text, bold: false, italic: false });

test("plain prose is one untouched span", () => {
  assert.deepEqual(parseInlineMarkdown("The husk turns."), [plain("The husk turns.")]);
  assert.deepEqual(parseInlineMarkdown(""), []);
});

test("bold, italic and both", () => {
  assert.deepEqual(parseInlineMarkdown("The **Salt-Glass Husk** lunges."), [
    plain("The "),
    { text: "Salt-Glass Husk", bold: true, italic: false },
    plain(" lunges."),
  ]);
  assert.deepEqual(parseInlineMarkdown("It was *almost* quiet."), [
    plain("It was "),
    { text: "almost", bold: false, italic: true },
    plain(" quiet."),
  ]);
  assert.deepEqual(parseInlineMarkdown("***Roll initiative.***"), [
    { text: "Roll initiative.", bold: true, italic: true },
  ]);
});

test("several runs in one passage, across a line break", () => {
  const spans = parseInlineMarkdown("**Thane** strikes.\n**Brisca** looses.");
  assert.deepEqual(
    spans.map((span) => [span.text, span.bold]),
    [["Thane", true], [" strikes.\n", false], ["Brisca", true], [" looses.", false]],
  );
});

test("half a pair is dropped, not printed", () => {
  // A passage split at a quote, or a draft still streaming.
  assert.deepEqual(parseInlineMarkdown("**Halt"), [plain("Halt")]);
  assert.deepEqual(parseInlineMarkdown("she says.** Then"), [plain("she says. Then")]);
  assert.deepEqual(parseInlineMarkdown("a ** b"), [plain("a  b")]);
});

test("a lone asterisk that is not emphasis stays", () => {
  assert.deepEqual(parseInlineMarkdown("5 * 3 is 15"), [plain("5 * 3 is 15")]);
  assert.deepEqual(parseInlineMarkdown("a footnote*"), [plain("a footnote*")]);
});

test("no output ever contains a double asterisk", () => {
  for (const sample of ["**a** **b", "****", "**a***", "x ** y ** z", "*a **b** c*"]) {
    for (const span of parseInlineMarkdown(sample)) {
      assert.ok(!span.text.includes("**"), `${sample} -> ${span.text}`);
    }
  }
});

console.log(`inline-markdown: ${passed} passed`);
