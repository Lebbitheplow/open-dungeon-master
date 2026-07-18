// Real-dice awareness in the DM prompt: the PHYSICAL dice marker and the
// conditional system rule appear only for opted-in players on real_allowed
// tables.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { buildGameStateBlock, buildDmMessages, REAL_DICE_RULE } = await import(
  "../src/lib/dm/prompt.ts"
);

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
    name: "Testa",
    race: "human",
    class: "fighter",
    subclass: "",
    background: "",
    alignment: "",
    level: 1,
    xp: 0,
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
    maxHp: 12,
    currentHp: 12,
    tempHp: 0,
    ac: 16,
    speed: 30,
    hitDice: { die: "d10", total: 1, spent: 0 },
    proficiencies: { saves: ["str", "con"], skills: [], languages: [], tools: [], armor: [], weapons: [] },
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

function makeState({ dicePolicy = "digital_only", useRealDice = false } = {}) {
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
      gameSettings: {
        genre: "high_fantasy",
        customGenreText: "",
        aiStorySetup: true,
        dicePolicy,
        ttsEnabled: false,
        ttsVoice: "af_heart",
        mapsEnabled: false,
        midGameJoinOpen: false,
        holdSubmissions: false,
      },
    },
    members: [
      {
        userId: "user-1",
        username: "kaleb",
        role: "owner",
        ready: true,
        useRealDice,
        joinedAt: "2026-01-01",
      },
    ],
    sheets: [makeSheet()],
    recentRolls: [],
    storySummary: "",
  };
}

test("digital-only table gets no marker and no rule", () => {
  const state = makeState();
  assert.equal(buildGameStateBlock(state).includes("PHYSICAL dice"), false);
  const system = buildDmMessages(state, [])[0].content;
  assert.equal(system.includes(REAL_DICE_RULE), false);
});

test("real_allowed without opt-in gets no marker and no rule", () => {
  const state = makeState({ dicePolicy: "real_allowed" });
  assert.equal(buildGameStateBlock(state).includes("PHYSICAL dice"), false);
  assert.equal(buildDmMessages(state, [])[0].content.includes(REAL_DICE_RULE), false);
});

test("opted-in player on a real_allowed table gets marker and rule", () => {
  const state = makeState({ dicePolicy: "real_allowed", useRealDice: true });
  assert.equal(buildGameStateBlock(state).includes("(rolls PHYSICAL dice)"), true);
  assert.equal(buildDmMessages(state, [])[0].content.includes(REAL_DICE_RULE), true);
});

test("opt-in is ignored when the campaign is digital_only", () => {
  const state = makeState({ dicePolicy: "digital_only", useRealDice: true });
  assert.equal(buildGameStateBlock(state).includes("PHYSICAL dice"), false);
  assert.equal(buildDmMessages(state, [])[0].content.includes(REAL_DICE_RULE), false);
});

test("rule attaches only when a present sheet belongs to a real-dice player", () => {
  const state = makeState({ dicePolicy: "real_allowed", useRealDice: true });
  state.sheets = [makeSheet({ userId: "someone-else" })];
  assert.equal(buildDmMessages(state, [])[0].content.includes(REAL_DICE_RULE), false);
});

console.log(`test-real-dice-prompt: ${passed} tests passed.`);
