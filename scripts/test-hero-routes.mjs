// The three ways to a hero (src/app/campaigns/[campaignId]/HeroRoutes.tsx):
// which route is marked for which player, and that every place a player
// still needs a hero offers all three, including the composer's gate for
// someone who joined a game in play, where a ready-made hero is announced to
// the DM like a built one.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import { suite } from "./lib/enforce-harness.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { test, finish } = suite("test-hero-routes");
const { heroRouteAdvice } = await import("../src/app/campaigns/[campaignId]/hero-routes.ts");
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

await test("an empty library is pointed at a ready-made hero, opened at once", () => {
  const advice = heroRouteAdvice({ library: [], pregens: 4 });
  assert.equal(advice.suggested, "ready");
  assert.equal(advice.openReady, true);
  assert.equal(advice.library, false);
  assert.match(advice.libraryLine, /Nothing saved yet/);
});

await test("a player with heroes is pointed at their library, by name", () => {
  const advice = heroRouteAdvice({ library: ["Ada", "Bram", "Cole"], pregens: 4 });
  assert.equal(advice.suggested, "library");
  assert.equal(advice.openReady, false);
  assert.match(advice.libraryLine, /^Ada, Bram and 1 more, adapted to this table's level/);
});

await test("a server with no ready-made heroes points at the builder", () => {
  const advice = heroRouteAdvice({ library: [], pregens: 0 });
  assert.equal(advice.suggested, "build");
  assert.equal(advice.ready, false);
});

await test("the lobby, a solo table and the mid-game gate all offer the three routes", () => {
  const lobby = read("src/app/campaigns/[campaignId]/LobbyActions.tsx");
  assert.equal((lobby.match(/<HeroRoutes /g) ?? []).length, 2, "the table's card and the solo card");
  const gate = read("src/app/campaigns/[campaignId]/CharacterGate.tsx");
  assert.match(gate, /<HeroRoutes campaignId=\{campaignId\}/);
  const routes = read("src/app/campaigns/[campaignId]/HeroRoutes.tsx");
  for (const route of ["ready", "library", "build"]) assert.match(routes, new RegExp(`route="${route}"`));
  assert.match(routes, /\$\{page\}\?start=new/, "the builder shortcut is kept");
  const page = read("src/app/campaigns/[campaignId]/character/page.tsx");
  const chooser = read("src/app/campaigns/[campaignId]/HeroChooser.tsx");
  assert.match(page, /<HeroChooser/, "the join page opens on the hero chooser");
  assert.match(chooser, /flow === "join" \? <PregenPicker/, "which offers ready-made heroes beside the library");
  assert.match(page, /In a hurry\? Take a ready-made hero/, "and above the builder");
});

await test("a ready-made hero arriving mid-game is announced to the DM like a built one", () => {
  const pregen = read("src/app/api/campaigns/[campaignId]/sheet/pregen/route.ts");
  const sheet = read("src/app/api/campaigns/[campaignId]/sheet/route.ts");
  for (const route of [pregen, sheet]) assert.match(route, /announceMidGameJoin\(context, /);
});

finish();
