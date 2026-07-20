// The safety net: every feature name that can reach a character sheet is
// accounted for. A name is covered when it has a server-enforced effect, a
// resource counter, OR is listed in the acknowledged guidance-only set
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
const { matchResource } = await import("../src/lib/srd/class-resources.ts");

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
  "Signature Spells", "Spell Mastery", "Bonus Cantrip", "Beast Spells",
  "Mystic Arcanum (6th level)", "Mystic Arcanum (7th level)",
  "Mystic Arcanum (8th level)", "Mystic Arcanum (9th level)",
  "Metamagic", "Metamagic Option", "Eldritch Invocations",
  "Sculpt Spells", "Empowered Evocation", "Evocation Savant",
  "Potent Cantrip", "Overchannel", "Elemental Affinity",
  // Proficiency and skill grants (applied to the sheet at pick time).
  "Expertise", "Jack of All Trades", "Remarkable Athlete",
  "Bonus Proficiencies (Lore)", "Bonus Proficiency (heavy armor)",
  "Druidic", "Thieves' Cant", "Additional Fighting Style", "Fighting Style",
  // Passive / roleplay / exploration features the DM narrates.
  "Aura of Courage", "Aura of Devotion", "Aura Improvements",
  "Draconic Presence", "Dragon Wings", "Draconic Resilience",
  "Divine Health", "Divine Domain", "Divine Intervention",
  "Divine Intervention Improvement", "Divine Strike", "Blessed Healer",
  "Disciple of Life", "Cleansing Touch", "Holy Nimbus", "Improved Divine Smite",
  "Blindsense", "Cunning Action", "Cutting Words", "Countercharm",
  "Fast Hands", "Second-Story Work", "Supreme Sneak", "Use Magic Device",
  "Slippery Mind", "Elusive", "Stroke of Luck", "Thief's Reflexes",
  "Dark One's Blessing", "Dark One's Own Luck", "Fiendish Resilience",
  "Hurl Through Hell", "Eldritch Master",
  "Danger Sense", "Feral Instinct", "Frenzy", "Intimidating Presence",
  "Reckless Attack", "Retaliation", "Primal Champion", "Indomitable Might",
  "Favored Enemy", "Favored Enemy Improvement", "Natural Explorer",
  "Natural Explorer Improvement", "Hunter's Prey", "Defensive Tactics",
  "Superior Hunter's Defense", "Feral Senses", "Foe Slayer", "Primeval Awareness",
  "Land's Stride", "Hide in Plain Sight", "Nature's Sanctuary", "Nature's Ward",
  "Archdruid", "Timeless Body",
  "Deflect Missiles", "Diamond Soul", "Empty Body", "Open Hand Technique",
  "Perfect Self", "Purity of Body", "Quivering Palm", "Slow Fall",
  "Stillness of Mind", "Stunning Strike", "Tongue of the Sun and Moon",
  "Tranquility", "Wholeness of Body", "Ki-Empowered Strikes", "Purity of Spirit",
  "Destroy Undead (CR 1/2)", "Destroy Undead (CR 1)", "Destroy Undead (CR 2)",
  "Destroy Undead (CR 3)", "Destroy Undead (CR 4)",
  "Indomitable (1 use)", "Indomitable (2 uses)", "Indomitable (3 uses)",
  "Peerless Skill", "Superior Inspiration", "Font of Inspiration",
  "Sorcerous Restoration", "Supreme Healing", "Multiattack",
  "Reliable Talent", "Uncanny Dodge",
  // Unarmored Defense IS enforced, via the AC engine (src/lib/srd/armor.ts
  // unarmoredFormulaFor), not the effectsFor table, so it reads as
  // acknowledged here.
  "Unarmored Defense", "Survivor",
]);

function covered(name, classes) {
  if (classes.some((klass) => effectsFor({ class: klass, features: [{ name }] }).length > 0)) {
    return true;
  }
  if (matchResource(name)) {
    return true;
  }
  return ACKNOWLEDGED.has(name);
}

test("every SRD class feature is enforced, a resource, or acknowledged", () => {
  const uncovered = [];
  for (const table of Object.values(classFeatures)) {
    const buckets = [table.levels, table.subclass.levels];
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

test("every racial trait is enforced, a resource, or acknowledged", () => {
  // Racial traits the engines already handle by race string or feature name,
  // plus the ones narrated from the sheet.
  const RACIAL_ACKNOWLEDGED = new Set([
    "Darkvision 60 ft", "Fey Ancestry", "Fey Ancestry (adv. vs charm, immune to magical sleep)",
    "Brave (adv. vs frightened)", "Dwarven Resilience (adv. vs poison)",
    "Gnome Cunning (adv. on INT/WIS/CHA saves vs magic)", "Stonecunning",
    "Trance", "Halfling Nimbleness", "Naturally Stealthy", "Lucky (reroll nat 1 on d20)",
    "Artificer's Lore", "Tinker", "Draconic Ancestry", "Damage Resistance (ancestry type)",
    "Hellish Resistance (fire)", "Infernal Legacy (thaumaturgy cantrip)",
    "Breath Weapon (2d6, DC 8 + CON mod + PB)", "+1 HP per level (Dwarven Toughness)",
    "One extra language", "One wizard cantrip", "Perception proficiency (Keen Senses)",
    "Intimidation proficiency (Menacing)", "Two skill proficiencies of your choice (Skill Versatility)",
    "Skill Versatility",
  ]);
  const uncovered = [];
  for (const race of races) {
    for (const trait of race.traits) {
      if (!covered(trait, ALL_CLASSES) && !RACIAL_ACKNOWLEDGED.has(trait)) {
        uncovered.push(trait);
      }
    }
  }
  assert.deepEqual([...new Set(uncovered)].sort(), []);
});

test("the acknowledged set does not rot: every entry is a real granted name", () => {
  const granted = new Set();
  for (const table of Object.values(classFeatures)) {
    for (const levels of [table.levels, table.subclass.levels]) {
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
