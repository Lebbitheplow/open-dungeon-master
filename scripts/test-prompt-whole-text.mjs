// Issue #429: what the table writes for the DM reaches it whole. A
// backstory used to arrive as its first 400 characters of the 2,000 its box
// takes, and party and prep notes as their first 300, with nothing said.
// Whole now; a compact call (a small window) and a notes list past its share
// keep the start of each, cut at a word, and say it was cut.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

// buildGameStateBlock reads the scene tracker off the campaign row, so the
// prompt needs a database: a throwaway encrypted one.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-whole-text-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { buildGameStateBlock, cutForRoom, fitNoteBodies } = await import("../src/lib/dm/prompt.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

function makeSheet(overrides = {}) {
  return {
    id: "sheet-1",
    campaignId: "camp-1",
    userId: "user-1",
    libraryCharacterId: null,
    name: "Liriel",
    race: "high_elf",
    class: "cleric",
    subclass: "",
    background: "acolyte",
    alignment: "NG",
    level: 1,
    xp: 0,
    abilities: { str: 10, dex: 12, con: 14, int: 10, wis: 16, cha: 10 },
    maxHp: 10,
    currentHp: 10,
    tempHp: 0,
    ac: 16,
    speed: 30,
    hitDice: { die: "d8", total: 1, spent: 0 },
    proficiencies: { saves: ["wis", "cha"], skills: [], languages: [], tools: [], armor: [], weapons: [] },
    equipment: [],
    gold: 15,
    feats: [],
    spellcasting: null,
    conditions: [],
    portrait: null,
    notes: "",
    backstory: "",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

function makeState(extra = {}) {
  return {
    campaign: {
      id: "camp-1",
      title: "Test Campaign",
      description: "",
      difficulty: "normal",
      theme: "",
      scene: "",
      questLog: [],
      dmOutline: "",
      storyArc: null,
      gameSettings: { genre: "high_fantasy", customGenreText: "", tableLanguage: "english", aiStorySetup: true, dicePolicy: "digital_only" },
    },
    members: [{ userId: "user-1", username: "smoebo", role: "owner", ready: true, joinedAt: "2026-01-01" }],
    sheets: [makeSheet()],
    recentRolls: [],
    storySummary: "",
    ...extra,
  };
}

// A backstory whose one plot-bearing fact sits at its very end, as the
// issue's example has it: the god, the rival, the lost sibling.
const filler = "She kept the night vigil at the shrine on the hill and tended the lamps. ".repeat(24);
const backstory = `${filler}She serves an unnamed moon goddess, and her sister vanished on the night of the eclipse.`;

test("the whole backstory reaches the DM, its last line included", () => {
  assert.ok(backstory.length > 1800 && backstory.length <= 2000);
  const block = buildGameStateBlock(makeState({ sheets: [makeSheet({ backstory })] }));
  assert.ok(block.includes("an unnamed moon goddess, and her sister vanished on the night of the eclipse."));
  assert.equal(block.includes("(cut for room)"), false);
});

test("a compact call keeps the start and says it was cut", () => {
  const ruleContext = { inEncounter: false, groups: new Set(), caster: false, features: false, classFeatures: false, featSpells: false, dying: false, arc: false, recall: false, map: false, legendary: false, classes: null };
  const block = buildGameStateBlock(makeState({ sheets: [makeSheet({ backstory })], ruleContext }));
  const line = block.split("\n").find((entry) => entry.includes("Backstory:"));
  assert.ok(line.endsWith("... (cut for room)"));
  assert.equal(line.includes("moon goddess"), false);
  // Cut at a word, never through one: what stands before the dots is a
  // whole word of the text.
  const kept = line.slice(line.indexOf("Backstory:") + "Backstory: ".length, -"... (cut for room)".length);
  assert.ok(backstory.startsWith(kept) && /\s/.test(backstory[kept.length]));
});

test("cutForRoom leaves a short text alone and cuts a long one at a word", () => {
  assert.equal(cutForRoom("short", 10), "short");
  assert.equal(cutForRoom("one two three four", 9), "one two... (cut for room)");
});

test("notes ride whole until the list's share is spent", () => {
  const long = (word) => `${word} `.repeat(300).trim();
  const notes = [
    { body: "A short canon note." },
    { body: long("alpha") },
    { body: long("beta") },
    { body: long("gamma") },
  ];
  const bodies = fitNoteBodies(notes, false);
  assert.equal(bodies[0], "A short canon note.");
  assert.equal(bodies[1], notes[1].body);
  // Past the share each note keeps a start of at least the old 300.
  assert.ok(bodies.some((body) => body.endsWith("(cut for room)")));
  for (const body of bodies) {
    assert.ok(body.length >= 19);
  }
  const total = bodies.reduce((sum, body) => sum + body.length, 0);
  assert.ok(total < notes.reduce((sum, note) => sum + note.body.length, 0));
});

test("a compact call keeps each note's start", () => {
  const bodies = fitNoteBodies([{ body: "word ".repeat(200) }], true);
  assert.ok(bodies[0].length < 330 && bodies[0].endsWith("(cut for room)"));
});

test("a party note's secret at the end of a long note reaches the DM", () => {
  const body = `${"The ferryman takes coin and asks nothing. ".repeat(12)}He is the duke's brother in hiding.`;
  assert.ok(body.length > 300);
  const block = buildGameStateBlock(
    makeState({
      publicNotes: [{ pinned: true, title: "The ferry", body }],
      dmPrepNotes: [{ title: "Secret", body }],
    }),
  );
  assert.equal(block.split("He is the duke's brother in hiding.").length - 1, 2);
});

console.log(`test-prompt-whole-text: ${passed} tests passed.`);
