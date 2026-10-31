// The after-the-fight card names the foes it left lying knocked out (issue
// #667): "spared", the word describeEncounterSummary keeps for the chapter,
// beside "slain", and only when there are some.
import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./lib/register-jsx.mjs", import.meta.url);
const { FightSummaryCard } = await import("../src/app/campaigns/[campaignId]/FightSummaryCard.tsx");
const { describeEncounterSummary } = await import("../src/lib/dm/encounter-summary.ts");

const summary = (patch = {}) => ({
  outcome: "victory",
  rounds: 4,
  seconds: 60,
  kills: 2,
  fled: 0,
  fighters: [],
  totals: { dealt: 30, taken: 4, healed: 0, nat20s: 0, nat1s: 0 },
  ...patch,
});
const render = (card) => renderToStaticMarkup(createElement(FightSummaryCard, { summary: card, onDismiss: () => {} }));
// The tiles, as [value, label] in order.
const tiles = (html) => [...html.matchAll(/<p class="font-display[^"]*">([^<]*)<\/p><p class="eyebrow[^"]*">([^<]*)<\/p>/g)].map((match) => [match[2], match[1]]);

const spared = render(summary({ spared: 1 }));
const labels = tiles(spared).map(([label]) => label);
assert.ok(labels.includes("spared"), spared);
assert.equal(labels.indexOf("spared"), labels.indexOf("slain") + 1, "beside the slain");
assert.deepEqual(tiles(spared).find(([label]) => label === "spared"), ["spared", "1"]);
assert.match(describeEncounterSummary(summary({ spared: 1 })), /1 knocked out and spared/, "the same word the chapter keeps");

for (const card of [summary(), summary({ spared: 0 })]) {
  const html = render(card);
  assert.equal(tiles(html).some(([label]) => label === "spared"), false, "no tile when nobody was spared");
  assert.equal(tiles(html).length, 8);
}

console.log("test-fight-summary-card: 3 checks passed");
