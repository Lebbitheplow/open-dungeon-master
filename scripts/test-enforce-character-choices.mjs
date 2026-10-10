// What a character's class lets them choose, and what it raises
// (docs/dnd-rules-audit-2026-10-09-extent.md, F11, F23, F24, F25, N20):
//
//   - Rogue Expertise (SRD 5.1): "two of your skill proficiencies, or one of
//     your skill proficiencies and your proficiency with thieves' tools". At
//     6th level too.
//   - The Artificer's Magic Item Adept, Savant and Master raise the number of
//     attuned items to four, five and six; Tool Expertise doubles every tool.
//   - Choices a level owes and the player has not made are shown as owed.
//   - A subclass's always-prepared spell is cast at its own class's DC.
import assert from "node:assert/strict";
import { openTable, scores } from "./lib/enforce-multiclass.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-character-choices");
const table = await openTable();
const { attunementSlotsFor } = await import("../src/lib/srd/armor.ts");
const { toolProficiencyBonus } = await import("../src/lib/dm/roll-riders.ts");
const { owedChoices } = await import("../src/lib/srd/owed-choices.ts");
const { withAsiLedger } = await import("../src/lib/srd/asi-ledger.ts");
const { spellSaveDcFor } = await import("../src/lib/srd/index.ts");

const PROF = { saves: [], skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: [] };

await test("A rogue's 6th-level expertise may take thieves' tools, and the tool check doubles.", async () => {
  table.hero({
    class: "rogue", level: 5, abilities: scores({ dex: 16 }),
    proficiencies: { ...PROF, skills: ["stealth", "perception", "acrobatics", "insight"], expertise: ["stealth", "perception"], tools: ["thieves' tools"] },
  });
  const out = await table.levelUp("rogue", { expertise: ["stealth", "perception", "acrobatics", "thieves' tools"] });
  assert.equal(out.status, 200, out.error);
  assert.ok(table.now().proficiencies.expertise.includes("thieves' tools"));
  const bonus = toolProficiencyBonus(table.now(), "thieves' tools", 3);
  assert.equal(bonus.bonus, 6, "expertise with thieves' tools doubles the bonus");
});

await test("A bard's expertise is skills only: thieves' tools are refused.", async () => {
  table.hero({
    class: "bard", level: 2, abilities: scores({ cha: 16 }),
    proficiencies: { ...PROF, skills: ["performance", "persuasion"], tools: ["thieves' tools"] },
  });
  await table.assertRefused({ level: 3, levelUpClass: "bard", expertise: ["performance", "thieves' tools"] }, "bard thieves' tools");
});

test("An Artificer attunes to four items at 10th level, five at 14th, six at 18th; Tool Expertise from 6th", () => {
  assert.equal(attunementSlotsFor({ class: "artificer", level: 9 }), 3);
  assert.equal(attunementSlotsFor({ class: "artificer", level: 10 }), 4);
  assert.equal(attunementSlotsFor({ class: "artificer", level: 14 }), 5);
  assert.equal(attunementSlotsFor({ class: "artificer", level: 18 }), 6);
  assert.equal(attunementSlotsFor({ class: "wizard", level: 18 }), 3);
  assert.equal(attunementSlotsFor({ class: "fighter", level: 12, classes: [{ id: "fighter", level: 2 }, { id: "artificer", level: 10 }] }), 4);
  const tinker = { class: "artificer", level: 6, proficiencies: { ...PROF, tools: ["tinker's tools"] } };
  assert.equal(toolProficiencyBonus(tinker, "tinker's tools", 3).bonus, 6);
});

test("Choices a level owes and the player has not made are named as owed", () => {
  // A sheet that keeps the improvements ledger, none taken yet.
  const owed = owedChoices({
    class: "fighter", subclass: "", level: 4, classes: [], features: [withAsiLedger([], 0)[0]],
    proficiencies: { ...PROF, skills: ["athletics"] },
  });
  assert.ok(owed.some((line) => /Ability Score Improvement/.test(line)), owed.join("; "));
  assert.ok(owed.some((line) => /subclass for fighter/.test(line)), owed.join("; "));
  const rogue = owedChoices({ class: "rogue", subclass: "Thief", level: 1, classes: [], features: [], proficiencies: { ...PROF, skills: ["stealth"], tools: ["thieves' tools"] } });
  assert.ok(rogue.some((line) => /expertise in 2 more/.test(line)), rogue.join("; "));
});

test("A cleric's domain spell on a wizard-cleric is cast at the cleric's DC", () => {
  const sheet = {
    name: "Iri", class: "wizard", level: 6, subclass: "", race: "human",
    classes: [{ id: "wizard", level: 3, subclass: "" }, { id: "cleric", level: 3, subclass: "Life Domain" }],
    abilities: scores({ int: 18, wis: 12 }), features: [], feats: [], equipment: [], conditions: [], conditionMeta: {},
    proficiencies: PROF,
    spellcasting: {
      ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Magic Missile"], known: [], cantrips: [],
      casters: [
        { classId: "wizard", ability: "int", known: [], prepared: ["Magic Missile"], cantrips: [] },
        { classId: "cleric", ability: "wis", known: [], prepared: ["Bless"], cantrips: [] },
      ],
    },
  };
  // Proficiency +3: 8 + 3 + INT 18's 4 is 15, 8 + 3 + WIS 12's 1 is 12.
  assert.equal(spellSaveDcFor(sheet, "Magic Missile"), 15);
  assert.equal(spellSaveDcFor(sheet, "Bless"), 12);
  assert.equal(spellSaveDcFor(sheet, "Spiritual Weapon"), 12, "a Life Domain spell is the cleric's");
});

test("A ritual read from a cleric-wizard's book, prepared or not, is cast at the wizard's DC", () => {
  const sheet = {
    name: "Oda", class: "cleric", level: 6, subclass: "", race: "human",
    classes: [{ id: "cleric", level: 3, subclass: "" }, { id: "wizard", level: 3, subclass: "" }],
    abilities: scores({ int: 18, wis: 12 }), features: [], feats: [], equipment: [], conditions: [], conditionMeta: {},
    proficiencies: PROF,
    spellcasting: {
      ability: "wis", slots: { 1: { max: 4, used: 0 } }, prepared: ["Bless"], known: [], cantrips: [], spellbook: ["Alarm"],
      casters: [
        { classId: "cleric", ability: "wis", known: [], prepared: ["Bless"], cantrips: [] },
        { classId: "wizard", ability: "int", known: [], prepared: [], cantrips: [], spellbook: ["Alarm"] },
      ],
    },
  };
  assert.equal(spellSaveDcFor(sheet, "Alarm"), 15, "the book's owner, INT 18");
  assert.equal(spellSaveDcFor(sheet, "Bless"), 12);
});

table.world.close();
finish();
