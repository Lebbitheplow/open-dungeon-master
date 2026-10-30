// A card names a character's species and classes, never their ids. The 0.31.1
// playtest saw "bhain-kwai paladin 5" on the lobby's companion card,
// "bhain-kwai fighter 3 / rogue 2" on the party roster and "human
// plague_doctor 1" on a companion the GM added: each card printed the sheet's
// ids, where the sheet dialog and the library already read them as names.
import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
register("./lib/register-jsx.mjs", import.meta.url);

const words = await import("../src/lib/characters/class-words.ts");
const { arrivalDetail } = await import("../src/app/campaigns/[campaignId]/arrival.ts");
const { LobbyParty } = await import("../src/app/campaigns/[campaignId]/LobbyParty.tsx");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const minotaur = { race: "bhain-kwai", class: "fighter", level: 5, classes: [{ id: "fighter", level: 3 }, { id: "rogue", level: 2 }] };
const widow = { race: "human", class: "plague_doctor", level: 1 };

await test("an id reads as a name, and a homebrew id as nothing", () => {
  assert.equal(words.idAsName("bhain-kwai"), "Bhain Kwai");
  assert.equal(words.idAsName("plague_doctor"), "Plague Doctor");
  assert.equal(words.idAsName("homebrew:abc"), "");
  assert.equal(words.speciesName({ race: "homebrew:abc", raceLabel: "Marsh Folk" }), "Marsh Folk");
});

await test("a card's line names the species and each class", () => {
  assert.equal(words.speciesAndClassWords(minotaur), "Bhain Kwai Fighter 3 / Rogue 2");
  assert.equal(words.speciesAndClassWords(widow), "Human Plague Doctor 1");
  assert.equal(arrivalDetail({ race: "bhain-kwai", class: "paladin" }), "Bhain Kwai · Paladin");
});

const sheet = (id, userId, name, more = {}) => ({ id, userId, name, race: "human", class: "fighter", level: 1, ...more });

await test("the lobby's seat and companion cards print names, not ids", () => {
  const markup = renderToStaticMarkup(createElement(LobbyParty, {
    campaign: { maxPlayers: 6, leadUserId: "a", dmUserId: null, assistantDmUserId: null },
    members: [{ userId: "a", username: "Player A", activeCharacterId: "krag" }, { userId: "b", username: "Player B", activeCharacterId: "mara" }],
    sheets: [sheet("krag", "a", "Krag", minotaur), sheet("mara", "b", "Mara Fen", widow)],
    showParty: true,
    showCompanions: true,
    partyCompanions: [sheet("sera", "bot", "Seraphine", { race: "bhain-kwai", class: "paladin", level: 5, isCompanion: true })],
  }));
  assert.ok(markup.includes("Bhain Kwai Fighter 3 / Rogue 2"), "the seat card");
  assert.ok(markup.includes("Bhain Kwai Paladin 5"), "the companion card");
  assert.ok(!/bhain-kwai/.test(markup.replace(/(?:title|alt|src)="[^"]*"/g, "")), "no species id in the text");
  // The class emblem's tooltip on a seat is read aloud and shown on hover:
  // it printed "plague_doctor 1" after the card's line was fixed.
  const tooltips = [...markup.matchAll(/title="([^"]*)"/g)].map((match) => match[1]);
  assert.ok(tooltips.includes("Fighter 3 / Rogue 2") && tooltips.includes("Plague Doctor 1"), tooltips.join(" | "));
  assert.ok(!tooltips.some((tip) => /plague_doctor|\bfighter 3/.test(tip)), tooltips.join(" | "));
});

const { openWorld } = await import("./lib/enforce-world.mjs");
const world = await openWorld();
try {
  await test("the party roster's cards print names, not ids", async () => {
    const hero = world.addHero({ name: "Krag" });
    const { PartyPanel } = await import("../src/app/campaigns/[campaignId]/PartyPanel.tsx");
    const party = renderToStaticMarkup(createElement(PartyPanel, {
      sheets: [{ ...hero, ...minotaur }, { ...hero, id: "mara", name: "Mara Fen", isCompanion: true, ...widow, classes: [] }],
      meUserId: hero.userId,
      campaignId: world.campaignId,
      activeSheetId: hero.id,
    }));
    assert.ok(party.includes("Bhain Kwai Fighter 3 / Rogue 2"), "the player's card");
    assert.ok(party.includes("Human Plague Doctor 1"), "the companion's card");
    assert.ok(!party.includes("plague_doctor 1") && !party.includes("bhain-kwai fighter"), "no ids on the cards");
  });

  // The builder offers the content pack's row as "Minotaur (Bhain Kwai)";
  // the server now names a pack species on the sheet the same way, so the
  // cards, the sheet dialog, the library and the GM read what was picked.
  await test("a content-pack species reads as the builder named it, on a sheet and in the library", async () => {
    const { serverSpeciesName, libraryWords } = await import("../src/lib/characters/species-rules.ts");
    assert.equal(serverSpeciesName("hill_dwarf"), null, "a bundled id reads as its own words");
    assert.equal(serverSpeciesName("homebrew:abc"), null, "a workshop species is named by its author's shelf");
    if (!world.hasPack) {
      console.log("  (no content pack: the pack's names are not checked)");
      return;
    }
    const hero = world.addHero({ name: "Kell", race: "bhain-kwai" });
    const stored = world.sheet(hero.id);
    assert.equal(stored.raceLabel, "Minotaur (Bhain Kwai)");
    assert.equal(words.speciesAndClassWords(stored), "Minotaur (Bhain Kwai) Fighter 1");
    assert.equal(serverSpeciesName("odm-hill-dwarf"), "Dwarf (Hill)", "the pack's copy of a bundled row");
    assert.equal(libraryWords({ userId: hero.userId, race: "bhain-kwai", class: "fighter", background: "soldier" }).raceLabel, "Minotaur (Bhain Kwai)");
  });
} finally {
  world.close();
}

console.log(`${passed} card-name checks passed`);
