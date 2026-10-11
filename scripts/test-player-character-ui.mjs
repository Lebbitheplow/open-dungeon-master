import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
register("./lib/register-jsx.mjs", import.meta.url);
const { LobbyParty } = await import("../src/app/campaigns/[campaignId]/LobbyParty.tsx");
const sheet = (id, userId, name, more = {}) => ({ id, userId, name, race: "human", class: "fighter", level: 1, ...more });
const sheets = [sheet("a1", "a", "A1"), sheet("a2", "a", "A2", { race: "homebrew:species", raceLabel: "Table Species" }), sheet("b1", "b", "B1"), sheet("b2", "b", "B2")];
const companion = sheet("bot", "bot", "Guide", { isCompanion: true });
const markup = renderToStaticMarkup(createElement(LobbyParty, {
  campaign: { maxPlayers: 6, leadUserId: "a", dmUserId: null, assistantDmUserId: null },
  members: [{ userId: "a", username: "Player A", activeCharacterId: "a2" }, { userId: "b", username: "Player B", activeCharacterId: "b2" }], sheets,
  showParty: true, showCompanions: true, partyCompanions: [companion],
}));
for (const name of ["A1", "A2", "B1", "B2", "Guide", "Table Species"]) assert.ok(markup.includes(name), name);
assert.ok(!markup.includes("homebrew:species"));
console.log("ok: lobby renders both humans' sheets, custom species and distinct AI");

const { openWorld } = await import("./lib/enforce-world.mjs");
const world = await openWorld();
const hero = world.addHero({ name: "Selected hero" });
const { PartyPanel } = await import("../src/app/campaigns/[campaignId]/PartyPanel.tsx");
const party = renderToStaticMarkup(createElement(PartyPanel, {
  sheets: [{ ...hero, race: "homebrew:species", raceLabel: "Table Species" }],
  meUserId: hero.userId, campaignId: world.campaignId, activeSheetId: hero.id,
}));
assert.ok(party.includes("Table Species"));
assert.ok(!party.includes("homebrew:species"));
console.log("ok: the active party panel preserves custom species display labels");
world.close();
