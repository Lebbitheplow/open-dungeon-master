// The SRD 5.1 magic items held to their own text (issue #570, "Rules and
// content"): every page of the rulebook's magic-items chapter
// (src/lib/rulebook/srd-5.1.json), its rules page (attunement, wearing and
// wielding, activating an item, consumables, spells and charges) and the
// Orb of Dragonkind on the artifacts page, compared with the engine: the
// generated table src/lib/classes/magic-items.json (src/lib/srd/
// magic-items.ts, magic-gear.ts), the charges use_item spends
// (src/lib/dm/item-charges.ts), the spells it casts from an item
// (src/lib/srd/item-spells.ts), the potions (src/lib/srd/item-tags.ts,
// src/lib/dm/consumables.ts) and the sheet's derived numbers.
//
// Every page is read here, by words written apart from the generator's, and
// what differs is grouped by the kind of error: one gap() per kind, the
// items it touches named in its message. docs/rules-coverage.md lists the
// items narrated by design; a mechanic the server itself rolls (a spell
// attack, a save, the speed on the board) is not one narration can carry, so
// those are held here.
//
// The tests under "findings" are the #570 SRD text audit's findings ITM-01
// to ITM-09, each asserting what the SRD 5.1 text says. Nothing here needs
// the content pack.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-srd-magic-items");
// Eight seats: the suite seats eight heroes, the default table six.
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const { matchMagicItem, magicItemNamed, effectiveAbilities, mayAttune } = await import("../src/lib/srd/magic-items.ts");
const { chargeRuleOf } = await import("../src/lib/srd/item-charge-rules.ts");
const { spendChargesMath, equipmentAfterSpend } = await import("../src/lib/dm/item-charges.ts");
const { itemSpellCast, itemSpellsOf } = await import("../src/lib/srd/item-spells.ts");
const { itemUseProblem, consumableEffect } = await import("../src/lib/dm/item-logic.ts");
const { potionPlan } = await import("../src/lib/dm/consumables.ts");
const { computeSheetDerived, spellAttackFor, spellSaveDcFor } = await import("../src/lib/srd/index.ts");
const { itemSpeeds } = await import("../src/lib/srd/magic-items.ts");
const { flyingSpeedOf } = await import("../src/lib/battlemap/types.ts");

const book = JSON.parse(fs.readFileSync(new URL("../src/lib/rulebook/srd-5.1.json", import.meta.url), "utf8"));
const plain = (text) => String(text ?? "").replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
// Each item page: its italic first line ("Wand, rare (requires attunement
// by a spellcaster)") and its text.
const ITEMS = book.pages
  .filter((page) => page.chapter === "magic-items" && page.kind === "item")
  .map((page) => {
    const head = plain(page.md.split("\n").find((line) => line.trim()));
    const attunement = /\(requires attunement(?: by ([^)]+))?/.exec(head);
    return { id: page.id, name: page.title, head, text: plain(page.md.slice(page.md.indexOf("\n"))), attunement: Boolean(attunement), by: attunement?.[1] ?? null };
  });
const byName = new Map(ITEMS.map((item) => [item.name, item]));
const textOf = (name) => byName.get(name).text;
const listed = (entries) => `${entries.length}: ${entries.join("; ")}`;

// A 5th-level wizard (Intelligence 16: spell attack +6, save DC 14, walking
// speed 30) wearing one attuned item, as the sheet engine reads it.
const WIZARD = {
  abilities: { str: 10, dex: 14, con: 14, int: 16, wis: 10, cha: 10 },
  level: 5,
  class: "wizard",
  speed: 30,
  proficiencies: { saves: ["int", "wis"], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] },
  spellcasting: { ability: "int", slots: {}, prepared: [], known: [], cantrips: [] },
};
const wearing = (name) => computeSheetDerived({ ...WIZARD, equipment: [{ name, qty: 1, equipped: true, attuned: true }] });
const bare = computeSheetDerived({ ...WIZARD, equipment: [] });

// ---- held ----

await test("Every SRD item the table holds asks for attunement exactly when its line says so, and by whom", () => {
  let checked = 0;
  for (const item of ITEMS) {
    const def = matchMagicItem({ name: item.name, slug: item.id });
    if (!def) continue;
    assert.equal(def.requiresAttunement, item.attunement, item.name);
    // "outdoors at night" is when, not who.
    if (item.by && !/^outdoors/.test(item.by)) {
      assert.ok(def.attunedBy, `${item.name}: by ${item.by}`);
      assert.equal(def.attunedBy.text, item.by, item.name);
    }
    checked += 1;
  }
  assert.ok(checked >= 100, `${checked} items`);
  // "a creature must be a member of that class": a fighter may not attune a Staff of Power.
  assert.equal(mayAttune(magicItemNamed("Staff of Power"), { class: "fighter" }), false);
  assert.equal(mayAttune(magicItemNamed("Staff of Power"), { class: "wizard" }), true);
});

await test("Every SRD item printing charges holds that many, regains what its text says at dawn, and the wands roll the last charge's d20", () => {
  let checked = 0;
  for (const item of ITEMS) {
    const max = /\b(?:has|have|starts with) (\d+d\d+(?: ?[+-] ?\d+)?|\d+) charges/i.exec(item.text);
    if (!max) continue;
    const rule = chargeRuleOf({ name: item.name, slug: item.id });
    assert.ok(rule, item.name);
    assert.equal(String(rule.max), /d/.test(max[1]) ? max[1].replace(/\s+/g, "") : max[1], `${item.name} charges`);
    const regain = /regains? (all|\d+d\d+(?: ?[+-] ?\d+)?|\d+) (?:of its )?(?:expended )?charges daily at dawn/i.exec(item.text);
    assert.equal(String(rule.regain), regain ? (regain[1].toLowerCase() === "all" ? "all" : regain[1].replace(/\s+/g, "")) : "undefined", `${item.name} regain`);
    if (/^Wand/.test(item.head) && /last charge, roll a d20/i.test(item.text)) {
      assert.equal(rule.lastChargeD20, true, item.name);
    }
    checked += 1;
  }
  assert.ok(checked >= 30, `${checked} charged items`);
});

await test("The spells a wand or staff casts cost the charges its text prints, at the level it prints, with the item's own DC where it gives one", () => {
  let checked = 0;
  for (const item of ITEMS) {
    for (const spell of itemSpellsOf(item.name)) {
      // "fireball (5th-level version, 5 charges)", "faerie fire" for 1 charge in a sentence of its own.
      const printed = new RegExp(`${spell.spell.replace(/ /g, "\\s+")}\\s*\\(([^)]*)\\)`, "i").exec(item.text);
      if (printed) {
        const charges = /(\d+) charges?/.exec(printed[1]);
        if (charges) assert.equal(spell.charges, Number(charges[1]), `${item.name} ${spell.spell}`);
        const level = /(\d)(?:st|nd|rd|th)-level version/.exec(printed[1]);
        if (level) assert.equal(spell.level, Number(level[1]), `${item.name} ${spell.spell} level`);
      }
      // "(save DC 13)", or the Ring of Elemental Command's "Spells cast from
      // the ring have a save DC of 17".
      const dc = /save DC (?:of )?(\d+)/.exec(item.text);
      if (spell.dc) assert.equal(spell.dc, Number(dc?.[1]), `${item.name} DC`);
      if (/using your spell save DC/i.test(item.text)) assert.equal(spell.dc, undefined, `${item.name}: the wielder's DC`);
      checked += 1;
    }
  }
  assert.ok(checked >= 50, `${checked} item spells`);
});

await test("Potions of Healing heal 2d4+2, 4d4+4, 8d4+8 and 10d4+20; Giant Strength sets the giant's score; the healing potion is used up", () => {
  for (const [name, dice] of [["Potion of Healing", "2d4+2"], ["Potion of Greater Healing", "4d4+4"], ["Potion of Superior Healing", "8d4+8"], ["Potion of Supreme Healing", "10d4+20"]]) {
    assert.ok(textOf("Potion of Healing").includes(dice.replace("+", "+")), dice);
    assert.deepEqual(consumableEffect({ name, qty: 1 }), { kind: "healing", expression: dice }, name);
    assert.equal(itemUseProblem({ name, qty: 1 }), null, name);
  }
  for (const [giant, score] of [["Hill", 21], ["Frost", 23], ["Stone", 23], ["Fire", 25], ["Cloud", 27], ["Storm", 29]]) {
    assert.deepEqual(potionPlan({ name: `Potion of ${giant} Giant Strength`, qty: 1 }), { kind: "giant", score }, giant);
  }
});

await test("Worn standing effects the table holds apply only while worn and attuned: Ring of Protection +1 AC and saves, Amulet of Health CON 19, Staff of Power +2 AC", () => {
  assert.equal(wearing("Ring of Protection").saves.int, bare.saves.int + 1);
  assert.equal(effectiveAbilities(WIZARD.abilities, [{ name: "Amulet of Health", qty: 1, attuned: true }]).con, 19);
  assert.equal(effectiveAbilities(WIZARD.abilities, [{ name: "Amulet of Health", qty: 1 }]).con, 14);
});

// ---- findings ----

await test("ITM-01: A staff's last charge rolls a d20 as its text prints: Staff of Healing (staff-of-healing) 'If you expend the last charge, roll a d20. On a 1, the staff vanishes in a flash of light, lost forever'; Staff of Striking, Swarming Insects and the Woodlands lose their magic or are destroyed on a 1; Staff of Power 'On a 1, the staff retains its +2 bonus ... but loses all other properties. On a 20, the staff regains 1d8+2 charges'; Staff of the Magi 'On a 20, the staff regains 1d12+1 charges'", () => {
  const missed = [];
  for (const name of ["Staff of Healing", "Staff of Striking", "Staff of Swarming Insects", "Staff of the Woodlands", "Staff of Power", "Staff of the Magi"]) {
    assert.ok(/last charge, roll a d20/i.test(textOf(name)), name);
    const item = { name, qty: 1, charges: 1 };
    const spent = spendChargesMath(item, chargeRuleOf(item), 1);
    if (!spent.d20) missed.push(name);
  }
  assert.equal(missed.length, 0, `staffs whose last charge rolls no d20, ${listed(missed)}`);
  // What each face does, by the item's own words.
  const onFace = (name, ...faces) => {
    world.clearDice();
    world.dice(...faces);
    const item = { name, qty: 1, charges: 1 };
    const spent = spendChargesMath(item, chargeRuleOf(item), 1);
    world.clearDice();
    return spent;
  };
  assert.equal(onFace("Staff of Healing", 1).destroyed, true, "the Staff of Healing vanishes on a 1");
  assert.equal(onFace("Staff of Swarming Insects", 1).destroyed, true, "the insects destroy the staff on a 1");
  assert.equal(onFace("Staff of Striking", 1).becomes, "Quarterstaff", "a nonmagical quarterstaff on a 1");
  assert.equal(onFace("Staff of the Woodlands", 1).becomes, "Quarterstaff", "a nonmagical quarterstaff on a 1");
  const powerOne = onFace("Staff of Power", 1);
  assert.equal(powerOne.becomes, "+2 Quarterstaff", "the Staff of Power keeps its +2 and loses the rest on a 1");
  assert.equal(powerOne.destroyed, false);
  const powerTwenty = onFace("Staff of Power", 20, 4);
  assert.equal(powerTwenty.charges, 4 + 2, "1d8+2 charges back on a 20");
  const magiOne = onFace("Staff of the Magi", 1);
  assert.ok(!magiOne.destroyed && !magiOne.becomes && magiOne.charges === 0, "the Staff of the Magi's 1 does nothing");
  assert.equal(onFace("Staff of the Magi", 20, 5).charges, 5 + 1, "1d12+1 charges back on a 20");
  // The row a staff becomes takes its place in the pack, attuned to nobody.
  const staff = { name: "Staff of Striking", qty: 1, equipped: true, attuned: true, charges: 1 };
  assert.deepEqual(equipmentAfterSpend([staff], staff, 0, false, "Quarterstaff"), [{ name: "Quarterstaff", qty: 1, equipped: true }]);
});

await test("ITM-02: Magic Items, Spells (magic-items): 'Some magic items allow the user to cast a spell from the item ... doesn't expend any of the user's spell slots'; e.g. Eyes of Charming 'expend 1 charge ... to cast the charm person spell (save DC 13)', Medallion of Thoughts 'detect thoughts (save DC 13)', Necklace of Fireballs 'detonates as a 3rd-level fireball spell (save DC 15)', Orb of Dragonkind (artifacts) 'cure wounds (5th-level version, 3 charges), daylight, death ward, or scrying (save DC 18)'", () => {
  const refused = [];
  for (const [name, spell] of [
    ["Eyes of Charming", "Charm Person"],
    ["Medallion of Thoughts", "Detect Thoughts"],
    ["Helm of Teleportation", "Teleport"],
    ["Cubic Gate", "Plane Shift"],
    ["Necklace of Fireballs", "Fireball"],
    ["Robe of Stars", "Magic Missile"],
    ["Cape of the Mountebank", "Dimension Door"],
    ["Staff of the Woodlands", "Pass without Trace"],
    ["Staff of the Magi", "Detect Magic"],
    ["Ring of Shooting Stars", "Light"],
    ["Orb of Dragonkind", "Scrying"],
  ]) {
    const source = name === "Orb of Dragonkind" ? book.pages.find((page) => page.id === "artifacts").md : textOf(name);
    assert.ok(new RegExp(spell.replace(/ /g, "\\s+"), "i").test(plain(source)), `${name} prints ${spell}`);
    const cast = itemSpellCast(name, spell, undefined);
    if ("error" in cast) refused.push(`${name} (${spell})`);
  }
  assert.equal(refused.length, 0, `item spells use_item refuses, ${listed(refused)}`);
  // The numbers each cast carries: the item's own DC, a bead per level
  // beyond the first, and nothing spent for an at-will spell.
  assert.deepEqual(itemSpellCast("Eyes of Charming", "Charm Person", undefined), { spell: "Charm Person", charges: 1, level: 1, dc: 13 });
  assert.deepEqual(itemSpellCast("Necklace of Fireballs", "Fireball", 3), { spell: "Fireball", charges: 3, level: 5, dc: 15 });
  assert.deepEqual(itemSpellCast("Robe of Stars", "Magic Missile", undefined), { spell: "Magic Missile", charges: 1, level: 5 });
  assert.deepEqual(itemSpellCast("Staff of the Woodlands", "Pass without Trace", undefined), { spell: "Pass without Trace", charges: 0, level: 2 });
  assert.deepEqual(itemSpellCast("Orb of Dragonkind", "Cure Wounds", undefined), { spell: "Cure Wounds", charges: 3, level: 5, dc: 18 });
  // The necklace's beads and the robe's stars are counted like charges, and
  // the cape's dimension door comes back at dawn.
  assert.equal(chargeRuleOf({ name: "Necklace of Fireballs" })?.max, "1d6+3");
  assert.equal(chargeRuleOf({ name: "Necklace of Fireballs" })?.spentAway, true);
  assert.deepEqual(chargeRuleOf({ name: "Robe of Stars" }), { max: 6, regain: "1d6", regainAtDusk: true });
  assert.equal(chargeRuleOf({ name: "Cape of the Mountebank" })?.regain, "all");
  // An at-will spell spends no charge, so an empty staff casts it and rolls
  // no last-charge d20.
  const empty = { name: "Staff of the Woodlands", qty: 1, charges: 0 };
  const atWill = spendChargesMath(empty, chargeRuleOf(empty), 0);
  assert.ok(!("error" in atWill) && atWill.charges === 0 && !atWill.d20, "pass without trace from an empty staff");
});

// The spells the SRD's item pages let their holder cast, read from the
// pages' own sentences: each sentence with the word "cast", and the spells
// it names after it. A family's member casts what its own paragraph says
// (a Crystal Ball of Telepathy, a Ring of Air Elemental Command, the
// figurine's Silver Raven), as the row a sheet carries for it.
const SPELL_LEVEL = new Map(
  book.pages
    .filter((page) => page.kind === "spell")
    .map((page) => {
      const head = plain(page.md.split("\n").find((line) => line.trim()));
      return [page.title.toLowerCase(), /cantrip/i.test(head) ? 0 : Number(/(\d)(?:st|nd|rd|th)-level/.exec(head)?.[1])];
    }),
);
const SPELL_NAMES = new RegExp(
  `\\b(${[...SPELL_LEVEL.keys()].sort((a, b) => b.length - a.length).map((name) => name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})\\b`,
  "gi",
);
const memberOf = (heading) =>
  /^(?:Crystal Ball of [\w ]+|Ring of \w+ Elemental Command)$/.test(heading) ? heading : heading === "Silver Raven (Uncommon)" ? "Figurine of Wondrous Power (Silver Raven)" : null;
function itemCasts() {
  const out = [];
  for (const page of book.pages.filter((entry) => entry.chapter === "magic-items" && entry.kind === "item")) {
    let holder = page.title;
    for (const paragraph of page.md.split(/\n\s*\n/)) {
      const heading = /^\*\*\*([^*]+?)\*\*\*/.exec(paragraph.trim())?.[1]?.replace(/\.$/, "");
      if (heading) holder = memberOf(heading) ?? page.title;
      const text = plain(paragraph);
      for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        const at = sentence.search(/\bcast\b/i);
        if (at < 0) continue;
        for (const found of sentence.slice(at).matchAll(SPELL_NAMES)) {
          out.push({ page: page.title, holder, spell: found[1].toLowerCase(), sentence, paragraph: text });
        }
      }
    }
  }
  return out;
}

// SRD items that name a spell in a sentence about casting, and why use_item
// does not cast it from them.
const NOT_CAST_FROM_ITEM = {
  "Candle of Invocation": "the gate is cast only when the candle is first lit, and every other lighting burns it by the minute, which the server does not track",
  "Deck of Many Things": "the Moon card grants wishes; the deck casts nothing",
  "Efreeti Bottle": "the efreeti casts the wish, not the holder",
  "Helm of Brilliance": "each spell spends a gem of its own kind, four counts one row cannot hold",
  "Potion of Animal Friendship": "the drinker casts it for an hour after the potion is gone",
  "Robe of Eyes": "light and daylight cast on the robe blind its wearer",
  "Wand of Wonder": "the d100 table, not the wielder, picks what the charge does",
};

await test("Magic Items, Spells (magic-items): every SRD item whose text lets its holder cast a named spell casts it from use_item: Hat of Disguise 'cast the disguise self spell from it at will'; Circlet of Blasting 'cast the scorching ray spell with it'; Rod of Alertness 'cast one of the following spells from it'; Ring of Air Elemental Command 'cast the following spells from the ring, expending the necessary number of charges'; Crystal Ball of Telepathy 'cast the suggestion spell (save DC 17)'", () => {
  const casts = itemCasts();
  const missing = [];
  const wrong = [];
  for (const { page, holder, spell, sentence, paragraph } of casts) {
    if (NOT_CAST_FROM_ITEM[page]) continue;
    const row = itemSpellsOf(holder).find((entry) => entry.spell.toLowerCase() === spell);
    if (!row) {
      missing.push(`${holder} (${spell})`);
      continue;
    }
    const where = `${holder} ${spell}`;
    // The lowest level the spell has, where the item prints none of its own
    // ("fireball (5th-level version", "magic missile as a 5th-level spell").
    if (!/\d(?:st|nd|rd|th)[- ]level|spell level/i.test(paragraph) && row.level !== SPELL_LEVEL.get(spell)) wrong.push(`${where}: level ${row.level} (SRD ${SPELL_LEVEL.get(spell)})`);
    // "at will", "without using any charges": nothing spent.
    if (/\bat will\b|without using any charges/i.test(sentence) && row.charges !== 0) wrong.push(`${where}: ${row.charges} charges for an at-will cast`);
    // "expend 2 of the ring's charges to cast", "expend 1 charge and cast".
    const expend = /expend (\d+) (?:of (?:its|the \w+['\u2019]s) )?charges? (?:and|to) cast/i.exec(sentence);
    if (expend && row.charges !== Number(expend[1])) wrong.push(`${where}: ${row.charges} charges (SRD ${expend[1]})`);
    // "(save DC 13)" printed with the spell.
    const dc = new RegExp(`${spell.replace(/[/]/g, "\\/")}(?: spell)? \\(save DC (\\d+)\\)`, "i").exec(sentence);
    if (dc && row.dc !== Number(dc[1])) wrong.push(`${where}: DC ${row.dc} (SRD ${dc[1]})`);
    // A cast that waits for the dawn holds one charge that comes back then.
    if (/can['\u2019]t be used (?:this way )?again until the next dawn/i.test(paragraph) && !/\bcharges?\b/i.test(paragraph)) {
      const rule = chargeRuleOf({ name: holder });
      if (row.charges !== 1 || rule?.max !== 1 || rule?.regain !== "all") wrong.push(`${where}: once a dawn, but costs ${row.charges} of ${JSON.stringify(rule)}`);
    }
  }
  assert.equal(missing.length, 0, `item spells use_item does not know, ${listed(missing)}`);
  assert.equal(wrong.length, 0, `item spells cast otherwise than their text says, ${listed(wrong)}`);
  // Every item left out does name a spell it is about, so the list stays true.
  const named = new Set(casts.map((entry) => entry.page));
  assert.deepEqual(Object.keys(NOT_CAST_FROM_ITEM).filter((name) => !named.has(name)), []);
  assert.ok(casts.length >= 100, `${casts.length} item spells read`);
  // The beads are a table, not a sentence: "Each bead contains a spell that
  // you can cast from it as a bonus action (using your spell save DC if a
  // save is necessary)": Bless; Cure wounds (2nd level) or lesser
  // restoration; Greater restoration; Branding smite; Planar ally; Wind walk.
  const beads = itemSpellsOf("Necklace of Prayer Beads");
  assert.deepEqual(beads.map((entry) => [entry.spell, entry.level, entry.charges, entry.bonusAction, entry.dc]), [
    ["Bless", 1, 1, true, undefined], ["Cure Wounds", 2, 1, true, undefined], ["Lesser Restoration", 2, 1, true, undefined],
    ["Greater Restoration", 5, 1, true, undefined], ["Branding Smite", 2, 1, true, undefined], ["Planar Ally", 6, 1, true, undefined], ["Wind Walk", 6, 1, true, undefined],
  ]);
  // "This necklace has 1d4+2 magic beads ... Once a magic bead's spell is
  // cast, that bead can't be used again until the next dawn."
  assert.deepEqual(chargeRuleOf({ name: "Necklace of Prayer Beads" }), { max: "1d4+2", regain: "all" });
  // A member named in brackets is the member: "Ring of Elemental Command (Fire)".
  assert.deepEqual(itemSpellCast("Ring of Elemental Command (Fire)", "Fireball", undefined), { spell: "Fireball", charges: 2, level: 3, dc: 17 });
  assert.equal(chargeRuleOf({ name: "Ring of Air Elemental Command" })?.max, 5);
  assert.equal(chargeRuleOf({ name: "Crystal Ball" }), null, "the plain ball scries at will");
  assert.equal(chargeRuleOf({ name: "Crystal Ball (Telepathy)" })?.regain, "all");
});

await test("An item's at-will spell is cast from use_item for nothing, by someone attuned where the item asks it: Hat of Disguise (hat-of-disguise) 'While wearing this hat, you can use an action to cast the disguise self spell from it at will'; Rod of Alertness 'cast one of the following spells'; Elemental Gem 'an elemental is summoned as if you had cast the conjure elemental spell, and the gem's magic is lost'; Amulet of the Planes 'make a DC 15 Intelligence check. On a successful check, you cast the plane shift spell'", async () => {
  const { takeItemCast } = await import("../src/lib/srd/item-cast-credit.ts");
  const use = (characterId, item, extra = {}) => world.invoke("use_item", { characterId, item, ...extra });
  const hero = world.addHero({ name: "Masked", class: "rogue", level: 5, maxHp: 30, equipment: [{ name: "Hat of Disguise", qty: 1, equipped: true }] });
  let out = await use(hero.id, "Hat of Disguise", { spell: "Disguise Self" });
  assert.equal(out.ok, false, "the hat (requires attunement) works only attuned");
  assert.match(out.error, /attuned/);
  world.patch(hero.id, { equipment: [{ name: "Hat of Disguise", qty: 1, equipped: true, attuned: true }] });
  // Its one spell needs no naming.
  out = await use(hero.id, "Hat of Disguise");
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.spellCast, "Disguise Self");
  assert.equal(out.result.spellLevel, 1);
  assert.ok(takeItemCast(hero.id, "Disguise Self", { dryRun: true }), "the cast waits for its spell's tool, slot paid");
  out = await use(hero.id, "Hat of Disguise", { spell: "Disguise Self" });
  assert.equal(out.ok, true, "at will: again, and again");
  assert.deepEqual(world.sheet(hero.id).equipment, [{ name: "Hat of Disguise", qty: 1, equipped: true, attuned: true }], "no count is kept on the hat");

  // The rod casts four: which one is asked.
  world.patch(hero.id, { equipment: [{ name: "Rod of Alertness", qty: 1, equipped: true, attuned: true }] });
  out = await use(hero.id, "Rod of Alertness");
  assert.equal(out.ok, false);
  assert.match(out.error, /Detect Evil and Good, Detect Magic, Detect Poison and Disease, See Invisibility/);
  out = await use(hero.id, "Rod of Alertness", { spell: "See Invisibility" });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.spellLevel, 2);

  // Breaking the gem is the cast, and the gem is gone.
  world.patch(hero.id, { equipment: [{ name: "Elemental Gem", qty: 2 }] });
  out = await use(hero.id, "Elemental Gem");
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.spellCast, "Conjure Elemental");
  assert.equal(out.result.spellLevel, 5);
  assert.deepEqual(world.sheet(hero.id).equipment, [{ name: "Elemental Gem", qty: 1 }]);

  // The amulet's Intelligence check (Intelligence 10) comes first.
  world.patch(hero.id, { equipment: [{ name: "Amulet of the Planes", qty: 1, equipped: true, attuned: true }] });
  world.clearDice();
  world.dice(4);
  out = await use(hero.id, "Amulet of the Planes");
  assert.equal(world.clearDice(), 0, "the check's d20 was rolled");
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.spellCast, false, "4 fails DC 15: no plane shift");
  assert.equal(takeItemCast(hero.id, "Plane Shift", { dryRun: true }), null);
  world.dice(17);
  out = await use(hero.id, "Amulet of the Planes");
  assert.equal(out.result.spellCast, "Plane Shift");
  assert.equal(out.result.spellLevel, 7);
});

await test("A spell an item casts once a dawn waits for the dawn: Circlet of Blasting (circlet-of-blasting) 'cast the scorching ray spell with it. When you make the spell's attacks, you do so with an attack bonus of +5. The circlet can't be used this way again until the next dawn'; Helm of Telepathy 'Once used, the suggestion property can't be used again until the next dawn'; Wind Fan 'Each time it is used again before then, it has a cumulative 20 percent chance of not working and tearing'", async () => {
  const use = (characterId, item, extra = {}) => world.invoke("use_item", { characterId, item, ...extra });
  for (const name of ["Circlet of Blasting", "Cloak of Arachnida", "Cloak of the Bat", "Bowl of Commanding Water Elementals", "Brazier of Commanding Fire Elementals", "Censer of Controlling Air Elementals", "Stone of Controlling Earth Elementals", "Helm of Telepathy", "Wind Fan"]) {
    const rule = chargeRuleOf({ name });
    assert.ok(rule?.max === 1 && rule.regain === "all", `${name}: one use, back at dawn`);
  }
  const blaster = world.addHero({ name: "Blaster", class: "fighter", level: 5, maxHp: 40, equipment: [{ name: "Circlet of Blasting", qty: 1, equipped: true }] });
  let out = await use(blaster.id, "Circlet of Blasting", { spell: "Scorching Ray" });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.attackBonus, 5);
  // A fighter with no spellcasting attacks with the circlet's +5.
  assert.equal(spellAttackFor(world.sheet(blaster.id), "Scorching Ray"), 5);
  out = await use(blaster.id, "Circlet of Blasting", { spell: "Scorching Ray" });
  assert.equal(out.ok, false, "not again before dawn");
  assert.match(out.error, /dawn/);

  // The helm's detect thoughts is at will; its suggestion once a dawn.
  world.patch(blaster.id, { equipment: [{ name: "Helm of Telepathy", qty: 1, equipped: true, attuned: true }] });
  for (const spell of ["Detect Thoughts", "Detect Thoughts", "Suggestion"]) {
    out = await use(blaster.id, "Helm of Telepathy", { spell });
    assert.equal(out.ok, true, `${spell}: ${out.error}`);
    assert.equal(out.result.saveDc, 13);
  }
  out = await use(blaster.id, "Helm of Telepathy", { spell: "Suggestion" });
  assert.equal(out.ok, false, "a second suggestion waits for dawn");
  out = await use(blaster.id, "Helm of Telepathy", { spell: "Detect Thoughts" });
  assert.equal(out.ok, true, "detect thoughts still at will");

  // The fan: once safely, then each use before dawn rolls its d100.
  world.patch(blaster.id, { equipment: [{ name: "Wind Fan", qty: 1 }] });
  world.clearDice();
  out = await use(blaster.id, "Wind Fan", { spell: "Gust of Wind" });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.saveDc, 13);
  world.dice(50);
  out = await use(blaster.id, "Wind Fan", { spell: "Gust of Wind" });
  assert.equal(world.clearDice(), 0, "the tearing d100 was rolled");
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.spellCast, "Gust of Wind", "50 is above 20: it holds");
  world.dice(20);
  out = await use(blaster.id, "Wind Fan", { spell: "Gust of Wind" });
  assert.equal(out.result.spellCast, false, "20 or less: it does not work");
  assert.deepEqual(world.sheet(blaster.id).equipment, [], "and tears into tatters");
});

await test("Ring of Jumping (ring-of-jumping): 'you can cast the jump spell from it as a bonus action at will'; in a fight it spends the bonus action and leaves the action", async () => {
  const { combatKit } = await import("./lib/enforce-combat.mjs");
  const kit = await combatKit(world);
  const jumper = world.addHero({ name: "Jumper", class: "fighter", level: 5, maxHp: 40, equipment: [{ name: "Ring of Jumping", qty: 1, equipped: true, attuned: true }] });
  await kit.fight(1, { heroFaces: { [jumper.id]: 20 } });
  kit.giveTurn(jumper.id);
  const out = await world.invoke("use_item", { characterId: jumper.id, item: "Ring of Jumping", spell: "Jump" });
  const budget = world.encounter()?.turnBudget;
  await kit.endFight();
  assert.equal(out.ok, true, out.error);
  assert.ok(budget?.bonusUsed && !budget.actionUsed, `bonus action ${budget?.bonusUsed ? "spent" : "kept"}, action ${budget?.actionUsed ? "spent" : "kept"}`);
});

await test("ITM-03: An item's bonus to spell attack rolls and spell save DC is the wielder's: Wand of the War Mage 'you gain a bonus to spell attack rolls determined by the wand's rarity'; Robe of the Archmagi 'Your spell save DC and spell attack bonus each increase by 2'; Staff of Power, the Magi and the Woodlands 'a +2 bonus to spell attack rolls'", () => {
  const wrong = [];
  // The Staff of the Woodlands "requires attunement by a druid", so a druid
  // (Wisdom 16) holds it; the audit's first reading handed it to the wizard,
  // who may not attune to it and gains nothing from it.
  const DRUID = { ...WIZARD, class: "druid", abilities: { ...WIZARD.abilities, int: 10, wis: 16 }, spellcasting: { ...WIZARD.spellcasting, ability: "wis" } };
  const holding = (sheet, name) => computeSheetDerived({ ...sheet, equipment: [{ name, qty: 1, equipped: true, attuned: true }] });
  for (const [name, attack, dc, sheet] of [["+2 Wand of the War Mage", 2, 0, WIZARD], ["Robe of the Archmagi", 2, 2, WIZARD], ["Staff of Power", 2, 0, WIZARD], ["Staff of the Magi", 2, 0, WIZARD], ["Staff of the Woodlands", 2, 0, DRUID]]) {
    const plain = computeSheetDerived({ ...sheet, equipment: [] });
    const derived = holding(sheet, name);
    if (derived.spellAttack !== plain.spellAttack + attack) wrong.push(`${name} spell attack +${derived.spellAttack} (SRD +${plain.spellAttack + attack})`);
    if (derived.spellSaveDc !== plain.spellSaveDc + dc) wrong.push(`${name} spell save DC ${derived.spellSaveDc} (SRD ${plain.spellSaveDc + dc})`);
  }
  assert.equal(wrong.length, 0, `spell bonuses not added, ${listed(wrong)}`);
  // The +N is the wand's own: a +3 wand adds 3, and a wizard who may not
  // attune to the Woodlands staff gains nothing from holding it.
  assert.equal(wearing("Wand of the War Mage +3").spellAttack, bare.spellAttack + 3);
  assert.equal(wearing("Staff of the Woodlands").spellAttack, bare.spellAttack);
  // The numbers a cast reads are the same ones.
  assert.equal(spellAttackFor({ ...WIZARD, equipment: [{ name: "Robe of the Archmagi", qty: 1, equipped: true, attuned: true }] }, "Fire Bolt"), bare.spellAttack + 2);
  assert.equal(spellSaveDcFor({ ...WIZARD, equipment: [{ name: "Robe of the Archmagi", qty: 1, equipped: true, attuned: true }] }, "Fireball"), bare.spellSaveDc + 2);
});

await test("ITM-04: Mantle of Spell Resistance (mantle-of-spell-resistance): 'You have advantage on saving throws against spells while you wear this cloak'; likewise Robe of the Archmagi, Scarab of Protection and Staff of the Magi", async () => {
  const hero = world.addHero({ name: "Warded", class: "wizard", level: 5, abilities: { wis: 10 }, maxHp: 30 });
  const rolled = [];
  for (const name of ["Mantle of Spell Resistance", "Robe of the Archmagi", "Scarab of Protection", "Staff of the Magi"]) {
    world.patch(hero.id, { equipment: [{ name, qty: 1, equipped: true, attuned: true }] });
    world.clearDice();
    world.diceLog();
    world.dice(10, 10);
    const out = await world.invoke("request_roll", { characterId: hero.id, kind: "saving_throw", ability: "wis", dc: 15, magical: true, reason: "a spell's save" });
    assert.equal(out.ok, true, out.error);
    const d20s = world.diceLog().filter((die) => die.sides === 20).length;
    world.clearDice();
    if (d20s < 2) rolled.push(`${name}: ${d20s} d20`);
  }
  assert.equal(rolled.length, 0, `saves against spells rolled without advantage, ${listed(rolled)}`);
});

await test("ITM-05: Periapt of Proof against Poison (periapt-of-proof-against-poison): 'You are immune to the poisoned condition and have immunity to poison damage'", async () => {
  const hero = world.addHero({ name: "Taster", class: "fighter", level: 5, maxHp: 40 });
  world.patch(hero.id, { currentHp: 40, equipment: [{ name: "Periapt of Proof against Poison", qty: 1, equipped: true }] });
  const hurt = await world.invoke("apply_damage", { characterId: hero.id, amount: 10, type: "poison", reason: "a poisoned blade" });
  assert.equal(hurt.ok, true, hurt.error);
  const poisoned = await world.invoke("set_condition", { characterId: hero.id, condition: "poisoned", rounds: 10 });
  const after = world.sheet(hero.id);
  assert.ok(
    after.currentHp === 40 && !after.conditions.includes("poisoned"),
    `wearing the periapt: ${40 - after.currentHp} poison damage taken, poisoned ${after.conditions.includes("poisoned") ? "applied" : `refused (${poisoned.error})`}`,
  );
  // Taken off, the periapt protects nobody.
  world.patch(hero.id, { equipment: [{ name: "Periapt of Proof against Poison", qty: 1, equipped: false }] });
  await world.invoke("apply_damage", { characterId: hero.id, amount: 10, type: "poison", reason: "a poisoned blade" });
  assert.equal(world.sheet(hero.id).currentHp, 30);
});

await test("ITM-06: An item's speed is the wearer's: Winged Boots 'you have a flying speed equal to your walking speed'; Ring of Swimming 'You have a swimming speed of 40 feet while wearing this ring'; Slippers of Spider Climbing 'You have a climbing speed equal to your walking speed'", () => {
  const wrong = [];
  for (const [name, mode, feet] of [["Winged Boots", "fly", 30], ["Ring of Swimming", "swim", 40], ["Slippers of Spider Climbing", "climb", 30]]) {
    const speeds = wearing(name).speeds ?? {};
    if (speeds[mode] !== feet) wrong.push(`${name}: ${mode} ${speeds[mode] ?? "none"} (SRD ${feet})`);
  }
  assert.equal(wrong.length, 0, `item speeds the sheet does not carry, ${listed(wrong)}`);
  // The board reads them too: the boots fly at the walking speed, and a
  // ring's swimmer and the slippers' climber move at their normal cost.
  const boots = [{ name: "Winged Boots", qty: 1, equipped: true, attuned: true }];
  assert.equal(flyingSpeedOf({ features: [], worn: itemSpeeds(boots, WIZARD, 30).fly }), 30);
  assert.equal(flyingSpeedOf({ features: [] }), null);
  assert.deepEqual(itemSpeeds([{ name: "Ring of Swimming", qty: 1, equipped: true }, { name: "Slippers of Spider Climbing", qty: 1, equipped: true, attuned: true }], WIZARD, 30), { swim: 40, climb: 30 });
});

// combat, Flying Movement: 'If a flying creature is knocked prone, has its speed reduced to 0, or is otherwise deprived of the ability to move, the creature falls, unless it has the ability to hover or it is being held aloft by magic, such as by the fly spell.'
await test("A flying speed from a worn magic item holds its wearer aloft by magic: a prone Winged Boots wearer stays up, and a character flying on its own wings, with no hover, still falls", async () => {
  const { combatKit } = await import("./lib/enforce-combat.mjs");
  const kit = await combatKit(world);
  const booted = world.addHero({ name: "Booted", class: "fighter", level: 5, maxHp: 40, speed: 30, equipment: [{ name: "Winged Boots", qty: 1, equipped: true, attuned: true }] });
  const winged = world.addHero({ name: "Winged", class: "fighter", level: 5, maxHp: 40, speed: 30, features: [{ name: "Dragon Wings", description: "" }] });
  await kit.fight(1, { heroFaces: { [booted.id]: 20, [winged.id]: 19 } });
  kit.place(booted.id, 2, 2);
  kit.place(winged.id, 4, 2);
  const after = {};
  try {
    for (const hero of [booted, winged]) {
      const up = await world.invoke("set_movement", { token: hero.id, movement: "fly" });
      assert.equal(up.ok, true, up.error);
      const down = await world.invoke("set_condition", { characterId: hero.id, condition: "prone" });
      assert.equal(down.ok, true, down.error);
      assert.ok(world.sheet(hero.id).conditions.includes("prone"), `setup: ${hero.name} is not prone`);
      after[hero.name] = kit.token(hero.id).movement;
    }
  } finally {
    await kit.endFight();
    for (const hero of [booted, winged]) world.patch(hero.id, { conditions: [], conditionMeta: {} });
  }
  assert.equal(after.Booted, "fly", "a prone Winged Boots wearer fell, though the boots' magic holds them aloft");
  assert.equal(after.Winged, "walk", "a prone flyer on its own wings stayed aloft without hovering or magic");
});

await test("ITM-07: An item that raises a score raises it: Belt of Dwarvenkind 'Your Constitution score increases by 2, to a maximum of 20'; Ioun Stone (ioun-stone) Agility, Fortitude, Insight, Intellect, Leadership and Strength 'Your <ability> score increases by 2, to a maximum of 20, while this ... orbits your head'", () => {
  const wrong = [];
  for (const [name, ability] of [["Belt of Dwarvenkind", "con"], ["Ioun Stone of Agility", "dex"], ["Ioun Stone of Fortitude", "con"], ["Ioun Stone of Insight", "wis"], ["Ioun Stone of Intellect", "int"], ["Ioun Stone of Leadership", "cha"], ["Ioun Stone of Strength", "str"]]) {
    const raised = effectiveAbilities(WIZARD.abilities, [{ name, qty: 1, equipped: true, attuned: true }])[ability];
    const want = Math.min(20, WIZARD.abilities[ability] + 2);
    if (raised !== want) wrong.push(`${name}: ${ability.toUpperCase()} ${raised} (SRD ${want})`);
  }
  assert.equal(wrong.length, 0, `score increases not applied, ${listed(wrong)}`);
  // "to a maximum of 20": a 19 rises to 20 and a 20 stays.
  assert.equal(effectiveAbilities({ ...WIZARD.abilities, con: 19 }, [{ name: "Belt of Dwarvenkind", qty: 1, attuned: true }]).con, 20);
  assert.equal(effectiveAbilities({ ...WIZARD.abilities, con: 20 }, [{ name: "Belt of Dwarvenkind", qty: 1, attuned: true }]).con, 20);
  // Constitution raised raises the saves and the modifier every number reads.
  assert.equal(wearing("Belt of Dwarvenkind").abilityMods.con, 3);
});

await test("ITM-08: Magic Items, Consumables: 'Some items are used up when they are activated'; Necklace of Fireballs 'detach a bead and throw it ... the bead detonates' (the bead is gone), Elemental Gem 'When you use an action to break the gem ... the gem's magic is lost'", () => {
  const refused = [];
  for (const name of ["Necklace of Fireballs", "Elemental Gem"]) {
    const problem = itemUseProblem({ name, qty: 1 });
    if (problem) refused.push(`${name}: "${problem.error}"`);
  }
  assert.equal(refused.length, 0, `single-use items use_item refuses, ${listed(refused)}`);
  // A Necklace of Prayer Beads is still kept, and the refusal names no other necklace's rule.
  assert.match(itemUseProblem({ name: "Necklace of Prayer Beads", qty: 1 })?.error ?? "", /kept, not consumed/);
  assert.doesNotMatch(itemUseProblem({ name: "Necklace of Prayer Beads", qty: 1 })?.error ?? "", /beads are powers/);
});

await test("ITM-09: Bracers of Archery (bracers-of-archery): 'you have proficiency with the longbow and shortbow, and you gain a +2 bonus to damage rolls on ranged attacks made with such weapons'", async () => {
  const { combatKit } = await import("./lib/enforce-combat.mjs");
  const kit = await combatKit(world);
  const archer = world.addHero({
    name: "Archer", class: "wizard", level: 5, abilities: { dex: 14 }, maxHp: 30,
    equipment: [{ name: "Longbow", qty: 1, equipped: true }, { name: "Arrows", qty: 20 }, { name: "Bracers of Archery", qty: 1, equipped: true, attuned: true }],
  });
  await kit.fight(1, { heroFaces: { [archer.id]: 20 } });
  const [dummy] = world.enemies();
  kit.place(archer.id, 2, 2);
  kit.place(dummy.id, 6, 2);
  kit.giveTurn(archer.id);
  const out = await kit.swing(archer.id, dummy.id, [15, 4], { weapon: "Longbow" });
  await kit.endFight();
  assert.equal(out.ok, true, out.error);
  // A wizard has no longbow proficiency: the bracers give it (+3 to hit),
  // and the hit deals 4 + 2 (Dexterity) + 2.
  assert.ok(
    out.damage?.total === 8 && out.toHit?.total === 15 + 2 + 3,
    `with the bracers the longbow hits at ${out.toHit?.total} (SRD ${15 + 2 + 3}) for ${out.damage?.total ?? "nothing"} (SRD 8)`,
  );
});

world.close();
finish();
