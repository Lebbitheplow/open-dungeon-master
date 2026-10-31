// Issue 668: the message toolbar had "Pin this to the GM's memory" drawn as
// a bookmark and the lead's "Pin this passage as canon" drawn as a pin,
// while the Pinned memories panel said "press the pin icon", so a player
// pinned a fact as canon by mistake. Pinned memories now wear the one pin,
// and the canon control is "Add to Facts" with the Facts tab's own book.
import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./lib/register-jsx.mjs", import.meta.url);

const { MessageItem } = await import("../src/app/campaigns/[campaignId]/MessageItem.tsx");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const message = {
  id: "m1",
  campaignId: "c1",
  seq: 7,
  authorType: "dm",
  userId: null,
  characterId: null,
  content: "The bridge groans under the cart, and the ford below runs fast and cold.",
  speech: [],
  speaker: null,
  createdAt: new Date(0).toISOString(),
};

function render(extra = {}) {
  return renderToStaticMarkup(
    createElement(MessageItem, {
      message,
      campaignId: "c1",
      cast: [],
      canRetryTurn: false,
      canIllustrate: false,
      mine: false,
      blocked: false,
      rollsById: new Map(),
      sheetsById: new Map(),
      membersById: new Map(),
      locationsById: new Map(),
      sheets: [],
      mediaStatus: {},
      onPinMemory: () => {},
      onPinCanon: () => {},
      ...extra,
    }),
  );
}

// Each toolbar button with its label and the icon it draws.
function toolbar(html) {
  return [...html.matchAll(/<button[^>]*aria-label="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)].map(([, label, inner]) => ({
    label: label.replace(/&#x27;/g, "'"),
    icon: /lucide-([a-z-]+)/.exec(inner)?.[1] ?? "",
  }));
}

test("the GM's memory wears the one pin, and the canon control wears the Facts book", () => {
  const buttons = toolbar(render());
  const memory = buttons.find((button) => button.label === "Pin this to the GM's memory");
  const canon = buttons.find((button) => button.label === "Add this passage to Facts as canon");
  assert.ok(memory, `the memory button is there: ${JSON.stringify(buttons)}`);
  assert.ok(canon, `the canon button is there: ${JSON.stringify(buttons)}`);
  assert.equal(memory.icon, "pin");
  // The Facts tab's own icon (BookMarked), a book with its ribbon.
  assert.equal(canon.icon, "book-bookmark");
  assert.equal(buttons.filter((button) => button.icon === "pin").length, 1, "only one control is a pin");
  assert.ok(!buttons.some((button) => /^Pin this passage as canon$/.test(button.label)), "no control is named pin as canon");
});

test("a player who cannot write canon still sees the memory pin", () => {
  const buttons = toolbar(render({ onPinCanon: undefined }));
  assert.ok(buttons.some((button) => button.label === "Pin this to the GM's memory" && button.icon === "pin"));
  assert.ok(!buttons.some((button) => button.icon === "book-bookmark"));
});

console.log(`message pins: ${passed} checks passed`);
