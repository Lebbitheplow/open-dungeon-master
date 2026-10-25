// The builder's text, readable at any size (backlog F17): body text is at
// least 1rem, every size is in rem so the device's text setting reaches it,
// only captions sit under 1rem (at 0.875rem, a few named exceptions lower),
// the quiet grey measures 4.5:1 on the night panels, and forced colours,
// more contrast and enlarged text each have their rules. The browser
// scenario 32-builder-a11y checks the same live; this pins the source.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const css = read("src/app/styles/creator.css");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// A rule's body by its exact selector.
function ruleBody(selector) {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `creator.css has ${selector}`);
  return css.slice(at, css.indexOf("}", at));
}

test("inside the builder, Tailwind's small sizes are body size", () => {
  const body = ruleBody("[data-builder-root]");
  assert.match(body, /--text-xs:\s*1rem;/);
  assert.match(body, /--text-sm:\s*1rem;/);
  const builder = read("src/app/characters/builder/CharacterBuilder.tsx");
  assert.match(builder, /data-builder-root=\{rootId\}/, "the builder's root carries the attribute the rule reads");
});

// Every builder component: no px text sizes (the device's text setting never
// reaches them) and nothing under the caption size.
test("builder components size text in rem, at 0.875rem or more", () => {
  const dir = path.join(root, "src/app/characters/builder");
  const files = fs.readdirSync(dir, { recursive: true }).filter((name) => String(name).endsWith(".tsx"));
  assert.ok(files.length > 20);
  const found = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, String(file)), "utf8");
    for (const match of source.matchAll(/\btext-\[(\d*\.?\d+)(px|rem)\]/g)) {
      const rem = match[2] === "px" ? Number(match[1]) / 16 : Number(match[1]);
      if (match[2] === "px" || rem < 0.875) found.push(`${file}: ${match[0]}`);
    }
  }
  assert.deepEqual(found, [], "px sizes or sizes under the caption tier");
});

// creator.css: rem sizes at the caption tier or more, except the named few;
// px only for the big dice totals.
test("creator.css sizes text in rem, with its exceptions named", () => {
  const exceptions = new Map([
    [".creator-selected", "0.8125rem"],
    [".creator-recommended", "0.8125rem"],
    [".die-dropped", "0.6875rem"],
  ]);
  const found = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().split("\n").pop().trim();
    const size = match[2].match(/font-size:\s*([\d.]+)(px|rem)/);
    if (!size) continue;
    const value = Number(size[1]);
    if (size[2] === "px") {
      if (value < 22) found.push(`${selector}: ${size[0]}`);
    } else if (value < 0.875 && exceptions.get(selector) !== `${size[1]}rem`) {
      found.push(`${selector}: ${size[0]}`);
    }
  }
  assert.deepEqual(found, [], "sizes under the caption tier without a reason");
  for (const selector of exceptions.keys()) {
    assert.match(ruleBody(selector), /\/\*[\s\S]+\*\//, `${selector} says why it is smaller`);
  }
});

// WCAG relative luminance and contrast.
const channel = (value) => {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("the night theme's quiet grey reads at 4.5:1 on the builder's panels", () => {
  const night = ruleBody(':root:not([data-theme="light"]) [data-builder-root]');
  const grey = night.match(/--color-stone-500:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(grey, "the builder lifts stone-500 at night");
  // The lightest a step panel gets (its top under the page's glow) and an
  // amber callout on it, composited from globals.css (.panel, body).
  for (const [surface, hex] of [["a step panel's top", "#2a2348"], ["an amber callout", "#3b3147"], ["a card", "#2d254d"]]) {
    assert.ok(contrast(grey, hex) >= 4.5, `${grey} on ${surface} (${hex}): ${contrast(grey, hex).toFixed(2)}:1`);
  }
  // The stock grey it replaces did not.
  assert.ok(contrast("#8f8aab", "#2a2348") < 4.5);
});

test("forced colours mark every state without colour, and the switch draws its knob", () => {
  const forced = css.slice(css.indexOf("@media (forced-colors: active)"));
  assert.match(forced, /\[aria-pressed="true"\][\s\S]*?outline: 3px solid Highlight/, "a pressed choice is outlined");
  assert.match(forced, /:focus-visible \{\s*outline: 2px solid CanvasText/, "focus is outlined");
  assert.match(forced, /\.diamond-step\[data-state="current"\] \.diamond-core \{[^}]*Highlight/, "the current step is filled");
  const globals = read("src/app/globals.css");
  const kit = globals.slice(globals.indexOf("@media (forced-colors: active)"));
  assert.match(kit, /\.kit-switch\[aria-checked="true"\] \.kit-switch-knob \{[^}]*Highlight/, "the switch's knob shows on");
  assert.match(kit, /\.kit-switch:focus-visible \{[^}]*outline/, "and its focus");
});

test("more contrast lifts the greys and solidifies the borders", () => {
  const more = css.slice(css.indexOf("@media (prefers-contrast: more)"));
  assert.match(more, /--color-stone-500:\s*var\(--color-stone-300\)/);
  assert.match(more, /\.creator-card/);
});

test("enlarged text turns the card grid into a list", () => {
  const grid = read("src/app/characters/builder/OptionCardGrid.tsx");
  assert.match(grid, /className="creator-cards /, "the cards' box is the container");
  assert.match(css, /\.creator-cards \{ container: creator-cards \/ inline-size; \}/);
  const query = css.slice(css.indexOf("@container creator-cards"));
  assert.match(query, /^@container creator-cards \(width < [\d.]+rem\)/, "the width is in rem, so it follows the text size");
  assert.match(query, /grid-template-columns: minmax\(0, 1fr\)/, "one column");
  assert.match(ruleBody(".creator-grid"), /minmax\(min\(10rem, 46%\), 1fr\)/, "columns in rem");
});

// At enlarged text the header and the footer wrap rather than cut a word
// short: the hero's name and the character line ("High HP, d10") each keep
// all their words, and Continue never shrinks below its label beside Save
// changes (it read "C..." on a phone at 125%, on main as well).
test("the header and the footer wrap rather than cut their words", () => {
  assert.match(css, /\[data-builder-root\] \[data-wizard-head\] \{ flex-wrap: wrap;/, "the header row wraps");
  assert.match(css, /\[data-builder-root\] \[data-wizard-title\] \{ white-space: normal; text-overflow: clip;/, "the name wraps");
  const aside = css.slice(css.indexOf("[data-builder-root] [data-wizard-aside] {"));
  assert.match(aside, /^[^}]*display: block;[^}]*flex: 1 0 100%;[^}]*white-space: normal;/, "the line has a row of its own, on a phone too");
  const wizard = read("src/components/ui/Wizard.tsx");
  assert.match(wizard, /data-wizard-head=""/);
  assert.match(wizard, /"wizard-continue [^"]*max-sm:flex-auto max-sm:truncate/, "Continue starts at its label's width on a phone, so the footer wraps before it is cut");
});

console.log(`test-builder-readable-text: ${passed} passed`);
