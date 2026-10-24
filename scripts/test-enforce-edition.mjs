// One ruleset: the 2014 rules (SRD 5.1), nothing from the 2024 revision
// (SRD 5.2), whichever door a rule comes through (issue #502). CI runs every
// suite with the content pack and with CONTENT_DB_PATH pointing nowhere; the
// bundled data has to hold the boundary on its own, so the spell cases run
// both ways and the pack's own cases run with it.
import assert from "node:assert/strict";
import { hasPack } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { LEGAL_WIZARD, openCreation } from "./lib/enforce-creation.mjs";

const { test, finish } = suite("test-enforce-edition");
const table = await openCreation();
const { world } = table;
const content = await import("../src/lib/content/index.ts");
const { getContentDb } = await import("../src/lib/content/db.ts");
const edition = await import("../src/lib/content/edition.ts");
const { srdRaceId, revisedSpecies } = await import("../src/lib/srd/race-id.ts");
const { catalogPrices } = await import("../src/lib/characters/catalog.ts");
const { stockPool } = await import("../src/lib/dm/shop-tools.ts");
const { companionSubclass } = await import("../src/lib/dm/companion-level.ts");
const { mayAttune, magicItemNamed } = await import("../src/lib/srd/magic-items.ts");
const { alignmentIs } = await import("../src/lib/srd/alignment.ts");

// The spells only the 2024 rules print, and the 2014 spells a 2024 row used
// to stand in for.
const REVISED_ONLY = ["Befuddlement", "Elementalism", "Shining Smite", "Sorcerous Burst", "Starry Wisp", "Summon Dragon"];
const RESTORED = {
  "Aura of Life": { level: 4, cast: "action", classes: ["paladin"] },
  "Dissonant Whispers": { level: 1, cast: "action", classes: ["bard"] },
  "Dragon's Breath": { level: 2, cast: "bonus", classes: ["sorcerer", "wizard"] },
  "Ensnaring Strike": { level: 1, cast: "bonus", classes: ["ranger"] },
  "Ice Knife": { level: 1, cast: "action", classes: ["druid", "sorcerer", "wizard"] },
  "Mind Spike": { level: 2, cast: "action", classes: ["sorcerer", "warlock", "wizard"] },
  "Phantasmal Force": { level: 2, cast: "action", classes: ["bard", "sorcerer", "wizard"] },
  "Searing Smite": { level: 1, cast: "bonus", classes: ["paladin"] },
  "Tsunami": { level: 8, cast: 1, classes: ["druid"] },
  "Vitriolic Sphere": { level: 4, cast: "action", classes: ["sorcerer", "wizard"] },
  "Power Word Heal": { level: 9, cast: "action", classes: ["bard", "cleric"] },
};

await test("A spell only the 2024 rules print is no spell this server knows, with the pack or without it.", () => {
  for (const name of REVISED_ONLY) {
    assert.equal(content.spellFactsFor(name), null, `${name}: casting facts`);
    assert.equal(content.findSpellByName(name), null, `${name}: search`);
    assert.equal(content.isPublishedSpellName(name), false, `${name}: published`);
  }
});

await test("A new wizard cannot learn Elementalism: creation is refused in the 2024 rules' own words.", async () => {
  const sheet = structuredClone(LEGAL_WIZARD);
  sheet.spellcasting.cantrips[2] = "Elementalism";
  const made = await table.atTable(sheet);
  assert.equal(made.status, 400, `stored: ${JSON.stringify(made.sheet?.spellcasting?.cantrips)}`);
  assert.match(String(made.error), /Elementalism is from the 2024 rules/);
});

await test("A sheet that still lists a 2024-only spell from before cannot cast it, and nothing is spent.", async () => {
  const made = await table.atTable(structuredClone(LEGAL_WIZARD));
  assert.equal(made.status, 201, made.error);
  const casting = made.sheet.spellcasting;
  world.patch(made.sheet.id, { spellcasting: { ...casting, cantrips: [...casting.cantrips, "Elementalism"] } });
  const cast = await world.invoke("use_spell_slot", { characterId: made.sheet.id, spell: "Elementalism", level: 1 });
  assert.equal(cast.ok, false);
  assert.match(String(cast.error), /from the 2024 rules/);
  assert.deepEqual(world.sheet(made.sheet.id).spellcasting.slots, casting.slots);
});

await test("A paladin who names Divine Smite spends a slot as the 2014 feature, not as a spell.", async () => {
  const paladin = world.addHero({ class: "paladin", level: 2 });
  world.patch(paladin.id, {
    features: [{ name: "Divine Smite", source: "class", level: 2 }],
    spellcasting: { ability: "cha", slots: { 1: { max: 2, used: 0 } }, known: [], prepared: [], cantrips: [] },
  });
  const smite = await world.invoke("use_spell_slot", { characterId: paladin.id, spell: "Divine Smite", level: 1 });
  assert.equal(smite.ok, true, smite.error);
  assert.equal(world.sheet(paladin.id).spellcasting.slots["1"].used, 1);
});

await test("The 2014 spells a 2024 row once stood in for are known with their 2014 facts: Searing Smite, Ensnaring Strike and Dragon's Breath take a bonus action.", () => {
  for (const [name, want] of Object.entries(RESTORED)) {
    const facts = content.spellFactsFor(name);
    assert.ok(facts, `${name}: no facts`);
    assert.equal(facts.level, want.level, `${name}: level`);
    assert.equal(facts.castingTime, want.cast, `${name}: casting time`);
    for (const classId of want.classes) {
      assert.ok(facts.classes.includes(classId), `${name}: not a ${classId} spell (${facts.classes.join(", ")})`);
    }
  }
  assert.equal(content.spellSchoolFor("Power Word Heal"), "evocation");
});

if (hasPack) {
  await test("Every row in the content pack is from a document this engine plays, and the pack says which revision built it.", () => {
    const db = getContentDb();
    const revised = [...edition.EDITION_2024_DOCUMENTS];
    for (const table of ["spells", "feats", "conditions", "backgrounds", "races", "classes", "archetypes", "items", "monsters"]) {
      const { count } = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE document_slug IN (${revised.map(() => "?").join(", ")})`).get(...revised);
      assert.equal(count, 0, `${table} holds ${count} 2024 rows`);
    }
    const [row] = db.pragma("user_version");
    assert.ok(Number(row.user_version) >= edition.PACK_REVISION, `pack revision ${row.user_version}`);
  });

  await test("Each restored 2014 spell is offered to its class in the pickers: a bard sees Dissonant Whispers, a paladin Searing Smite, a ranger Ensnaring Strike.", () => {
    for (const [name, want] of Object.entries(RESTORED)) {
      for (const classId of want.classes) {
        const offered = content.searchSpells({ classSlug: classId, level: want.level, exactLevel: true, limit: 200 }).map((entry) => entry.name);
        assert.ok(offered.includes(name), `${name} not offered to a ${classId}`);
      }
    }
  });

  await test("Hex, Chromatic Orb and Power Word Heal serve ODM's 2014 wording, through search and through their detail page alike.", () => {
    for (const name of ["Hex", "Chromatic Orb", "Power Word Heal"]) {
      assert.equal(content.findSpellByName(name)?.documentSlug, "odm-expanded", `${name}: search`);
    }
    assert.equal(content.getEntryDetail("spells", "hex")?.documentSlug, "odm-expanded");
    assert.equal(content.getEntryDetail("spells", "elementalism"), null);
  });

  await test("Savage Attacker, Alert, Magic Initiate and Skilled are the 2014 feats, and Goliath and Orc the 2014 species.", () => {
    const feats = content.searchFeats({ limit: 200 });
    for (const name of ["Savage Attacker", "Alert", "Magic Initiate", "Skilled"]) {
      assert.equal(feats.find((feat) => feat.name === name)?.documentSlug, "odm-expanded", name);
    }
    const races = content.listRaces({ limit: 200 });
    for (const name of ["Goliath", "Orc"]) {
      assert.equal(races.find((race) => race.name === name)?.documentSlug, "odm-expanded", name);
    }
    assert.equal(content.getEntryDetail("races", "goliath")?.documentSlug, "odm-expanded");
    assert.equal(content.getEntryDetail("feats", "savage-attacker")?.documentSlug, "odm-expanded");
    assert.equal(content.getEntryDetail("archetypes", "evoker"), null);
  });

  await test("A Spell Scroll is a magic item with no list price, so a new character cannot buy one and no general store stocks one.", () => {
    assert.deepEqual(catalogPrices("Spell Scroll"), { copper: null, magic: true });
    assert.equal(stockPool("general").some((item) => item.name === "Spell Scroll"), false);
  });

  await test("A 2024 slug still on a sheet reads as the 2014 row of the same name.", () => {
    assert.equal(content.getEntryDetail("items", "srd-2024_potion-of-healing")?.documentSlug ?? null, null);
    const scroll = content.getEntryDetail("items", "srd-2024_spell-scroll");
    assert.ok(scroll === null || scroll.documentSlug !== "srd-2024");
  });

  await test("The reference desk names each source's own book: an SRD row is SRD 5.1, a third-party row its title.", () => {
    assert.equal(content.documentLabel({ source: "open5e", documentSlug: "wotc-srd" }, "spell"), "SRD 5.1 spell");
    assert.equal(content.documentLabel({ source: "open5e", documentSlug: "srd-2014" }, "item"), "SRD 5.1 item");
    assert.equal(content.documentLabel({ source: "homebrew", documentSlug: "homebrew" }, "item"), "your homebrew");
    assert.match(content.documentLabel({ source: "open5e", documentSlug: "a5e" }, "spell"), /^spell from /);
  });
}

await test("SRD 5.1's equipment packs and mounts have their SRD prices, with the pack or without it.", () => {
  assert.equal(catalogPrices("Explorer's Pack").copper, 1000);
  assert.equal(catalogPrices("Burglar's Pack").copper, 1600);
  assert.equal(catalogPrices("Horse, Riding").copper, 7500);
  assert.equal(catalogPrices("Riding Horse").copper, 7500);
  assert.equal(catalogPrices("Warhorse").copper, 40000);
  assert.equal(catalogPrices("Saddle, Military").copper, 2000);
});

await test("An outfitter stocks the SRD's equipment packs and a general store its rations, with the pack or without it.", () => {
  assert.ok(stockPool("outfitter").some((item) => item.name === "Explorer's Pack"), "no Explorer's Pack");
  assert.ok(stockPool("general").some((item) => /^rations/i.test(item.name)), "no rations");
  assert.equal(stockPool("general").some((item) => item.name === "Warhorse"), false, "a general store sells no warhorse");
});

await test("A character saved as a 2024 species reads as the 2014 species of the same people, and the builder can say so.", () => {
  assert.equal(srdRaceId("srd-2024-goliath"), "goliath");
  assert.equal(srdRaceId("toh-drow"), "toh_drow", "another document's species stays its own");
  assert.equal(revisedSpecies("srd-2024-goliath", []), "goliath");
  assert.equal(revisedSpecies("orc", ["Darkvision", "Adrenaline Rush"]), "orc");
  assert.equal(revisedSpecies("orc", ["Darkvision 60 ft", "Aggressive (bonus action: move up to your speed toward a hostile creature you can see)"]), null);
  assert.equal(revisedSpecies("goliath", ["Stone's Endurance"]), null);
});

await test("A DM-made companion takes its class's SRD subclass at the level the class gets one: a level 3 paladin swears the Oath of Devotion.", () => {
  assert.equal(companionSubclass("paladin", 2, ""), "");
  assert.equal(companionSubclass("paladin", 3, ""), "Oath of Devotion");
  assert.equal(companionSubclass("paladin", 5, "Oath of the Ancients"), "Oath of the Ancients");
  assert.equal(companionSubclass("wizard", 2, ""), "School of Evocation");
});

await test("An alignment reads the same as a code or as words: a builder's LG paladin can attune to the Talisman of Pure Good.", () => {
  assert.equal(alignmentIs("LG", "good"), true);
  assert.equal(alignmentIs("Lawful Good", "good"), true);
  assert.equal(alignmentIs("CE", "good"), false);
  assert.equal(alignmentIs("neutral evil", "evil"), true);
  const talisman = magicItemNamed("Talisman of Pure Good");
  assert.ok(talisman, "the bundled talisman");
  assert.equal(mayAttune(talisman, { class: "paladin", classes: [], alignment: "LG", race: "human" }), true);
  assert.equal(mayAttune(talisman, { class: "paladin", classes: [], alignment: "CE", race: "human" }), false);
});

await test("Every 2024-only spell has one message wherever it is met.", () => {
  assert.match(edition.revisedOnlySpellProblem("elementalism", "cantrip"), /^Elementalism is from the 2024 rules.*2014 cantrip/);
  assert.equal(edition.revisedOnlySpellProblem("Fire Bolt"), null);
});

world.close();
finish();
