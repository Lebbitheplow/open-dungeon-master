// Sound the browser holds until the tab is clicked is said on the table
// (AudioWaitingBanner.tsx): narration with its count, the room's sound when
// that is all that waits, and nothing at all when nothing waits. A click
// plays only the newest held passage, so the banner must not promise more.
// The hold and the click that clears it run in a browser:
// scripts/browser/scenarios/53-narration-waiting.mjs.
import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./lib/register-jsx.mjs", import.meta.url);
const { AudioWaitingBanner } = await import("../src/app/campaigns/[campaignId]/AudioWaitingBanner.tsx");

const render = (narrationHeld, ambienceWaiting) =>
  renderToStaticMarkup(createElement(AudioWaitingBanner, { narrationHeld, ambienceWaiting, onListen: () => {} }));

assert.equal(render(0, false), "", "nothing waiting, no banner");

const three = render(3, false);
assert.ok(three.includes("Narration is waiting"), three);
assert.ok(three.includes(">Click to listen<"), "the button promises no count: one click plays one passage");
assert.ok(three.includes("3 passages arrived while your browser held sound back"), three);
assert.ok(three.includes("Click to hear the newest; the others have replay buttons."), three);
assert.ok(!/waiting for you/.test(three), "no longer says all of them wait to be played");
assert.ok(three.includes('role="status"'), "read out to a screen reader");
assert.ok(!/dismiss/i.test(three), "nothing to dismiss: the click is the fix");

const one = render(1, false);
assert.ok(one.includes("A passage arrived while your browser held sound back. Click to hear it."), one);
assert.ok(!one.includes("newest"), "one passage has no older ones to point at");

const room = render(0, true);
assert.ok(room.includes("Sound is waiting"), room);
assert.ok(room.includes(">Click to listen<"), room);

// Narration leads when both wait: one click starts both.
assert.ok(render(2, true).includes("Narration is waiting"));

console.log("test-audio-waiting-banner: held narration and room sound are said, with the count and what one click plays");
