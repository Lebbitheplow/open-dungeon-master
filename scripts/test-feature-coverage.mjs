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
const { matchResource, RESOURCE_DEFS } = await import("../src/lib/srd/class-resources.ts");

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
  // Jack of All Trades and Remarkable Athlete moved to feature-effects.ts
  // (half_proficiency riders) and are enforced now.
  "Expertise",
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
  // Artificer. The specialist marker and the tool/attunement perks are
  // narrated from the sheet, exactly like the other subclass markers and
  // proficiency grants above. "Infuse Item" is the gateway to a real pick
  // list (src/lib/srd/options.json), and the infusions themselves carry the
  // mechanics; the feature naming the list does not.
  "Artificer Specialist", "Infuse Item", "Magical Tinkering", "Tool Expertise",
  "Magic Item Adept", "Magic Item Savant", "Magic Item Master",
  "Spell-Storing Item", "Soul of Artifice",
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
    "Constructed Resilience (no need to eat, drink or sleep; immune to disease, poison and magical sleep)",
    "Sentry's Rest (6 hours of inactive alertness in place of sleep)",
    "Nimble Escape (Disengage or Hide as a bonus action)",
    // The SRD subrace variants added 2026-07. Armor/weapon training and
    // skill/feat choices are applied to the sheet at creation; darkvision
    // feeds the light engine by name; the resistances parse by name too.
    "Dwarven Armor Training (light and medium armor)",
    "Fleet of Foot (35 ft speed)",
    "Mask of the Wild (hide when lightly obscured by nature)",
    "Superior Darkvision 120 ft",
    "Sunlight Sensitivity (disadvantage on attacks and sight-based Perception in direct sunlight)",
    "Drow Magic (dancing lights cantrip)",
    "Stout Resilience (adv. vs poison, resistance to poison damage)",
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
      if (!covered(trait, ALL_CLASSES) && !RACIAL_ACKNOWLEDGED.has(trait)) {
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
    "race_stones_endurance", "art_arcane_jolt",
  ]);
  const mechanical = /(\d+d\d+)|regains? \d|temporary hit points|teleport[^.]{0,30}\d+ ?(?:ft|feet)/i;
  const offenders = RESOURCE_DEFS.filter(
    (def) =>
      def.effect.kind === "narrative" &&
      mechanical.test(def.guidance) &&
      !NARRATIVE_WITH_DICE.has(def.id),
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
