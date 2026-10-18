// What a granted item is, never lost to a field the model leaves out
// (src/lib/dm/ai-gate.ts itemFacts): the engines read an item by its row or
// its tags, never the words of its name, so a grant_item of a thing no table
// knows by name that sends no tags, or of a spell scroll that names no
// spell, is asked for them before anything is granted. The same at every
// table language; an SRD item by its English name is never asked, and the
// console is never asked.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-unnamed-item-facts");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { listSheets, getSheetById } = await import("../src/lib/db/sheets.ts");
const { dispatchAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");

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
    assert.match(out.error, /send it again with tags naming what/);
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

world.close();
finish();
