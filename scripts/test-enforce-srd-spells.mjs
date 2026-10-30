// The SRD 5.1 spell text against the engine (issue #570, "Rules and
// content"): the Spellcasting chapter's rules, the Spell Lists page, and all
// 319 spell pages of the rulebook ODM bundles (src/lib/rulebook/srd-5.1.json).
//
// Each spell page is read by scripts/lib/enforce-srd-spells-text.mjs and
// held up against what the engine answers for that name: the facts a cast
// needs (spellFactsFor, spellSchoolFor, materialComponents,
// spellDurationRounds) and the mechanics it resolves with (spellMechanicsFor,
// spellDamageFor, castShares). scripts/lib/enforce-spell-table.mjs pins about
// 80 spells by hand; this suite reads every page instead, so it reaches the
// other 240 and checks fields that table leaves out.
//
// Without the content pack only ODM's authored layer, the bundled checklist
// and the baked manifest answer; with it the pack's rows do. The suite runs
// both ways and every check holds in both unless it says otherwise.
//
// Each gap() is a finding from the #570 SRD text audit: it states the SRD
// behaviour, names the spells it reaches, and fails until the engine holds
// it. Where a page's wording defeats this suite's own reading (not the
// engine's), the spell is left out of that one check with the reason beside
// it.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, enemyOf, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";
import { onTurnOf, packAnswers } from "./lib/enforce-spells.mjs";
import { board } from "./lib/enforce-zones.mjs";
import { CONDITIONS, readSpellLists, readSpellPage } from "./lib/enforce-srd-spells-text.mjs";

const { test, gap, finish } = suite("test-enforce-srd-spells");
const pack = await packAnswers();
const { default: book } = await import("../src/lib/rulebook/srd-5.1.json", { with: { type: "json" } });
const { spellDamageFor, spellFactsFor, spellMechanicsFor, spellSchoolFor } = await import("../src/lib/content/index.ts");
const { castShares } = await import("../src/lib/srd/spell-mechanics.ts");
const { materialComponents } = await import("../src/lib/dm/cast-materials.ts");
const { spellDurationRounds } = await import("../src/lib/dm/spell-effects.ts");
const { casterViewsOf } = await import("../src/lib/srd/spell-prep.ts");
const { spellNameProblems } = await import("../src/lib/srd/legality/spells.ts");

const PAGES = book.pages.filter((page) => page.chapter === "spells").map(readSpellPage);
const SPELLS = PAGES.map((page) => {
  const resolved = spellMechanicsFor({ spell: page.name });
  return { page, facts: spellFactsFor(page.name), mech: resolved?.mech ?? null, resolved };
});
const listOf = (rows) => rows.join("; ");
const diceAt = (name, casterLevel, slotLevel) => spellDamageFor({ spell: name, casterLevel, slotLevel })?.dice ?? null;

await test("all 319 SRD spell pages are read, and every one names a spell the engine knows", () => {
  assert.equal(PAGES.length, 319);
  const unread = PAGES.filter((page) => String(page.castingTime).startsWith("unread") || !page.school);
  assert.deepEqual(unread.map((page) => page.name), []);
  assert.deepEqual(SPELLS.filter((spell) => !spell.facts).map((spell) => spell.page.name), []);
});

// ---- the block every spell page opens with ----

const differing = (field, read) => SPELLS
  .filter(({ page, facts }) => JSON.stringify(read(facts, page)) !== JSON.stringify(page[field]))
  .map(({ page, facts }) => `${page.name}: ${JSON.stringify(read(facts, page))}, the page ${JSON.stringify(page[field])}`);

await test("every spell's level, ritual tag and concentration are the page's", () => {
  assert.deepEqual(differing("level", (facts) => facts.level), []);
  assert.deepEqual(differing("ritual", (facts) => facts.ritual), []);
  assert.deepEqual(differing("concentration", (facts) => facts.concentration), []);
});

await test("every spell's casting time is the page's: action, bonus action, reaction or minutes", () => {
  assert.deepEqual(differing("castingTime", (facts) => facts.castingTime), []);
});

await test("every spell's components are the page's V, S and M", () => {
  for (const letter of ["verbal", "somatic", "material"]) {
    assert.deepEqual(differing(letter, (facts) => facts[letter]), [], letter);
  }
});

// SRD 5.1, Material (M): "if a cost is indicated for a component, a
// character must have that specific component", and one the spell consumes
// is provided for each casting. Three lines print a count and a price each,
// added up here from the page: Legend Lore's incense (250) and four ivory
// strips (50 each), Warding Bond's pair of rings (50 each), Magnificent
// Mansion's portal, marble and spoon (5 each).
const COUNTED = { "Legend Lore": 450, "Warding Bond": 100, "Magnificent Mansion": 15 };
await test("every priced material is the page's total, and consumed where the page says so", () => {
  const problems = [];
  for (const { page, facts } of SPELLS) {
    const priced = [...page.materialText.matchAll(/([\d,]+)\s*gp/gi)];
    const wanted = COUNTED[page.name] ?? priced.reduce((sum, match) => sum + Number(match[1].replace(/,/g, "")), 0);
    const parts = materialComponents(facts);
    // Create Undead's onyx is per corpse, Astral Projection's gems per creature.
    const got = parts.reduce((sum, part) => sum + part.gp * part.count, 0);
    if (got !== wanted) {
      problems.push(`${page.name}: ${got} gp, the page ${wanted} gp`);
    }
    const consumed = parts.some((part) => part.consumed);
    if (wanted && consumed !== /consume/i.test(page.materialText)) {
      problems.push(`${page.name}: consumed ${consumed}`);
    }
  }
  assert.deepEqual(problems, [], listOf(problems));
});

await test("every spell's range is the page's: feet, touch, sight, unlimited, special or self", () => {
  // With the content pack a Self spell loses the size of its area (SPL-01).
  const kindOnly = (range) => (range.kind === "self" ? { kind: "self" } : range);
  const problems = SPELLS
    .filter(({ page, facts }) => JSON.stringify(kindOnly(facts.range)) !== JSON.stringify(kindOnly(page.range)))
    .map(({ page, facts }) => `${page.name}: ${JSON.stringify(facts.range)}, the page ${page.rangeText}`);
  assert.deepEqual(problems, [], listOf(problems));
  if (!pack) {
    assert.deepEqual(differing("range", (facts) => facts.range), []);
  }
});

// SRD 5.1, Duration. Heroes' Feast and Sunburst print "Instantaneous" but
// lay a buff or a blindness that lasts; the engine counts what they lay.
await test("every spell that prints how long it lasts lasts that many rounds", () => {
  const problems = SPELLS
    .filter(({ page }) => page.rounds !== null)
    .filter(({ page }) => spellDurationRounds(page.name) !== page.rounds)
    .map(({ page }) => `${page.name}: ${spellDurationRounds(page.name)} rounds, the page "${page.durationText}"`);
  assert.deepEqual(problems, [], listOf(problems));
});

await gap("SPL-08", {
  rule: "SRD 5.1 spell pages (chapter spells): each page's level line names its school, e.g. revivify '3rd-level necromancy', mass-cure-wounds '5th-level evocation', mass-heal '9th-level evocation'; Spellcasting, 'The Schools of Magic': some rules refer to the schools",
  where: "src/lib/content/index.ts spellSchoolFor (pack row school) and src/lib/srd/manifest/spells.json (bundled `s`)",
  severity: "low",
  note: "The pack's SRD rows and the checklist both say conjuration; the bundled rulebook text says otherwise. One of ODM's two SRD sources is wrong: the school feeds Evocation, Abjuration and Necromancy features and the Hand's school filter.",
}, () => {
  const problems = SPELLS
    .filter(({ page }) => spellSchoolFor(page.name) !== page.school)
    .map(({ page }) => `${page.name}: ${spellSchoolFor(page.name)}, the page ${page.school}`);
  assert.deepEqual(problems, [], `schools that differ from the rulebook: ${listOf(problems)}`);
});

// ---- the Spell Lists page ----

const LISTS = readSpellLists(book.pages.find((page) => page.id === "spell-lists"));
const classesOf = (name) => spellFactsFor(name)?.classes ?? [];

await test("the engine puts no spell on a class list the Spell Lists page leaves it off", () => {
  const extra = [];
  for (const { page } of SPELLS) {
    for (const klass of classesOf(page.name).filter((entry) => LISTS[entry])) {
      if (!LISTS[klass].some((row) => row.name.toLowerCase() === page.name.toLowerCase())) {
        extra.push(`${page.name} on ${klass}`);
      }
    }
  }
  assert.deepEqual(extra, [], listOf(extra));
  assert.deepEqual(Object.keys(LISTS).sort(), ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard"]);
});

await gap("SPL-09", {
  rule: "SRD 5.1 spell-lists, 'Druid Spells', '7th Level': Fire Storm, Mirage Arcane, Plane Shift, Regenerate, Reverse Gravity",
  where: "src/lib/srd/manifest/spells.json (Plane Shift `c`) and the pack's classes_csv, read by src/lib/srd/legality/spells.ts spellNameProblems",
  severity: "low",
  note: "Every other entry of all eight lists, 778 rows, is on the engine's class list at its level.",
}, () => {
  const missing = Object.entries(LISTS).flatMap(([klass, rows]) =>
    rows.filter((row) => !classesOf(row.name).includes(klass) || spellFactsFor(row.name)?.level !== row.level).map((row) => `${row.name} (${klass})`));
  const druid = { class: "druid", level: 13, subclass: "", features: [], spellcasting: { ability: "wis", known: [], prepared: ["Fire Storm", "Plane Shift"], cantrips: [] } };
  const problems = spellNameProblems(casterViewsOf(druid)[0], "druid", { spellOf: (name) => spellFactsFor(name), held: new Set(), racialCantrips: [] });
  if (problems.some((line) => /Fire Storm/.test(line))) {
    throw new Error("setup: the legality check refused Fire Storm, a druid spell");
  }
  assert.deepEqual([...missing, ...problems], [], `off the engine's list: ${listOf(missing)}; a 13th-level druid preparing it: ${listOf(problems)}`);
});

// ---- what each spell resolves as ----

// Where a page's own wording misleads this suite's reading, not the engine:
const FIRST_SAVE_IS_NOT_THE_SPELLS = {
  Earthquake: "the first save named is a concentrating creature's CON; the prone save is DEX",
  "Irresistible Dance": "the first is the dancer's disadvantage on DEX saves; the way out is a WIS save",
};
const ATTACK_LATER = new Set(["Flame Blade", "Spiritual Weapon", "Dispel Evil and Good"]); // a buff whose attacks come on later turns
const DICE_ELSEWHERE = {
  Web: "the burning strands are the web zone's (src/lib/battlemap/zones-spells.ts)",
  "Bestow Curse": "the 1d8 necrotic is one of the curse's variants, a rider on the caster's hits",
  "Phantasmal Killer": "the 4d10 comes at the end of each of the target's turns, from the condition",
  Weird: "the 4d10 comes at the end of each of the target's turns, from the condition",
  Geas: "the 5d10 for disobeying is the GM's (src/lib/srd/spell-support.ts)",
  "Prismatic Spray": "each ray rolls its own (src/lib/dm/prismatic.ts)",
  Symbol: "a glyph, cast in a minute and set off later; it is never cast in a fight",
  Earthquake: "a collapsing structure's 5d6 is the GM's terrain",
  "Magic Missile": "three darts of 1d4 + 1 roll as 3d4+3, held in test-enforce-casting-numbers",
};

await test("every spell that makes a spell attack resolves as one, melee or ranged as printed", () => {
  const problems = SPELLS
    .filter(({ page }) => page.attack && !ATTACK_LATER.has(page.name))
    .filter(({ page, mech }) => mech?.resolution !== "attack" || mech.attack !== page.attack)
    .map(({ page, mech }) => `${page.name}: ${mech?.resolution} ${mech?.attack}, the page a ${page.attack} spell attack`);
  assert.deepEqual(problems, [], listOf(problems));
  const stray = SPELLS.filter(({ page, mech }) => mech?.resolution === "attack" && !page.attack).map(({ page }) => page.name);
  assert.deepEqual(stray, [], `attack rolls the page never asks for: ${listOf(stray)}`);
});

await test("every save spell rolls the save its page names, and halves where the page says half", () => {
  const problems = [];
  for (const { page, mech } of SPELLS.filter((spell) => spell.mech?.resolution === "save")) {
    if (!(page.name in FIRST_SAVE_IS_NOT_THE_SPELLS) && mech.save !== page.save && !mech.condition?.noInitialSave) {
      problems.push(`${page.name}: ${mech.save}, the page ${page.save}`);
    }
    if (page.dice && !(page.name in DICE_ELSEWHERE) && Boolean(mech.halfOnSave) !== page.half) {
      problems.push(`${page.name}: half ${Boolean(mech.halfOnSave)}, the page ${page.half}`);
    }
  }
  assert.deepEqual(problems, [], listOf(problems));
});

await test("every damaging spell deals the type its page prints", () => {
  const problems = SPELLS
    .filter(({ page, mech }) => page.damageType && ["save", "attack", "auto"].includes(mech?.resolution) && !(page.name in DICE_ELSEWHERE))
    .filter(({ page, mech }) => mech.damageType !== page.damageType && mech.secondType !== page.damageType)
    .map(({ page, mech }) => `${page.name}: ${mech.damageType}, the page ${page.damageType}`);
  assert.deepEqual(problems, [], listOf(problems));
});

await test("every damaging spell rolls its printed dice at its own level, and its printed step from each slot above", () => {
  const problems = [];
  for (const { page, mech } of SPELLS) {
    if (!page.dice || !["save", "attack", "auto"].includes(mech?.resolution) || page.name in DICE_ELSEWHERE || page.name === "Wall of Thorns") {
      continue;
    }
    const base = page.level === 0 ? diceAt(page.name, 1) : diceAt(page.name, 20, page.level);
    if (!base?.startsWith(page.dice)) {
      problems.push(`${page.name}: ${base}, the page ${page.dice}`);
      continue;
    }
    if (page.level > 0 && page.level < 9) {
      const next = diceAt(page.name, 20, page.level + 1);
      const grown = page.upcast
        ? base.replace(new RegExp(`(\\d+)d${page.upcast.sides}`), (_, count) => `${Number(count) + page.upcast.count}d${page.upcast.sides}`)
        : base;
      if (next !== grown && !/two slot levels/i.test(page.higher)) {
        problems.push(`${page.name}: ${next} from a slot above, the page ${grown}`);
      }
    }
    if (page.level === 0 && page.tiers.length === 3) {
      const tiers = [5, 11, 17].map((level) => diceAt(page.name, level));
      if (JSON.stringify(tiers) !== JSON.stringify(page.tiers)) {
        problems.push(`${page.name}: ${tiers}, the page ${page.tiers}`);
      }
    }
  }
  assert.deepEqual(problems, [], listOf(problems));
});

await test("every healing spell that rolls dice heals with them", () => {
  const problems = SPELLS
    .filter(({ page }) => page.healDice && page.name !== "Vampiric Touch")
    .filter(({ page, mech }) => mech?.resolution !== "heal" || !diceAt(page.name, 20, page.level)?.startsWith(page.healDice))
    .map(({ page, mech }) => `${page.name}: ${mech?.resolution} ${diceAt(page.name, 20, page.level)}, the page ${page.healDice}`);
  assert.deepEqual(problems, [], listOf(problems));
});

// An effect of ODM's own name (mocked, baned, slowed) is the spell's rider;
// one of the SRD's conditions must be one the page names.
await test("every SRD condition a spell lays on a failed save is one its page names", () => {
  const problems = SPELLS
    .filter(({ mech }) => mech?.condition && CONDITIONS.includes(mech.condition.name))
    .filter(({ page, mech }) => !page.conditions.includes(mech.condition.name))
    .map(({ page, mech }) => `${page.name}: ${mech.condition.name}`);
  assert.deepEqual(problems, [], listOf(problems));
  assert.ok(SPELLS.filter(({ mech }) => mech?.condition && CONDITIONS.includes(mech.condition.name)).length >= 20);
});

// ---- areas and targets ----

// SRD 5.1, Areas of Effect: "Spells such as burning hands and cone of cold
// cover an area, allowing them to affect multiple creatures at once."
await gap("SPL-02", {
  rule: "SRD 5.1 spellcasting, 'Areas of Effect': an area spell affects multiple creatures at once; shatter: 'Each creature in a 10-foot-radius sphere centered on that point must make a Constitution saving throw'; lightning-bolt: 'Each creature in the line must make a Dexterity saving throw'",
  where: "src/lib/srd/spell-mechanics.ts parseSpellMech/areaOf (no `area` for these rows) read by castShares in src/lib/dm/cast-guard.ts",
  severity: "medium",
  note: "aoe_damage still catches the area in one call; cast_at_enemy, the per-creature path the cast tools offer for an area spell, holds one creature and asks a second action for the next. The pack's Shatter row prints its 10-foot radius with soft hyphens; Lightning Bolt prints a line with no 'N-foot line'.",
}, async () => {
  const single = SPELLS
    .filter(({ page, mech }) => page.area && mech?.resolution === "save")
    .filter(({ mech, resolved }) => castShares(mech, { spellLevel: resolved.spellLevel, slotLevel: null, casterLevel: 20 }) < 2)
    .map(({ page }) => page.name);
  const { world, sheets: [mage], enemies: [a, b] } = await table([caster("wizard", "int", ["Shatter"], [], 9)], 2);
  const second = await onTurnOf(world, mage.id, async () => {
    world.dice(1, 1, 1, 20);
    const first = await world.invokeAsIs("cast_at_enemy", { characterId: mage.id, targetEnemyId: a.id, spell: "Shatter", level: 2 });
    world.clearDice();
    if (!first.ok) {
      throw new Error(`setup: the first Shatter was refused: ${first.error}`);
    }
    world.dice(20);
    const out = await world.invokeAsIs("cast_at_enemy", { characterId: mage.id, targetEnemyId: b.id, spell: "Shatter", level: 2 });
    world.clearDice();
    return out;
  });
  assert.ok(single.length === 0 && second.ok, `one casting holds one creature: ${listOf(single)}; Shatter's second creature: ${second.error}`);
});

await gap("SPL-03", {
  rule: "SRD 5.1 invisibility, 'At Higher Levels': 'When you cast this spell using a spell slot of 3rd level or higher, you can target one additional creature for each slot level above 2nd' (heroism and longstrider: above 1st)",
  where: "src/lib/srd/spell-mech-overrides.ts (these buff rows carry no `targets`), read by src/lib/dm/cast-buff.ts (`most` is 1 for an ally buff without it)",
  severity: "medium",
  note: "Fly, Enhance Ability, Hold Person and the rest that say the same carry targets.perSlotLevel and hold it.",
}, async () => {
  const short = SPELLS
    .filter(({ page }) => page.moreTargets)
    .filter(({ page, mech, resolved }) => castShares(mech, { spellLevel: resolved.spellLevel, slotLevel: page.level + 1, casterLevel: 20 }) < 2)
    .map(({ page }) => page.name);
  const { world, sheets: [mage, friend] } = await table([caster("wizard", "int", ["Invisibility"], [], 9), FIGHTER]);
  const cast = await world.invoke("cast_buff", { characterId: mage.id, spell: "Invisibility", level: 3, targetCharacterIds: [mage.id, friend.id] });
  assert.ok(short.length === 0 && cast.ok, `one creature from a higher slot: ${listOf(short)}; Invisibility from a 3rd-level slot on two: ${cast.error}`);
});

if (pack) {
  await gap("SPL-01", {
    rule: "SRD 5.1 spellcasting, 'Spell Range': 'Spells that create cones or lines of effect that originate from you also have a range of self'; burning-hands, Range 'Self (15-foot cone)': 'Each creature in a 15-foot cone must make a Dexterity saving throw'",
    where: "src/lib/srd/spell-facts.ts factsFromRow/rangeFrom (the pack row's range is plain 'Self'), read by src/lib/dm/cast-reach.ts spellReachProblem",
    severity: "high",
    note: "With the content pack only. Without it the checklist's 'self:15' answers and the cast is refused. aoe_damage still refuses through the area's shape; cast_at_enemy does not.",
  }, async () => {
    const lost = SPELLS
      .filter(({ page, facts }) => page.range.areaFeet && facts.range.areaFeet !== page.range.areaFeet)
      .map(({ page }) => page.name);
    const { world, sheets: [mage], enemies: [far] } = await board([caster("wizard", "int", ["Burning Hands"], [], 9)], { 0: { x: 2, y: 4 }, e0: { x: 22, y: 4 } });
    world.dice(1, 1, 1, 20);
    const cast = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: far.id, spell: "Burning Hands", level: 1 });
    world.clearDice();
    assert.ok(lost.length === 0 && !cast.ok, `a Self spell's area size is lost: ${listOf(lost)}; Burning Hands at a creature 100 feet away was ${cast.ok ? "cast" : "refused"}`);
  });
} else {
  await test("without the pack a Self spell keeps its area's size and reaches no farther", async () => {
    const { world, sheets: [mage], enemies: [far] } = await board([caster("wizard", "int", ["Burning Hands"], [], 9)], { 0: { x: 2, y: 4 }, e0: { x: 22, y: 4 } });
    const cast = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: far.id, spell: "Burning Hands", level: 1 });
    assert.equal(cast.ok, false);
    assert.match(String(cast.error), /reach of 15 ft/);
  });
}

// ---- dice, conditions and riders a page prints ----

await gap("SPL-04", {
  rule: "SRD 5.1 wall-of-thorns: 'When the wall appears, each creature within its area must make a Dexterity saving throw. On a failed save, a creature takes 7d8 piercing damage, or half as much damage on a successful save'; 'At Higher Levels': 'both types of damage increase by 1d8 for each slot level above 6th'",
  where: "src/lib/srd/spell-scaling.ts upcastStep (reads only 'increases by') and upcastDamage, so spellDamageFor in src/lib/content/index.ts answers null",
  severity: "medium",
  note: "A null answer for a published spell falls back to the caller's dice. The wall's own zone (zones-spells.ts) holds the 7d8 slashing for entering it; the 7d8 piercing on appearing is the caller's.",
}, async () => {
  const { world, sheets: [druid], enemies: [enemy] } = await table([caster("druid", "wis", ["Wall of Thorns"], [], 13)]);
  world.diceLog();
  world.dice(...new Array(8).fill(1), 20);
  const cast = await world.invoke("aoe_damage", { casterCharacterId: druid.id, spell: "Wall of Thorns", level: 6, damage: "1d4", saveAbility: "dex", enemyIds: [enemy.id] });
  const log = world.diceLog();
  world.clearDice();
  if (!cast.ok) {
    throw new Error(`setup: Wall of Thorns was refused: ${cast.error}`);
  }
  const d8 = log.filter((die) => die.sides === 8).length;
  const d4 = log.filter((die) => die.sides === 4).length;
  assert.ok(d8 === 7 && d4 === 0, `rolled ${d8}d8 and ${d4}d4 (the caller sent 1d4); spellDamageFor answers ${diceAt("Wall of Thorns", 20, 6)}`);
});

await gap("SPL-05", {
  rule: "SRD 5.1 contagion: 'Make a melee spell attack against a creature within your reach. On a hit, the target is poisoned. At the end of each of the poisoned target's turns, the target must make a Constitution saving throw. If the target succeeds on three of these saves, it is no longer poisoned... If the target fails three of these saves... choose one of the diseases below'",
  where: "src/lib/srd/spell-mech-overrides.ts contagion (noDamage, a note to afflict at once), read by src/lib/dm/pc-attack.ts",
  severity: "medium",
  note: "The row follows the older printing (the disease at once). The turn-end tally Flesh to Stone uses (condition.turnEnd.tally) would hold the SRD's three saves.",
}, async () => {
  const { world, sheets: [priest], enemies: [enemy] } = await table([caster("cleric", "wis", ["Contagion"], [], 9)]);
  world.dice(19);
  const hit = await world.invoke("pc_attack", { characterId: priest.id, targetEnemyId: enemy.id, spell: "Contagion", level: 5 });
  world.clearDice();
  if (!hit.ok || !hit.result?.hit) {
    throw new Error(`setup: the touch did not land: ${hit.error ?? "missed"}`);
  }
  const after = enemyOf(world, enemy.id);
  assert.ok(after.conditions.includes("poisoned"), `a hit left ${JSON.stringify(after.conditions)}; the row says: ${spellMechanicsFor({ spell: "Contagion" }).mech.note}`);
});

await gap("SPL-06", {
  rule: "SRD 5.1 storm-of-vengeance: 'On a failed save, a creature takes 2d6 thunder damage and becomes deafened for 5 minutes'; prismatic-wall: 'the creature must succeed on a Constitution saving throw or become blinded for 1 minute'",
  where: "src/lib/srd/spell-mechanics.ts parsedCondition (the spell's duration, or a repeat save found anywhere in the text, in place of the sentence's own)",
  severity: "low",
  note: "Storm of Vengeance's deafness lasts the spell's minute, not five; Prismatic Wall's blindness takes the indigo layer's repeat save and the wall's ten minutes.",
}, async () => {
  const { world, sheets: [druid], enemies: [enemy] } = await table([caster("druid", "wis", ["Storm of Vengeance"], [], 17)]);
  world.dice(1, 1, 1);
  const storm = await world.invoke("aoe_damage", { casterCharacterId: druid.id, spell: "Storm of Vengeance", level: 9, enemyIds: [enemy.id] });
  world.clearDice();
  if (!storm.ok) {
    throw new Error(`setup: Storm of Vengeance was refused: ${storm.error}`);
  }
  const deaf = enemyOf(world, enemy.id).conditionMeta?.deafened ?? {};
  const blind = spellMechanicsFor({ spell: "Prismatic Wall" }).mech.condition ?? {};
  const wrong = [
    deaf.rounds !== 50 ? `Storm of Vengeance deafened for ${deaf.rounds} rounds, the page 50` : "",
    blind.saveEnds || (blind.rounds ?? 0) !== 10 ? `Prismatic Wall blinded with a repeat save ${Boolean(blind.saveEnds)} for ${blind.rounds ?? "the spell's"} rounds, the page 10 and none` : "",
  ].filter(Boolean);
  assert.deepEqual(wrong, [], listOf(wrong));
});

await gap("SPL-07", {
  rule: "SRD 5.1 prismatic-wall: approaching it is 'a Constitution saving throw or become blinded for 1 minute'; passing through, 'the creature must make a Dexterity saving throw or be affected by that layer's properties' (Red: 10d6 fire, half on a success)",
  where: "src/lib/srd/spell-mechanics.ts parseSpellMech (the first save named joined to the first damage named), no row in src/lib/srd/spell-mech-*.ts",
  severity: "low",
  note: "aoe_damage on Prismatic Wall rolls the red layer's 10d6 fire against the approach's CON save.",
}, async () => {
  const { world, sheets: [mage], enemies: [enemy] } = await table([caster("wizard", "int", ["Prismatic Wall"], [], 17)]);
  world.dice(...new Array(10).fill(1), 1);
  const cast = await world.invoke("aoe_damage", { casterCharacterId: mage.id, spell: "Prismatic Wall", level: 9, enemyIds: [enemy.id] });
  world.clearDice();
  if (!cast.ok) {
    throw new Error(`setup: Prismatic Wall was refused: ${cast.error}`);
  }
  assert.ok(!(cast.result.saveAbility === "con" && cast.result.damageRolled > 0), `a ${cast.result.saveAbility} save against ${cast.result.damageRolled} fire damage`);
});

// ---- the Spellcasting chapter's rules ----

// SRD 5.1, Combining Magical Effects: "if two clerics cast bless on the same
// target, that character gains the spell's benefit only once".
await test("two clerics' Bless on one fighter adds one d4, not two", async () => {
  const priest = caster("cleric", "wis", ["Bless"], [], 5);
  const { world, sheets: [first, second, fighter], enemies: [enemy] } = await table([priest, priest, FIGHTER]);
  for (const cleric of [first, second]) {
    const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Bless", level: 1, targetCharacterIds: [fighter.id] });
    assert.equal(cast.ok, true, cast.error);
  }
  world.diceLog();
  world.dice(10, 3, 3, 5);
  const swing = await world.invoke("pc_attack", { characterId: fighter.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  const d4 = world.diceLog().filter((die) => die.sides === 4).length;
  world.clearDice();
  assert.equal(swing.ok, true, swing.error);
  assert.equal(d4, 1);
});

// SRD 5.1, Casting Time, Bonus Action: "You can't cast another spell during
// the same turn, except for a cantrip with a casting time of 1 action." The
// order does not matter: a levelled spell first bars the bonus-action spell.
await test("a levelled spell cast with the action bars a bonus-action spell on the same turn", async () => {
  const { world, sheets: [priest], enemies: [enemy] } = await table([caster("cleric", "wis", ["Hold Person", "Healing Word"], [], 5)]);
  const after = await onTurnOf(world, priest.id, async () => {
    world.dice(1);
    const hold = await world.invokeAsIs("cast_at_enemy", { characterId: priest.id, targetEnemyId: enemy.id, spell: "Hold Person", level: 2 });
    world.clearDice();
    assert.equal(hold.ok, true, hold.error);
    return world.invokeAsIs("use_spell_slot", { characterId: priest.id, spell: "Healing Word", level: 1 });
  });
  assert.equal(after.ok, false);
  assert.match(String(after.error), /levelled spell/);
});

await gap("SPL-10", {
  rule: "SRD 5.1 spellcasting, 'Longer Casting Times': 'When you cast a spell with a casting time longer than a single action or reaction, you must spend your action each turn casting the spell, and you must maintain your concentration while you do so... If your concentration is broken, the spell fails, but you don't expend a spell slot.'",
  where: "src/lib/dm/cast-rules.ts longCastingProblem (refuses any casting time in minutes during a fight)",
  severity: "low",
  note: "scripts/test-enforce-casting-limits.mjs 'a spell with a casting time of a minute or more is not cast in a fight' asserts the refusal. Rituals are a separate rule (ten minutes longer) and stay out of this.",
}, async () => {
  const { world, sheets: [mage] } = await table([caster("wizard", "int", ["Identify"], [], 5)]);
  const cast = await world.invoke("use_spell_slot", { characterId: mage.id, spell: "Identify", level: 1 });
  assert.equal(cast.ok, true, `a 1-minute spell begun in a fight: ${cast.error}`);
});

closeTables();
finish();
