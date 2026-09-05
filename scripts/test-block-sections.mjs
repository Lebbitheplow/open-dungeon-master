// The printed half of a stat block: sections a trait line can wear, the
// lines the block carries beyond its attacks, and the fields the draft
// checker keeps. See docs/workshop-parity-audit.md phase 12.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  TRAIT_SECTIONS,
  SECTION_LABELS,
  abilityLine,
  extraBlockLines,
  groupTraits,
  sectionOfLine,
  senseTiles,
  withSection,
} = await import("../src/lib/bestiary/block-sections.ts");
const { checkMonsterDraft, draftFromCr } = await import("../src/lib/bestiary/monster-draft.ts");
const { parseMonster, passivePerceptionFor } = await import("../src/lib/bestiary/statblock.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("a line's section is read from its prefix and a trait wears none", () => {
  assert.deepEqual(sectionOfLine("Legendary action: Wing Attack. It beats its wings."), {
    section: "legendary",
    text: "Wing Attack. It beats its wings.",
  });
  assert.deepEqual(sectionOfLine("Lair Action - The floor shakes."), { section: "lair", text: "The floor shakes." });
  assert.deepEqual(sectionOfLine("Reaction: Parry."), { section: "reaction", text: "Parry." });
  assert.deepEqual(sectionOfLine("Bonus: Nimble Escape."), { section: "bonus", text: "Nimble Escape." });
  assert.deepEqual(sectionOfLine("Keen Smell. Advantage on smell checks."), {
    section: "trait",
    text: "Keen Smell. Advantage on smell checks.",
  });
  for (const section of TRAIT_SECTIONS) {
    assert.ok(SECTION_LABELS[section]);
    const line = withSection("Do the thing.", section);
    assert.equal(sectionOfLine(line).section, section);
    assert.equal(sectionOfLine(line).text, "Do the thing.");
  }
  assert.equal(withSection("Legendary action: Bite.", "trait"), "Bite.");
});

test("traits group by section in printed order and blank lines vanish", () => {
  const groups = groupTraits([
    "Lair action: Tremor.",
    "Keen Smell.",
    "",
    "Legendary action: Bite.",
    "Action: Multiattack.",
    "Pack Tactics.",
  ]);
  assert.deepEqual(
    groups.map((group) => group.section),
    ["trait", "action", "legendary", "lair"],
  );
  assert.deepEqual(groups[0].lines, ["Keen Smell.", "Pack Tactics."]);
});

test("the extra lines print only what the block says", () => {
  assert.deepEqual(extraBlockLines({}), []);
  const lines = extraBlockLines({
    abilities: { str: 18, dex: 12 },
    skills: { perception: 5, stealth: 6 },
    senses: { darkvision: 60, passivePerception: 15 },
    languages: "Common, Giant",
    alignment: "chaotic evil",
    spells: ["Fireball", "Shield"],
  });
  assert.equal(lines[0], "STR 18 (+4), DEX 12 (+1)");
  assert.equal(lines[1], "Skills: perception +5, stealth +6");
  assert.equal(lines[2], "Senses: darkvision 60 ft, passive Perception 15");
  assert.equal(lines[3], "Languages: Common, Giant");
  assert.equal(lines[4], "Alignment: chaotic evil");
  assert.equal(lines[5], "Spells known: Fireball, Shield");
  assert.equal(abilityLine({ abilities: { wis: 7 } }), "WIS 7 (-2)");
  assert.equal(senseTiles({ senses: { darkvision: 60, blindsight: 10 } }), 12);
  assert.equal(senseTiles({}), 0);
});

test("the draft checker keeps the printed fields and drops what it cannot read", () => {
  const base = draftFromCr("Reed Stalker", 2);
  const checked = checkMonsterDraft({
    name: base.name,
    ...base.stats,
    abilities: { str: 16, dex: "14", con: 12, luck: 20 },
    skills: { Perception: 4, stealth: 6, nonsense: "high" },
    senses: { darkvision: 60, tremorsense: 0, passivePerception: 14 },
    languages: "Common",
    alignment: "neutral",
    spells: ["Entangle", "Entangle", ""],
    environment: ["Swamp", "forest"],
  });
  assert.ok(!("error" in checked), checked.error);
  const stats = checked.draft.stats;
  assert.deepEqual(stats.abilities, { str: 16, con: 12 });
  assert.deepEqual(stats.skills, { perception: 4, stealth: 6 });
  assert.deepEqual(stats.senses, { darkvision: 60, passivePerception: 14 });
  assert.equal(stats.languages, "Common");
  assert.deepEqual(stats.spells, ["Entangle"]);
  assert.deepEqual(stats.environment, ["swamp", "forest"]);
  // A block that says nothing gains nothing.
  const plain = checkMonsterDraft({ name: "Plain", ...base.stats });
  assert.ok(!("error" in plain));
  assert.equal(plain.draft.stats.abilities, undefined);
  assert.equal(plain.draft.stats.senses, undefined);
});

test("passive Perception prefers the printed number, then the skill, then Wisdom", () => {
  const base = draftFromCr("Watcher", 1).stats;
  const wis = passivePerceptionFor({ ...base, saveMods: { ...base.saveMods, wis: 2 } });
  assert.equal(wis, 12);
  assert.equal(passivePerceptionFor({ ...base, skills: { perception: 5 } }), 15);
  assert.equal(passivePerceptionFor({ ...base, skills: { perception: 5 }, senses: { passivePerception: 18 } }), 18);
});

test("an Open5e block arrives with its scores, skills and senses", () => {
  const stats = parseMonster(
    {
      armor_class: 13,
      hit_points: 22,
      strength: 16,
      dexterity: 14,
      constitution: 12,
      intelligence: 8,
      wisdom: 13,
      charisma: 7,
      skills: { perception: 3, stealth: 4 },
      senses: "darkvision 60 ft., passive Perception 13",
      languages: "Common, Goblin",
      alignment: "neutral evil",
      speed: { walk: 30 },
      actions: [],
      special_abilities: [],
      cr: 1,
      type: "humanoid",
    },
    1,
  );
  assert.deepEqual(stats.abilities, { str: 16, dex: 14, con: 12, int: 8, wis: 13, cha: 7 });
  assert.deepEqual(stats.skills, { perception: 3, stealth: 4 });
  assert.deepEqual(stats.senses, { darkvision: 60, passivePerception: 13 });
  assert.equal(stats.languages, "Common, Goblin");
  assert.equal(stats.alignment, "neutral evil");
  assert.equal(passivePerceptionFor(stats), 13);
});

console.log(`test-block-sections: ${passed} passed`);
