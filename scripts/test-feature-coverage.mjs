// The safety net: every feature name that can reach a character sheet is
// accounted for. A name is covered when it has a server-enforced effect, a
// resource counter the class actually gets (populateResources, not a fuzzy
// name match: "Relentless Rage" is not Rage), an engine outside those two
// tables that names it (ENFORCED_ELSEWHERE, each entry checked against the
// file it points at), OR is listed in the acknowledged guidance-only set
// below. A NEW feature name that is none of these fails this test, which is
// what stops the enforcement gap reopening as classes and content grow.
//
// When you add a feature: give it real mechanics in feature-effects.ts or a
// counter in class-resources.ts / resources.json, or add it here with a
// one-word reason. "Acknowledged" means the DM narrates it from the sheet
// and no server mechanic is needed (subclass markers, spell-list grants,
// passive flavour), not that it was forgotten.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
const { effectsFor } = await import("../src/lib/srd/feature-effects.ts");
const { matchResource, populateResources, RESOURCE_DEFS } = await import(
  "../src/lib/srd/class-resources.ts"
);
const AUTHORED_ROWS = (await import("../src/lib/srd/authored-effects.ts")).authoredRows();

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib");
const classFeatures = JSON.parse(readFileSync(join(srcDir, "srd", "class-features.json"), "utf8"))
  .classes;
const races = JSON.parse(readFileSync(join(srcDir, "srd", "races.json"), "utf8")).races;

const ALL_CLASSES = [
  "fighter", "monk", "barbarian", "rogue", "paladin", "wizard",
  "cleric", "druid", "ranger", "sorcerer", "warlock", "bard",
];

// Names the DM narrates from the sheet with no server mechanic: subclass
// choices, spell-list expansions, and passive or roleplay features. Not a
// backlog; these are deliberately guidance-only.
const ACKNOWLEDGED = new Set([
  // Subclass selection markers (the pick has mechanics; the marker does not).
  "Arcane Tradition", "Bard College", "Divine Domain", "Druid Circle",
  "Martial Archetype", "Monastic Tradition", "Otherworldly Patron",
  "Primal Path", "Ranger Archetype", "Roguish Archetype", "Sacred Oath",
  "Sorcerous Origin", "Dragon Ancestor",
  // Spellcasting-shape features (slots and lists live on the sheet).
  "Spellcasting", "Pact Magic", "Pact Boon", "Ritual Casting",
  "Magical Secrets", "Additional Magical Secrets", "Circle Spells",
  "Bonus Cantrip", "Metamagic", "Metamagic Option", "Eldritch Invocations",
  "Evocation Savant",
  // Proficiency and skill grants (applied to the sheet at pick time).
  // Jack of All Trades and Remarkable Athlete moved to feature-effects.ts
  // (half_proficiency riders) and are enforced now.
  "Expertise",
  "Bonus Proficiencies (Lore)", "Bonus Proficiency (heavy armor)",
  "Druidic", "Thieves' Cant", "Additional Fighting Style", "Fighting Style",
  // Passive / roleplay / exploration features the DM narrates. Blindsense is
  // held by construction: ODM never makes an attacker guess a hidden
  // creature's square (tail-combat.md).
  "Blindsense",
  "Timeless Body",
  "Tongue of the Sun and Moon",
  // Unarmored Defense IS enforced, via the AC engine (src/lib/srd/armor.ts
  // unarmoredFormulaFor), not the effectsFor table, so it reads as
  // acknowledged here.
  "Unarmored Defense",
  // Artificer. The specialist marker and the tool/attunement perks are
  // narrated from the sheet, exactly like the other subclass markers and
  // proficiency grants above. "Infuse Item" is the gateway to a real pick
  // list (src/lib/srd/options.json), and the infusions themselves carry the
  // mechanics; the feature naming the list does not.
  "Artificer Specialist", "Infuse Item", "Magical Tinkering", "Tool Expertise",
  "Magic Item Adept", "Magic Item Savant", "Magic Item Master",
  "Soul of Artifice",
]);

// Features the engine holds outside the effect and counter tables, with the
// file that holds each. The test below reads that file for the name, so an
// entry cannot outlive the code that enforces it.
const ENFORCED_ELSEWHERE = new Map([
  ["Aura of Courage", "src/lib/srd/trait-rules.ts"],
  ["Aura of Devotion", "src/lib/srd/trait-rules.ts"],
  ["Mindless Rage", "src/lib/srd/trait-rules.ts"],
  ["Purity of Body", "src/lib/srd/trait-rules.ts"],
  ["Nature's Ward", "src/lib/srd/trait-rules.ts"],
  ["Divine Health", "src/lib/srd/trait-rules.ts"],
  ["Diamond Soul", "src/lib/srd/trait-rules.ts"],
  ["Slippery Mind", "src/lib/srd/trait-rules.ts"],
  ["Feral Instinct", "src/lib/srd/trait-rules.ts"],
  ["Indomitable Might", "src/lib/srd/trait-rules.ts"],
  ["Draconic Resilience", "src/lib/srd/trait-rules.ts"],
  ["Primal Champion", "src/lib/srd/trait-rules.ts"],
  ["Persistent Rage", "src/lib/dm/condition-tick.ts"],
  ["Survivor", "src/lib/dm/condition-tick.ts"],
  ["Font of Inspiration", "src/lib/srd/class-resources.ts"],
  ["Sorcerous Restoration", "src/lib/srd/resource-refills.ts"],
  ["Superior Inspiration", "src/lib/srd/resource-refills.ts"],
  ["Perfect Self", "src/lib/srd/resource-refills.ts"],
  ["Use Magic Device", "src/lib/srd/magic-items.ts"],
  ["Destroy Undead (CR 1/2)", "src/lib/dm/feature-spends.ts"],
  ["Destroy Undead (CR 1)", "src/lib/dm/feature-spends.ts"],
  ["Destroy Undead (CR 2)", "src/lib/dm/feature-spends.ts"],
  ["Destroy Undead (CR 3)", "src/lib/dm/feature-spends.ts"],
  ["Destroy Undead (CR 4)", "src/lib/dm/feature-spends.ts"],
  ["Empty Body", "src/lib/dm/feature-spends.ts"],
  ["Countercharm", "src/lib/srd/trait-rules.ts"],
  ["Purity of Spirit", "src/lib/srd/trait-rules.ts"],
  ["Fiendish Resilience", "src/lib/srd/trait-rules.ts"],
  ["Dark One's Blessing", "src/lib/dm/feature-hooks.ts"],
  ["Stillness of Mind", "src/lib/dm/feature-hooks.ts"],
  // The final round's recount (/tmp/odm-enf2/fixes/final-engine.md): the
  // features the acknowledged list still carried though an engine holds them.
  ["Retaliation", "src/lib/dm/srd-reactions.ts"],
  ["Superior Hunter's Defense", "src/lib/dm/srd-reactions.ts"],
  ["Peerless Skill", "src/lib/dm/srd-feature-spends.ts"],
  ["Quivering Palm", "src/lib/dm/srd-feature-spends.ts"],
  ["Draconic Presence", "src/lib/dm/srd-feature-spends.ts"],
  ["Hide in Plain Sight", "src/lib/dm/srd-feature-spends.ts"],
  ["Primeval Awareness", "src/lib/dm/srd-feature-spends.ts"],
  ["Tranquility", "src/lib/dm/srd-defenses.ts"],
  ["Nature's Sanctuary", "src/lib/dm/srd-defenses.ts"],
  ["Supreme Sneak", "src/lib/srd/check-traits.ts"],
  ["Favored Enemy", "src/lib/srd/check-traits.ts"],
  ["Natural Explorer", "src/lib/srd/check-traits.ts"],
  ["Favored Enemy Improvement", "src/lib/srd/check-traits.ts"],
  ["Blessed Healer", "src/lib/dm/heal-spell.ts"],
  ["Natural Explorer Improvement", "src/lib/srd/check-traits.ts"],
  ["Multiattack", "src/lib/dm/srd-attacks.ts"],
  ["Cunning Action", "src/lib/dm/bonus-routes.ts"],
  ["Fast Hands", "src/lib/dm/bonus-routes.ts"],
  ["Vanish", "src/lib/dm/bonus-routes.ts"],
  ["Cutting Words", "src/lib/dm/reaction-tools.ts"],
  ["Deflect Missiles", "src/lib/dm/reaction-tools.ts"],
  ["Uncanny Dodge", "src/lib/dm/reaction-tools.ts"],
  ["Slow Fall", "src/lib/dm/reaction-tools.ts"],
  ["Stunning Strike", "src/lib/dm/pc-attack-options.ts"],
  ["Reckless Attack", "src/lib/dm/pc-attack-options.ts"],
  ["Frenzy", "src/lib/dm/pc-attack-options.ts"],
  ["Intimidating Presence", "src/lib/dm/combat-features.ts"],
  ["Elusive", "src/lib/dm/enemy-swing-odds.ts"],
  ["Thief's Reflexes", "src/lib/dm/encounter-logic.ts"],
  ["Feral Senses", "src/lib/dm/attack-features.ts"],
  ["Foe Slayer", "src/lib/dm/attack-features.ts"],
  ["Open Hand Technique", "src/lib/dm/attack-onhit.ts"],
  ["Land's Stride", "src/lib/battlemap/types.ts"],
  ["Second-Story Work", "src/lib/battlemap/types.ts"],
  ["Disciple of Life", "src/lib/dm/heal-spell.ts"],
  ["Supreme Healing", "src/lib/dm/heal-spell.ts"],
  ["Spell Mastery", "src/lib/dm/cast-slot-choice.ts"],
  ["Sculpt Spells", "src/lib/dm/caster-features.ts"],
  ["Empowered Evocation", "src/lib/srd/spell-damage-riders.ts"],
  ["Potent Cantrip", "src/lib/srd/spell-damage-riders.ts"],
  ["Elemental Affinity", "src/lib/srd/spell-damage-riders.ts"],
  ["Hunter's Prey", "src/lib/dm/pc-attack-options.ts"],
  ["Defensive Tactics", "src/lib/dm/opportunity.ts"],
  ["Aura Improvements", "src/lib/dm/aura.ts"],
  ["Beast Spells", "src/lib/dm/cast-rules.ts"],
  ["Archdruid", "src/lib/srd/class-resources.ts"],
  ["Dragon Wings", "src/lib/battlemap/types.ts"],
  ["Divine Intervention Improvement", "src/lib/dm/combat-features.ts"],
  // Racial traits.
  ["Fey Ancestry", "src/lib/srd/trait-rules.ts"],
  ["Fey Ancestry (adv. vs charm, immune to magical sleep)", "src/lib/srd/trait-rules.ts"],
  ["Brave (adv. vs frightened)", "src/lib/srd/trait-rules.ts"],
  ["Dwarven Resilience (adv. vs poison)", "src/lib/srd/trait-rules.ts"],
  ["Stout Resilience (adv. vs poison, resistance to poison damage)", "src/lib/srd/trait-rules.ts"],
  ["Gnome Cunning (adv. on INT/WIS/CHA saves vs magic)", "src/lib/srd/trait-rules.ts"],
  ["Constructed Resilience (no need to eat, drink or sleep; immune to disease, poison and magical sleep)", "src/lib/srd/trait-rules.ts"],
  ["Lucky (reroll nat 1 on d20)", "src/lib/srd/feature-effects.ts"],
]);

// The authored subclass layer (src/lib/srd/subclasses.json) carries one line
// of rules text per feature, which the DM prompt appends to the sheet. That
// text IS the guidance tier of coverage: the model is told exactly what the
// feature does. So an authored feature counts as covered by having text, and
// the separate test below proves every one of them actually has it.
const authoredSubclasses = JSON.parse(
  readFileSync(join(srcDir, "srd", "subclasses.json"), "utf8"),
).classes;

const AUTHORED_TEXT = new Map();
for (const [classId, entries] of Object.entries(authoredSubclasses)) {
  for (const entry of entries) {
    for (const features of Object.values(entry.levels)) {
      for (const feature of features) {
        AUTHORED_TEXT.set(`${classId}::${entry.name}::${feature.n}`, feature.d ?? "");
      }
    }
  }
}
const AUTHORED_NAMES = new Set(
  [...AUTHORED_TEXT.keys()].map((key) => key.slice(key.lastIndexOf("::") + 2)),
);

// A name the engine holds: an effect, or a counter the sheet of that class
// really gets. A fuzzy name match is not coverage ("Relentless Rage" matched
// Rage's counter and was counted while nothing enforced it).
function enforced(name, classes, racial = false) {
  if (classes.some((klass) => effectsFor({ class: klass, features: [{ name }] }).length > 0)) {
    return true;
  }
  const mods = { str: 3, dex: 3, con: 3, int: 3, wis: 3, cha: 3 };
  if (classes.some((klass) => Object.keys(populateResources([{ name, classId: klass }], 20, mods, {})).length > 0)) {
    return true;
  }
  // A racial trait names no class; its counter is found on the name alone.
  return racial && Object.keys(populateResources([{ name }], 20, mods, {})).length > 0;
}

function covered(name, classes, racial = false) {
  return enforced(name, classes, racial) || ENFORCED_ELSEWHERE.has(name) || ACKNOWLEDGED.has(name);
}

test("every SRD class feature is enforced, a resource, or acknowledged", () => {
  const uncovered = [];
  for (const table of Object.values(classFeatures)) {
    const buckets = [table.levels, ...table.subclasses.map((entry) => entry.levels)];
    for (const levels of buckets) {
      for (const names of Object.values(levels)) {
        for (const name of names) {
          if (!covered(name, ALL_CLASSES)) {
            uncovered.push(name);
          }
        }
      }
    }
  }
  assert.deepEqual(
    [...new Set(uncovered)].sort(),
    [],
    "these feature names have no effect, resource, or acknowledgement",
  );
});

test("every authored subclass feature is enforced, a resource, or carries rules text", () => {
  const uncovered = [];
  for (const [key, text] of AUTHORED_TEXT) {
    const name = key.slice(key.lastIndexOf("::") + 2);
    if (!covered(name, ALL_CLASSES) && !text.trim()) {
      uncovered.push(key);
    }
  }
  assert.deepEqual([...new Set(uncovered)].sort(), []);
});

// Rules text is not enough for a feature whose text states a number or a
// state (advantage, resistance, an immunity, dice, a bonus action, a
// reaction, AC, speed, a save): the engine must hold it. Each such authored
// feature is typed (an engine applies it: src/lib/srd/authored-effects.ts,
// or a parsed feature-effects entry), a counter, or on the narrated list
// with the reason written down. A NEW authored feature with mechanical
// wording and none of these fails here.
await (async () => {
  const { authoredCoverage } = await import("../src/lib/srd/authored-coverage.ts");
  const coverage = authoredCoverage();
  test("every authored feature that states a mechanical effect is typed, a counter, or narrated with a reason", () => {
    assert.deepEqual(coverage.uncovered, [], "give these a hook in authored-effects-data*.ts, a counter, or a narrated reason");
    assert.deepEqual(coverage.stale, [], "these authored-effects entries name no feature in subclasses.json");
    const thin = coverage.narrated.filter((entry) => entry.reason.trim().length < 20).map((entry) => entry.key);
    assert.deepEqual(thin, [], "a narrated authored feature says why in a sentence");
  });
  test("the authored narrated list holds the line: it may shrink, never grow", () => {
    // 2026-09-30: 33 narrated (8 pure roleplay or information, 6 companions
    // and summons the DM fields, 19 waiting on another engine; see
    // /tmp/odm-enf2/fixes/authored.md). The final round gave the 17 waiting
    // features their hooks (/tmp/odm-enf2/fixes/final-engine.md): 15 left,
    // 8 roleplay, 6 companions, Unstable Backlash's narrated table. Lower
    // this number as they get hooks.
    assert.ok(coverage.narrated.length <= 15, `${coverage.narrated.length} narrated authored features; the ceiling is 15`);
  });
})();

test("authored rules text is present, sane, and free of em dashes", () => {
  const problems = [];
  for (const [classId, entries] of Object.entries(authoredSubclasses)) {
    assert.ok(classFeatures[classId], `subclasses.json names an unknown class: ${classId}`);
    const seen = new Set();
    for (const entry of entries) {
      if (seen.has(entry.name.toLowerCase())) {
        problems.push(`${classId}: duplicate subclass ${entry.name}`);
      }
      seen.add(entry.name.toLowerCase());
      if (!entry.desc?.trim()) {
        problems.push(`${classId}/${entry.name}: no desc`);
      }
      if (entry.desc?.includes("—")) {
        problems.push(`${classId}/${entry.name}: em dash in desc`);
      }
      for (const [levelKey, features] of Object.entries(entry.levels)) {
        const level = Number(levelKey);
        if (!(level >= 1 && level <= 20)) {
          problems.push(`${classId}/${entry.name}: level ${levelKey} out of range`);
        }
        for (const feature of features) {
          const where = `${classId}/${entry.name}/${feature.n}`;
          if (!feature.n?.trim() || feature.n.length > 80) {
            problems.push(`${where}: bad feature name`);
          }
          if (!feature.d?.trim()) {
            problems.push(`${where}: no rules text`);
          }
          if (feature.d?.includes("—")) {
            problems.push(`${where}: em dash in rules text`);
          }
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("a subclass never picks up features before the class can choose one", () => {
  const problems = [];
  for (const [classId, entries] of Object.entries(authoredSubclasses)) {
    const pickLevel = classFeatures[classId].subclassLevel;
    for (const entry of entries) {
      for (const levelKey of Object.keys(entry.levels)) {
        if (Number(levelKey) < pickLevel) {
          problems.push(`${classId}/${entry.name}: feature at level ${levelKey} before ${pickLevel}`);
        }
      }
      for (const levelKey of Object.keys(entry.spells ?? {})) {
        if (Number(levelKey) < pickLevel) {
          problems.push(`${classId}/${entry.name}: spells at level ${levelKey} before ${pickLevel}`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("every racial trait is enforced, a resource, or acknowledged", () => {
  // Racial traits the engines already handle by race string or feature name,
  // plus the ones narrated from the sheet.
  const RACIAL_ACKNOWLEDGED = new Set([
    "Darkvision 60 ft", "Stonecunning",
    "Trance", "Halfling Nimbleness", "Naturally Stealthy",
    "Artificer's Lore", "Tinker", "Draconic Ancestry", "Damage Resistance (ancestry type)",
    "Hellish Resistance (fire)", "Infernal Legacy (thaumaturgy cantrip)",
    "Breath Weapon (2d6, DC 8 + CON mod + PB)", "+1 HP per level (Dwarven Toughness)",
    "One extra language", "One wizard cantrip", "Perception proficiency (Keen Senses)",
    "Intimidation proficiency (Menacing)", "Two skill proficiencies of your choice (Skill Versatility)",
    "Skill Versatility",
    // The authored lineages. Damage resistances and proficiency grants are
    // acknowledged for the same reason the SRD ones above are: resistance is
    // narrated, and proficiencies are applied to the sheet at creation. The
    // limited-use traits are NOT here; they are counters in
    // src/lib/srd/authored-resources.json.
    "Celestial Resistance (necrotic and radiant)", "Fire Resistance",
    "Acid Resistance", "Lightning Resistance",
    "Light Bearer (the light cantrip)",
    "Powerful Build (count as one size larger for carrying)",
    "Mountain Born (cold and altitude adapted)",
    "Athletics proficiency (Natural Athlete)", "Survival proficiency (Tortle Instinct)",
    "Perception proficiency (Cat's Talent)", "Stealth proficiency (Cat's Talent)",
    "Stealth proficiency (Sneaky)",
    "Speech of Beast and Leaf (beasts and plants understand you)",
    "Feline Agility (double your speed for a turn, refreshed by not moving)",
    "Cat's Claws (20 ft climb speed, 1d4 slashing unarmed strike)",
    "Claws (1d4 slashing unarmed strike)", "Bite (1d6 piercing unarmed strike)",
    "Expert Forgery (advantage on checks to duplicate writing and craftwork)",
    "Mimicry (reproduce any sound you have heard)",
    "Kenku Training (two skills of your choice)",
    "Changeling Instincts (two social or insight skills of your choice)",
    "Two skills from a survival list (Cunning Artisan)",
    "One skill and one tool of your choice (Specialized Design)",
    "Natural Armor (AC 17, unmodified by Dexterity)", "Natural Armor (AC 13 + DEX)",
    "Shell Defense (withdraw for +4 AC and save advantage, at the cost of movement and actions)",
    "Hold Breath (up to 1 hour)", "Hold Breath (up to 15 minutes)",
    "Unending Breath (hold your breath indefinitely)",
    "Amphibious (breathe air and water)", "30 ft swim speed",
    "Earth Walk (difficult terrain of earth or stone costs no extra movement)",
    "Shapechanger (alter your appearance as an action, no action economy cost to revert)",
    "Sentry's Rest (6 hours of inactive alertness in place of sleep)",
    "Nimble Escape (Disengage or Hide as a bonus action)",
    // The SRD subrace variants added 2026-07. Armor/weapon training and
    // skill/feat choices are applied to the sheet at creation; darkvision
    // feeds the light engine by name; the resistances parse by name too.
    "Dwarven Armor Training (light and medium armor)",
    "Dwarven Combat Training (battleaxe, handaxe, light hammer, warhammer)",
    "Elf Weapon Training (longsword, shortsword, shortbow, longbow)",
    "Fleet of Foot (35 ft speed)",
    "Mask of the Wild (hide when lightly obscured by nature)",
    "Superior Darkvision 120 ft",
    "Sunlight Sensitivity (disadvantage on attacks and sight-based Perception in direct sunlight)",
    "Drow Magic (dancing lights cantrip)",
    "Natural Illusionist (minor illusion cantrip)",
    "Speak with Small Beasts",
    "Stone Camouflage (adv. on Stealth in rocky terrain)",
    "One feat of your choice (pick it in the feats section)",
    "One skill proficiency of your choice",
    "Long-Limbed (5 extra feet of reach on melee attacks on your turn)",
    "Surprise Attack (2d6 extra damage on a surprised creature in the first round)",
  ]);
  const uncovered = [];
  for (const race of races) {
    for (const trait of race.traits) {
      if (!covered(trait, ALL_CLASSES, true) && !RACIAL_ACKNOWLEDGED.has(trait)) {
        uncovered.push(trait);
      }
    }
  }
  assert.deepEqual([...new Set(uncovered)].sort(), []);
});

test("a counter with mechanical wording carries a typed effect or is deliberately narrative", () => {
  // Narrative counters whose dice ride a FOLLOW-UP tool the model must call
  // (damage_enemy for direct damage, use_reaction for reaction riders) or
  // whose payload has no engine shape yet. Deliberate, not forgotten. A NEW
  // counter with dice in its guidance and no fx fails here until it is
  // typed in the generator/authored fx or added below with that judgement.
  const NARRATIVE_WITH_DICE = new Set([
    "cyberpunk_jury_rig", "cyberpunk_the_net_remembers",
    "dark_fantasy_immolate_the_sin", "dark_fantasy_lance_the_wound",
    "dark_fantasy_purging_flame", "dark_fantasy_the_crown_descends",
    "horror_bleeding_power",
    "post_apocalyptic_call_the_wild", "post_apocalyptic_last_ride_of_the_reaver",
    "post_apocalyptic_percussive_maintenance", "post_apocalyptic_the_pack_provides",
    "steampunk_arc_coil", "steampunk_catalyst_stone", "steampunk_field_repair",
    "steampunk_full_throttle", "steampunk_galvanic_discharge", "steampunk_gear_swarm",
    "steampunk_overcharge", "steampunk_tempest_shell", "steampunk_the_great_work_walks",
    "steampunk_vitriol_ampoule",
    "sub_warding_maneuver", "sub_call_the_hunt", "sub_searing_vengeance",
    "sub_accursed_specter", "sub_genies_vessel", "sub_favored_by_the_gods",
    "sub_violent_attraction", "sub_magic_users_nemesis",
    "race_stones_endurance",
    // 10d10 psychic after a hit: damage_enemy carries it (no save to roll).
    "hurl_through_hell",
    // Its 2d12 per spell level is rolled by the cast itself, not by a
    // use_resource fx (src/lib/dm/caster-features.ts payOverchannel).
    "overchannel",
  ]);
  const mechanical = /(\d+d\d+)|regains? \d|temporary hit points|teleport[^.]{0,30}\d+ ?(?:ft|feet)/i;
  // A counter an authored spend or reaction draws on is executed there
  // (src/lib/dm/authored-spends.ts, authored-reactions.ts), not by its fx.
  const spentByAuthored = new Set(
    AUTHORED_ROWS.flatMap((row) => [
      ...(row.entry.spends ?? []).flatMap((spend) => [spend.pool?.id, spend.pool?.fallback]),
      ...(row.entry.reactions ?? []).map((reaction) => (reaction.pool && "id" in reaction.pool ? reaction.pool.id : undefined)),
    ]).filter(Boolean),
  );
  const offenders = RESOURCE_DEFS.filter(
    (def) =>
      def.effect.kind === "narrative" &&
      mechanical.test(def.guidance) &&
      !NARRATIVE_WITH_DICE.has(def.id) &&
      !spentByAuthored.has(def.id),
  ).map((def) => def.id);
  assert.deepEqual(
    offenders,
    [],
    "these counters state dice but execute nothing; give them an fx or acknowledge them",
  );
  // And the allowlist must not rot.
  const known = new Set(RESOURCE_DEFS.map((def) => def.id));
  const stale = [...NARRATIVE_WITH_DICE].filter((id) => !known.has(id));
  assert.deepEqual(stale, [], "NARRATIVE_WITH_DICE names unknown counters");
});

test("the acknowledged set lists only narrated features: nothing the engine enforces", () => {
  const enforcedNames = [...ACKNOWLEDGED].filter(
    (name) => name !== "Unarmored Defense" && (enforced(name, ALL_CLASSES) || ENFORCED_ELSEWHERE.has(name)),
  );
  assert.deepEqual(enforcedNames, [], "these are enforced; take them off the acknowledged list");
});

test("every feature enforced elsewhere is named in the file that enforces it", () => {
  const missing = [];
  for (const [name, file] of ENFORCED_ELSEWHERE) {
    const text = readFileSync(join(srcDir, "..", "..", file), "utf8").toLowerCase();
    const key = name.replace(/\s*\(.*$/, "").toLowerCase();
    if (!text.includes(key)) {
      missing.push(`${name} (${file})`);
    }
  }
  assert.deepEqual(missing, []);
});

test("the acknowledged set does not rot: every entry is a real granted name", () => {
  const granted = new Set(AUTHORED_NAMES);
  for (const table of Object.values(classFeatures)) {
    for (const levels of [table.levels, ...table.subclasses.map((entry) => entry.levels)]) {
      for (const names of Object.values(levels)) {
        names.forEach((name) => granted.add(name));
      }
    }
  }
  const stale = [...ACKNOWLEDGED].filter(
    (name) => !granted.has(name) && !matchResource(name),
  );
  // A handful of acknowledged names are defensive (features from books not
  // in the SRD table yet); allow them but flag if the list grows careless.
  assert.ok(stale.length <= 3, `acknowledged set has stale entries: ${stale.join(", ")}`);
});

console.log(`test-feature-coverage: ${passed} passed`);
