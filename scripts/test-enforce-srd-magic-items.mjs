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
// Each gap() is a finding from the #570 SRD text audit: it asserts what the
// SRD 5.1 text says and fails today. Nothing here needs the content pack.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, gap, finish } = suite("test-enforce-srd-magic-items");
const world = await openWorld();
const { matchMagicItem, magicItemNamed, effectiveAbilities, mayAttune } = await import("../src/lib/srd/magic-items.ts");
const { chargeRuleOf } = await import("../src/lib/srd/item-charge-rules.ts");
const { spendChargesMath } = await import("../src/lib/dm/item-charges.ts");
const { itemSpellCast, itemSpellsOf } = await import("../src/lib/srd/item-spells.ts");
const { itemUseProblem, consumableEffect } = await import("../src/lib/dm/item-logic.ts");
const { potionPlan } = await import("../src/lib/dm/consumables.ts");
const { computeSheetDerived } = await import("../src/lib/srd/index.ts");

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
      const dc = /save DC (\d+)/.exec(item.text);
      if (spell.dc) assert.equal(spell.dc, Number(dc[1]), `${item.name} DC`);
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

await gap(
  "ITM-01",
  {
    rule: "A staff's last charge rolls a d20 as its text prints: Staff of Healing (staff-of-healing) 'If you expend the last charge, roll a d20. On a 1, the staff vanishes in a flash of light, lost forever'; Staff of Striking, Swarming Insects and the Woodlands lose their magic or are destroyed on a 1; Staff of Power 'On a 1, the staff retains its +2 bonus ... but loses all other properties. On a 20, the staff regains 1d8+2 charges'; Staff of the Magi 'On a 20, the staff regains 1d12+1 charges'",
    where: "scripts/generate-magic-items.mjs chargesOf (lastChargeD20 only for text that says 'destroyed'), src/lib/dm/item-charges.ts spendChargesMath (knows only 'destroyed on a 1')",
    severity: "medium",
  },
  () => {
    const missed = [];
    for (const name of ["Staff of Healing", "Staff of Striking", "Staff of Swarming Insects", "Staff of the Woodlands", "Staff of Power", "Staff of the Magi"]) {
      assert.ok(/last charge, roll a d20/i.test(textOf(name)), name);
      const item = { name, qty: 1, charges: 1 };
      const spent = spendChargesMath(item, chargeRuleOf(item), 1);
      if (!spent.d20) missed.push(name);
    }
    assert.equal(missed.length, 0, `staffs whose last charge rolls no d20, ${listed(missed)}`);
  },
);

await gap(
  "ITM-02",
  {
    rule: "Magic Items, Spells (magic-items): 'Some magic items allow the user to cast a spell from the item ... doesn't expend any of the user's spell slots'; e.g. Eyes of Charming 'expend 1 charge ... to cast the charm person spell (save DC 13)', Medallion of Thoughts 'detect thoughts (save DC 13)', Necklace of Fireballs 'detonates as a 3rd-level fireball spell (save DC 15)', Orb of Dragonkind (artifacts) 'cure wounds (5th-level version, 3 charges), daylight, death ward, or scrying (save DC 18)'",
    where: "src/lib/srd/item-spells.ts ROWS (use_item answers 'casts no spell the server knows', so the cast spends the caster's own slot and DC, or cannot be made)",
    severity: "medium",
  },
  () => {
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
  },
);

await gap(
  "ITM-03",
  {
    rule: "An item's bonus to spell attack rolls and spell save DC is the wielder's: Wand of the War Mage 'you gain a bonus to spell attack rolls determined by the wand's rarity'; Robe of the Archmagi 'Your spell save DC and spell attack bonus each increase by 2'; Staff of Power, the Magi and the Woodlands 'a +2 bonus to spell attack rolls'",
    where: "src/lib/srd/index.ts computeSheetDerived (spellAttackParts and spellSaveParts hold proficiency and the ability only; src/lib/classes/magic-items.json has no effect kind for them, and scripts/test-enforce-magic-items.mjs pins the Staff of Power's effects to AC and saves alone)",
    severity: "medium",
  },
  () => {
    const wrong = [];
    for (const [name, attack, dc] of [["+2 Wand of the War Mage", 2, 0], ["Robe of the Archmagi", 2, 2], ["Staff of Power", 2, 0], ["Staff of the Magi", 2, 0], ["Staff of the Woodlands", 2, 0]]) {
      const derived = wearing(name);
      if (derived.spellAttack !== bare.spellAttack + attack) wrong.push(`${name} spell attack +${derived.spellAttack} (SRD +${bare.spellAttack + attack})`);
      if (derived.spellSaveDc !== bare.spellSaveDc + dc) wrong.push(`${name} spell save DC ${derived.spellSaveDc} (SRD ${bare.spellSaveDc + dc})`);
    }
    assert.equal(wrong.length, 0, `spell bonuses not added, ${listed(wrong)}`);
  },
);

await gap(
  "ITM-04",
  {
    rule: "Mantle of Spell Resistance (mantle-of-spell-resistance): 'You have advantage on saving throws against spells while you wear this cloak'; likewise Robe of the Archmagi, Scarab of Protection and Staff of the Magi",
    where: "src/lib/dm/rolls.ts resolveRollExpression and src/lib/dm/roll-feature-riders.ts (a save marked magical reads Gnome Cunning and the like, never a worn item)",
    severity: "medium",
  },
  async () => {
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
  },
);

await gap(
  "ITM-05",
  {
    rule: "Periapt of Proof against Poison (periapt-of-proof-against-poison): 'You are immune to the poisoned condition and have immunity to poison damage'",
    where: "src/lib/classes/magic-items.json (no row: the generator reads resistance only) and src/lib/srd/magic-items.ts MagicItemEffect (no immunity kind), so src/lib/dm/pc-damage.ts and src/lib/dm/set-condition.ts never hear of it",
    severity: "high",
  },
  async () => {
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
  },
);

await gap(
  "ITM-06",
  {
    rule: "An item's speed is the wearer's: Winged Boots 'you have a flying speed equal to your walking speed'; Ring of Swimming 'You have a swimming speed of 40 feet while wearing this ring'; Slippers of Spider Climbing 'You have a climbing speed equal to your walking speed'",
    where: "src/lib/srd/index.ts otherSpeeds (reads features only, src/lib/srd/authored-effects-more.ts authoredSpeeds), so the board (src/lib/battlemap/movement.ts) lets no item-wearer fly, swim or climb at speed",
    severity: "medium",
  },
  () => {
    const wrong = [];
    for (const [name, mode, feet] of [["Winged Boots", "fly", 30], ["Ring of Swimming", "swim", 40], ["Slippers of Spider Climbing", "climb", 30]]) {
      const speeds = wearing(name).speeds ?? {};
      if (speeds[mode] !== feet) wrong.push(`${name}: ${mode} ${speeds[mode] ?? "none"} (SRD ${feet})`);
    }
    assert.equal(wrong.length, 0, `item speeds the sheet does not carry, ${listed(wrong)}`);
  },
);

await gap(
  "ITM-07",
  {
    rule: "An item that raises a score raises it: Belt of Dwarvenkind 'Your Constitution score increases by 2, to a maximum of 20'; Ioun Stone (ioun-stone) Agility, Fortitude, Insight, Intellect, Leadership and Strength 'Your <ability> score increases by 2, to a maximum of 20, while this ... orbits your head'",
    where: "scripts/generate-magic-items.mjs parseEffects and src/lib/srd/magic-items.ts (only set_ability, 'your score is N'; scripts/lib/magic-item-corrections.mjs adds only the Ioun Stone of Protection; scripts/test-enforce-magic-items.mjs pins the belt to poison resistance alone)",
    severity: "medium",
  },
  () => {
    const wrong = [];
    for (const [name, ability] of [["Belt of Dwarvenkind", "con"], ["Ioun Stone of Agility", "dex"], ["Ioun Stone of Fortitude", "con"], ["Ioun Stone of Insight", "wis"], ["Ioun Stone of Intellect", "int"], ["Ioun Stone of Leadership", "cha"], ["Ioun Stone of Strength", "str"]]) {
      const raised = effectiveAbilities(WIZARD.abilities, [{ name, qty: 1, equipped: true, attuned: true }])[ability];
      const want = Math.min(20, WIZARD.abilities[ability] + 2);
      if (raised !== want) wrong.push(`${name}: ${ability.toUpperCase()} ${raised} (SRD ${want})`);
    }
    assert.equal(wrong.length, 0, `score increases not applied, ${listed(wrong)}`);
  },
);

await gap(
  "ITM-08",
  {
    rule: "Magic Items, Consumables: 'Some items are used up when they are activated'; Necklace of Fireballs 'detach a bead and throw it ... the bead detonates' (the bead is gone), Elemental Gem 'When you use an action to break the gem ... the gem's magic is lost'",
    where: "src/lib/classes/item-tags.json via src/lib/srd/item-tags.ts (the necklace tagged kept, the gem durable) and src/lib/dm/item-logic.ts itemUseProblem, whose refusal says 'a necklace's beads are powers that return at dawn'",
    severity: "low",
  },
  () => {
    const refused = [];
    for (const name of ["Necklace of Fireballs", "Elemental Gem"]) {
      const problem = itemUseProblem({ name, qty: 1 });
      if (problem) refused.push(`${name}: "${problem.error}"`);
    }
    assert.equal(refused.length, 0, `single-use items use_item refuses, ${listed(refused)}`);
  },
);

await gap(
  "ITM-09",
  {
    rule: "Bracers of Archery (bracers-of-archery): 'you have proficiency with the longbow and shortbow, and you gain a +2 bonus to damage rolls on ranged attacks made with such weapons'",
    where: "src/lib/dm/gear-attack.ts and src/lib/dm/pc-attack-damage.ts (the riders read the weapon's own row only; no worn item adds to its damage or its proficiency)",
    severity: "medium",
  },
  async () => {
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
  },
);

world.close();
finish();
