// One tab stop per group of choices (backlog F16): the standard array's
// rows, the method switch and the race and class card grids each take one
// tab stop, with the arrow keys inside. The movement rules are pure and
// pinned here; the tab stops are checked in the rendered markup; the key
// handler runs against stand-in elements, since these suites have no DOM.
// The live walk is in browser scenario 32-builder-a11y.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-dialog-inline.mjs", import.meta.url);
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { gridMove, linearMove, rovingKeyDown, tabStop } = await import("../src/app/characters/builder/roving.ts");
const noop = () => {};

// Along a row: the arrows step and wrap at both ends, Home and End jump,
// any other key (Enter, Space, Tab, a letter) is not a move.
{
  assert.equal(linearMove("ArrowRight", 0, 6), 1);
  assert.equal(linearMove("ArrowDown", 2, 6), 3, "Down steps on, as Right does");
  assert.equal(linearMove("ArrowRight", 5, 6), 0, "Right wraps from the last to the first");
  assert.equal(linearMove("ArrowLeft", 0, 6), 5, "Left wraps from the first to the last");
  assert.equal(linearMove("ArrowUp", 3, 6), 2, "Up steps back, as Left does");
  assert.equal(linearMove("Home", 4, 6), 0);
  assert.equal(linearMove("End", 1, 6), 5);
  for (const key of ["Enter", " ", "Tab", "i", "Escape"]) assert.equal(linearMove(key, 2, 6), null, `${JSON.stringify(key)} is not a move`);
  assert.equal(linearMove("ArrowRight", 0, 0), null, "an empty group has nowhere to go");
  console.log("ok: arrows step and wrap along a row, Home and End jump to its ends (F16)");
}

// In a grid: rows and columns read from where the cards sit. Two groups of
// cards, three to a row, the second under a heading:
//   0 1 2
//   3 4
//   ----- heading
//   5 6 7
{
  const card = (column, top) => ({ left: column * 110, top, width: 100, height: 140 });
  const rects = [card(0, 0), card(1, 0), card(2, 0), card(0, 150), card(1, 150), card(0, 340), card(1, 340), card(2, 342)];
  assert.equal(gridMove("ArrowDown", 1, rects), 4, "Down goes to the card below");
  assert.equal(gridMove("ArrowDown", 2, rects), 4, "Down from a column the next row lacks goes to the nearest card");
  assert.equal(gridMove("ArrowDown", 4, rects), 6, "Down crosses a group heading into the next group");
  assert.equal(gridMove("ArrowUp", 7, rects), 4, "a card nudged two pixels still counts as in its row");
  assert.equal(gridMove("ArrowUp", 1, rects), 1, "Up from the first row stays put");
  assert.equal(gridMove("ArrowDown", 6, rects), 6, "Down from the last row stays put");
  assert.equal(gridMove("ArrowRight", 2, rects), 3, "Right runs on into the next row");
  assert.equal(gridMove("ArrowRight", 7, rects), 0, "Right wraps from the last card to the first");
  assert.equal(gridMove("ArrowLeft", 0, rects), 7, "Left wraps from the first card to the last");
  assert.equal(gridMove("Home", 6, rects), 0);
  assert.equal(gridMove("End", 0, rects), 7);
  assert.equal(gridMove("Enter", 3, rects), null, "Enter is not a move");
  console.log("ok: arrows move across a card grid's rows and columns, wrapping left and right (F16)");
}

// Which item holds the tab stop: the last focused while it is shown, else
// the chosen one, else the first.
{
  assert.equal(tabStop(["a", "b", "c"], null, null), "a");
  assert.equal(tabStop(["a", "b", "c"], null, "c"), "c");
  assert.equal(tabStop(["a", "b", "c"], "b", "c"), "b", "the last focused item keeps the stop");
  assert.equal(tabStop(["a", "c"], "b", "c"), "c", "a focused card the search hid gives the stop back to the chosen one");
  assert.equal(tabStop(["a", "c"], "b", "z"), "a", "with neither shown, the first holds it");
  assert.equal(tabStop([], null, null), null);
  console.log("ok: the tab stop sits on the last focused, else the chosen, else the first item (F16)");
}

// The handler, with stand-ins for the buttons: an arrow moves focus and is
// kept from scrolling the page; Enter and Space are left to the button, so
// its click chooses; a press with a modifier or on the "?" is left alone.
{
  const make = (keys) => {
    const log = [];
    const items = keys.map((key, at) => ({
      key,
      hasAttribute: (name) => name === "data-roving-item",
      getAttribute: (name) => (name === "data-roving-item" ? key : null),
      getBoundingClientRect: () => ({ left: at * 110, top: 0, width: 100, height: 140 }),
      focus: () => log.push(`focus ${key}`),
    }));
    const container = { querySelectorAll: () => items };
    const press = (key, at, extra = {}) => {
      let prevented = false;
      const moved = rovingKeyDown(
        {
          key,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          preventDefault: () => (prevented = true),
          target: typeof at === "number" ? items[at] : at,
          currentTarget: container,
          ...extra,
        },
        "row",
      );
      return { moved, prevented };
    };
    return { log, press };
  };
  const { log, press } = make(["15", "14", "13", "12", "10", "8"]);
  assert.deepEqual(press("ArrowRight", 0), { moved: "14", prevented: true });
  assert.deepEqual(press("ArrowLeft", 0), { moved: "8", prevented: true }, "Left wraps to the end");
  assert.deepEqual(press("End", 1), { moved: "8", prevented: true });
  assert.deepEqual(press("Home", 4), { moved: "15", prevented: true });
  assert.deepEqual(log, ["focus 14", "focus 8", "focus 8", "focus 15"]);
  for (const key of ["Enter", " "]) {
    assert.deepEqual(press(key, 2), { moved: null, prevented: false }, `${JSON.stringify(key)} reaches the button, which chooses`);
  }
  assert.deepEqual(press("ArrowRight", 2, { ctrlKey: true }), { moved: null, prevented: false }, "Ctrl+Arrow is another shortcut");
  const help = { hasAttribute: () => false, getAttribute: () => null };
  assert.deepEqual(press("ArrowRight", help), { moved: null, prevented: false }, "an arrow on a card's ? is not a move");
  assert.equal(log.length, 4, "nothing else took focus");
  console.log("ok: arrows move focus, Enter and Space are left to the button to choose (F16)");
}

const tabStops = (markup, pattern) =>
  [...markup.matchAll(/<button\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((button) => pattern.test(button))
    .map((button) => ({ label: button.match(/aria-label="([^"]+)"/)?.[1], tabindex: button.match(/tabindex="(-?\d)"/)?.[1] }));

// A standard-array row is one stop: the assigned value, or the first while
// none is, with the group, toggle states and names as before.
{
  const { StandardArrayRow } = await import("../src/app/characters/builder/AbilityEditor.tsx");
  const row = (assigned) =>
    renderToStaticMarkup(createElement(StandardArrayRow, { label: "Strength", assigned, isTaken: (value) => value === 15, onAssign: noop }));
  const held = row(13);
  assert.ok(held.includes('role="group" aria-label="Strength score"'), "the row is still a labelled group");
  const stops = tabStops(held, /slot-button/);
  assert.equal(stops.length, 6);
  assert.deepEqual(stops.filter((stop) => stop.tabindex === "0").map((stop) => stop.label), ["Strength 13"], "the assigned value holds the row's one stop");
  assert.ok(stops.every((stop) => stop.tabindex === "0" || stop.tabindex === "-1"), "every other value is out of the tab order");
  assert.ok(held.includes('aria-pressed="true"') && held.match(/aria-pressed="false"/g).length === 5, "the assigned value is pressed, the rest are not");
  assert.ok(held.includes('aria-label="Strength 15, held by another ability"'), "a value held elsewhere still says so");
  const empty = tabStops(row(null), /slot-button/);
  assert.deepEqual(empty.filter((stop) => stop.tabindex === "0").map((stop) => stop.label), ["Strength 15, held by another ability"], "with nothing assigned the first value holds the stop");
  console.log("ok: each standard-array row is one tab stop on its assigned value (F16)");
}

// The method switch is one stop, on the method in use; its ? stays its own.
{
  const { default: AbilityEditor } = await import("../src/app/characters/builder/AbilityEditor.tsx");
  const blank = { str: null, dex: null, con: null, int: null, wis: null, cha: null };
  const markup = renderToStaticMarkup(
    createElement(AbilityEditor, {
      method: "pointbuy",
      onMethodChange: noop,
      scores: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
      onScoresChange: noop,
      pool: null,
      onPoolChange: noop,
      slots: blank,
      onSlotsChange: noop,
      racialBonus: {},
    }),
  );
  const switchMarkup = markup.slice(markup.indexOf('class="method-switch"'), markup.indexOf("</div>", markup.indexOf('class="method-switch"')));
  const options = [...switchMarkup.matchAll(/<button\b[^>]*class="method-option"[^>]*>/g)].map((match) => match[0]);
  assert.equal(options.length, 3, "three ways to get scores");
  const on = options.filter((button) => button.includes('tabindex="0"'));
  assert.equal(on.length, 1, "one of the three holds the stop");
  assert.ok(on[0].includes('aria-pressed="true"'), "the stop is on the method in use");
  assert.ok(options.filter((button) => button.includes('tabindex="-1"')).every((button) => button.includes('aria-pressed="false"')));
  const help = switchMarkup.match(/<button\b[^>]*aria-label="About [^"]*"[^>]*>/)?.[0];
  assert.ok(help && !help.includes("tabindex"), "the method's ? stays a stop of its own");
  console.log("ok: the method switch is one tab stop on the method in use (F16)");
}

// A card grid is one stop, on the chosen card, and only that card's ? is
// a further stop; the roles and names stay as #367, #396 and #345 left them.
{
  const { OptionCardGrid } = await import("../src/app/characters/builder/OptionCardGrid.tsx");
  const grid = (value) =>
    renderToStaticMarkup(
      createElement(OptionCardGrid, {
        groups: [
          {
            label: "Fits this setting",
            recommended: true,
            options: [{ id: "elf", name: "Elf", art: "/a.webp", tagline: "Graceful", chips: ["DEX +2"] }],
          },
          {
            label: "Others",
            options: [
              { id: "dwarf", name: "Dwarf", art: "/b.webp", tagline: "Stout", chips: ["CON +2"] },
              { id: "human", name: "Human", art: "/c.webp", tagline: "Versatile", chips: ["+1 all"] },
            ],
          },
        ],
        value,
        onChoose: noop,
        onDetails: noop,
        noun: "lineage",
        facets: [{ key: "raises", label: "Raises", options: [{ value: "con", label: "CON" }], test: () => true }],
      }),
    );
  const chosen = grid("dwarf");
  const cards = tabStops(chosen, /class="creator-card /);
  const helps = tabStops(chosen, /class="creator-help"/);
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.filter((stop) => stop.tabindex === "0").map((stop) => stop.label), ["Dwarf"], "the chosen card holds the grid's stop");
  assert.deepEqual(helps.filter((stop) => stop.tabindex === "0").map((stop) => stop.label), ["Details for Dwarf"], "only the chosen card's ? is a stop");
  assert.ok([...cards, ...helps].every((stop) => stop.tabindex === "0" || stop.tabindex === "-1"));
  assert.ok(chosen.includes('aria-label="Elf, fits this setting"'), "a recommended card keeps its name");
  assert.equal((chosen.match(/aria-pressed="true"/g) ?? []).length, 1, "one card is pressed");
  assert.match(chosen, /<input[^>]*type="search"[^>]*aria-label="Search lineages"/, "the search box is untouched (#396)");
  assert.ok(!/<input[^>]*type="search"[^>]*tabindex/.test(chosen), "the search box keeps its own stop");
  assert.ok(chosen.includes('role="group" aria-label="Filter lineages"'), "the filter bar is untouched (#345)");
  assert.ok(chosen.includes("move between them with the arrow keys"), "the search hint says how to move through the cards");
  const none = grid("");
  assert.deepEqual(tabStops(none, /class="creator-card /).filter((stop) => stop.tabindex === "0").map((stop) => stop.label), ["Elf, fits this setting"], "with nothing chosen the first card holds the stop");
  assert.deepEqual(tabStops(none, /class="creator-help"/).filter((stop) => stop.tabindex === "0").map((stop) => stop.label), ["Details for Elf"]);
  console.log("ok: a card grid is one tab stop with the focused card's ? as the next (F16)");
}
