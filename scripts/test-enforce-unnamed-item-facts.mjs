// What a granted item is, never lost to a field the model leaves out
// (src/lib/dm/ai-gate.ts itemFacts): the engines read an item by its row or
// its tags, never the words of its name, so a grant_item of a thing no table
// knows by name that names neither the SRD item it is (srdName) nor its tags,
// or of a spell scroll that names no spell, is asked for them before anything
// is granted. The same at every table language; an SRD item by its English
// name is never asked, and the console is never asked. What it is stays with
// it: through the shared pack and in its price.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-unnamed-item-facts");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { listSheets, getSheetById } = await import("../src/lib/db/sheets.ts");
const { dispatchAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");
const { getParty } = await import("../src/lib/db/party.ts");
const { listPriceCp } = await import("../src/lib/dm/trade-value.ts");
const { grantItemMath } = await import("../src/lib/dm/mutation-math.ts");

// The model's call, through the turn loop's dispatch.
async function ai(name, args, actor) {
  world.say("player", "I take it.", actor);
  const turn = createDmTurn(world.campaignId, []);
  const sheets = listSheets(world.campaignId);
  return dispatchAdjudication(name, JSON.stringify(args), { campaign: world.campaign(), turn, sheets, sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])), realDiceUserIds: new Set() });
}

const hero = world.addHero({ class: "fighter", level: 3 });
const carried = (name) => getSheetById(hero.id).equipment.find((item) => item.name === name);

await test("A thing no table knows by name, sent with no tags, is asked what it is, at every table, and nothing is granted.", async () => {
  for (const name of ["Pozione di guarigione", "Potion de soins", "Poción de curación", "Heiltrank", "Glowing vial"]) {
    const out = await ai("grant_item", { characterId: hero.id, name, reason: "the chest" }, hero);
    assert.equal(out.retry, true, `${name}: granted without asking`);
    assert.match(out.error, /send it again with srdName/);
    assert.equal(carried(name), undefined);
  }
});

await test("Told its tags, the potion is granted and heals as one; tags [] grants a thing that is none of them.", async () => {
  const granted = await ai("grant_item", { characterId: hero.id, name: "Pozione di guarigione", tags: ["consumable", "potion", "healing_potion"], reason: "the chest" }, hero);
  assert.equal(granted.ok, true, granted.error);
  assert.deepEqual(carried("Pozione di guarigione").tags, ["consumable", "potion", "healing_potion"]);
  const letter = await ai("grant_item", { characterId: hero.id, name: "Lettera sigillata", tags: [], reason: "the courier" }, hero);
  assert.equal(letter.ok, true, letter.error);
});

await test("A spell scroll that names no spell is asked for it, whatever it is called; named, it is granted.", async () => {
  const english = await ai("grant_item", { characterId: hero.id, name: "Spell Scroll of Cure Wounds", reason: "the chest" }, hero);
  assert.equal(english.retry, true, "the English scroll was granted without its spell");
  assert.match(english.error, /names its spell in spell/);
  const tagged = await ai("grant_item", { characterId: hero.id, name: "Pergamena di Cura ferite", tags: ["consumable", "scroll"], reason: "the chest" }, hero);
  assert.equal(tagged.retry, true, "the tagged scroll was granted without its spell");
  assert.match(tagged.error, /send it again with the spell/);
  const named = await ai("grant_item", { characterId: hero.id, name: "Spell Scroll of Cure Wounds", tags: ["consumable", "scroll"], spell: "Cure Wounds", reason: "the chest" }, hero);
  assert.equal(named.ok, true, named.error);
  assert.equal(carried("Spell Scroll of Cure Wounds").spell, "Cure Wounds");
  const unread = await ai("grant_item", { characterId: hero.id, name: "Rotolo sigillato", unidentified: true, reason: "the chest" }, hero);
  assert.equal(unread.ok, true, unread.error);
});

await test("An SRD item by its English name is never asked, and the console is never asked.", async () => {
  for (const name of ["Potion of Healing", "Longsword", "Rope, hempen (50 feet)"]) {
    const out = await ai("grant_item", { characterId: hero.id, name, reason: "the chest" }, hero);
    assert.equal(out.ok, true, `${name}: ${out.error}`);
  }
  const console = await world.invoke("grant_item", { characterId: hero.id, name: "Strano amuleto", reason: "the console" });
  assert.equal(console.ok, true, console.error);
});

await test("Named as the SRD item it is, a potion in the table's language works as that item: the Elixir of Health cures the poisoned.", async () => {
  world.patch(hero.id, { equipment: [], conditions: ["poisoned"], conditionMeta: {} });
  const granted = await ai("grant_item", { characterId: hero.id, name: "Elisir di salute", srdName: "elixir of health", reason: "the chest" }, hero);
  assert.equal(granted.ok, true, granted.error);
  assert.equal(carried("Elisir di salute").srdName, "Elixir of Health", "the row's own spelling is stored");
  const used = await world.invoke("use_item", { characterId: hero.id, item: "Elisir di salute" });
  assert.equal(used.ok, true, used.error);
  assert.equal(getSheetById(hero.id).conditions.includes("poisoned"), false);
});

await test("An srdName no list holds is asked again, from the model and the console alike, and nothing is granted.", async () => {
  for (const out of [
    await ai("grant_item", { characterId: hero.id, name: "Elisir strano", srdName: "Elixir of Nowhere", reason: "the chest" }, hero),
    await world.invoke("grant_item", { characterId: hero.id, name: "Elisir strano", srdName: "Elixir of Nowhere", reason: "the console" }),
  ]) {
    assert.equal(out.retry, true, "an unknown srdName was stored");
    assert.match(out.error, /no SRD or pack item is called "Elixir of Nowhere"/);
  }
  assert.equal(carried("Elisir strano"), undefined);
});

await test("A spell named for a thing no row knows makes it a spell scroll, with no question asked.", async () => {
  const out = await ai("grant_item", { characterId: hero.id, name: "Rotolo di Dardo incantato", spell: "Magic Missile", reason: "the chest" }, hero);
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(carried("Rotolo di Dardo incantato").tags, ["consumable", "scroll"]);
  assert.equal(carried("Rotolo di Dardo incantato").spell, "Magic Missile");
});

await test("What an item is goes into the shared pack and comes back out with it, and an unidentified one stays unidentified.", async () => {
  world.patch(hero.id, { equipment: [
    { name: "Pozione di guarigione", qty: 1, tags: ["consumable", "potion", "healing_potion"] },
    { name: "Elisir di salute", qty: 1, srdName: "Elixir of Health" },
    { name: "Rubino", qty: 1, tags: ["gem"], worth: 1000 },
    { name: "a sealed vial", qty: 1, identified: false },
  ] });
  for (const name of ["Pozione di guarigione", "Elisir di salute", "Rubino", "a sealed vial"]) {
    const stowed = await world.invoke("party_stash", { do: "stow", characterId: hero.id, name });
    assert.equal(stowed.ok, true, `${name}: ${stowed.error}`);
  }
  const pack = Object.fromEntries(getParty(world.campaignId).inventory.map((item) => [item.name, item]));
  assert.deepEqual(pack["Pozione di guarigione"].tags, ["consumable", "potion", "healing_potion"]);
  assert.equal(pack["Elisir di salute"].srdName, "Elixir of Health");
  assert.equal(pack["Rubino"].worth, 1000);
  assert.equal(pack["a sealed vial"].identified, false);
  for (const name of ["Pozione di guarigione", "Elisir di salute", "Rubino", "a sealed vial"]) {
    const taken = await world.invoke("party_stash", { do: "take", characterId: hero.id, name });
    assert.equal(taken.ok, true, `${name}: ${taken.error}`);
  }
  assert.deepEqual(carried("Pozione di guarigione").tags, ["consumable", "potion", "healing_potion"]);
  assert.equal(carried("Elisir di salute").srdName, "Elixir of Health");
  assert.equal(carried("Rubino").worth, 1000);
  assert.equal(carried("a sealed vial").identified, false);
});

test("An item named as an SRD item is priced as that item, and two of different rows never merge.", () => {
  // A list price is the pack's, and CI has no pack.
  if (world.hasPack) {
    assert.equal(listPriceCp({ name: "Spada lunga", srdName: "Longsword" }), 1500);
  }
  const two = grantItemMath([{ name: "Pozione", qty: 1, srdName: "Potion of Healing" }], "Pozione", 1, { srdName: "Potion of Heroism" });
  assert.equal(two.equipment.length, 2);
});

world.close();
finish();
