// The builder's first paint, before the option lists answer: it says they
// are loading and never that the content pack is missing. A playtest saw
// "Content pack not installed" flash on a server that had the pack, because
// the options hook started out sure there was none. The first render is what
// renderToStaticMarkup gives, since effects (the fetch) never run there.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { useBuilderOptions } = await import("../src/app/characters/builder/useBuilderOptions.ts");
const { ContentNotices } = await import("../src/app/characters/builder/steps/CallingSetup.tsx");

function FirstPaint() {
  const { packInstalled } = useBuilderOptions();
  return createElement(ContentNotices, { pack: null, packInstalled });
}

const first = renderToStaticMarkup(createElement(FirstPaint));
assert.doesNotMatch(first, /not installed|basic rules set/, `the first paint claims no pack: ${first}`);
assert.match(first, /role="status"[^>]*>Loading the races, classes and backgrounds/, "the first paint says the lists are loading");

// Once the server has answered, each answer reads as before.
const missing = renderToStaticMarkup(createElement(ContentNotices, { pack: null, packInstalled: false }));
assert.match(missing, /basic rules set \(SRD 5\.1\)/);
assert.doesNotMatch(missing, /Loading/);
const installed = renderToStaticMarkup(createElement(ContentNotices, { pack: null, packInstalled: true }));
assert.equal(installed, "");

console.log("builder pack notice: 1 suite passed");
