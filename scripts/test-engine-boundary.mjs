// The engine-boundary contract and the guard's ruling.
//
// The narration is read by a model in the table's language (src/lib/dm/
// claims.ts), which returns what it states as claims; the reading of hedges,
// quoted dialogue, negation, metaphor and attempts is that reader's job and
// is measured against a real model (the rule-10 evidence), not here. What is
// pinned here, deterministically, is everything after it: the turn's ground
// truth read from its tool results, and the ruling on which claims contradict
// it. The ruling is biased toward false negatives exactly as before:
// ambiguous creatures, mixed swings and any number the engine produced are
// never contradicted.
import assert from "node:assert/strict";

const {
  ENGINE_BOUNDARY_RULES,
  ENGINE_BOUNDARY_CHECK,
  FAKE_ENCOUNTER_PROMPT,
  buildCorrectionPrompt,
  collectExchanges,
  fightAnnounced,
  guardOutcomes,
  normalizeCreatureName,
  resolveOutcomes,
  ruleClaims,
  unrolledFigure,
} = await import("../src/lib/dm/engine-boundary.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// One assistant message carrying every tool call, then one tool result each,
// exactly as src/lib/dm/turn.ts assembles a turn's conversation.
function conversationOf(calls) {
  const toolCalls = calls.map((call, index) => ({
    id: `call-${index}`,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
  }));
  return [
    { role: "system", content: "system prompt" },
    { role: "user", content: "[Kara | attempt] I swing at the goblin." },
    { role: "assistant", content: "", tool_calls: toolCalls },
    ...calls.map((call, index) => ({
      role: "tool",
      tool_call_id: `call-${index}`,
      content: JSON.stringify(call.result ?? { ok: true }),
    })),
  ];
}

// The ruling on what a reader claimed, against these calls' results.
function rule(claims, calls, live = null) {
  return ruleClaims(claims, guardOutcomes(conversationOf(calls), live));
}

// Claims as the reader returns them once checked (src/lib/dm/claims-logic.ts).
const about = (kind, target, quote = `${kind} ${target}`) => ({ kind, target, quote });
const amount = (value, of = "damage") => ({ kind: "amount", value, of, quote: `${value} ${of}` });
const cast = (caster, spell) => ({ kind: "cast", caster, spell, quote: `${caster} casts ${spell}` });

const kinds = (found) => found.map((entry) => entry.kind).sort();

// Realistic result payloads, shaped exactly like the engines produce them.
const attackMissed = {
  name: "pc_attack",
  args: { characterId: "c1", targetEnemyId: "e1", weapon: "longsword" },
  result: {
    attacker: "Kara",
    weapon: "longsword",
    rolled: 9,
    vsAc: 15,
    target: "Goblin 1",
    hit: false,
    note: "The attack misses; narrate the miss.",
  },
};
const attackHit = {
  name: "pc_attack",
  args: { characterId: "c1", targetEnemyId: "e1", weapon: "longsword" },
  result: {
    attacker: "Kara",
    weapon: "longsword",
    rolled: 17,
    vsAc: 15,
    target: "Goblin 1",
    hit: true,
    damage: 6,
    damageType: "slashing",
    ok: true,
    name: "Goblin 1",
    hp: "3/9",
    health: "badly wounded",
    note: "The server already applied this damage to Goblin 1.",
  },
};
const ogreWounded = {
  name: "damage_enemy",
  args: { enemyId: "e2", amount: 12 },
  result: { ok: true, name: "Ogre", hp: "47/59", health: "wounded" },
};
const ogreSlain = {
  name: "damage_enemy",
  args: { enemyId: "e2", amount: 60 },
  result: { ok: true, name: "Ogre", hp: "0/59", health: "slain", dead: true },
};
const enemyHitKara = {
  name: "enemy_attack",
  args: { enemyId: "e1", targetCharacterId: "c1" },
  result: {
    attack: "Scimitar",
    vsAc: 16,
    target: "Kara",
    swings: [{ rolled: 18, hit: true, damage: 5 }],
    hit: true,
    totalDamage: 5,
    damageType: "slashing",
    targetHp: "9/24",
  },
};

// ---------------------------------------------------------------------------
// Part 1: the contract block
// ---------------------------------------------------------------------------

test("the contract names every engine-owned fact family", () => {
  for (const owned of [
    "Dice outcomes",
    "Hit and miss",
    "Damage numbers",
    "HP and death",
    "Spell slots and resources",
    "Conditions and durations",
    "XP and level",
    "Gold and inventory",
  ]) {
    assert.ok(ENGINE_BOUNDARY_RULES.includes(owned), `contract is missing "${owned}"`);
  }
  assert.ok(ENGINE_BOUNDARY_RULES.startsWith("ENGINE BOUNDARY"));
});

test("the contract carries no em dashes and promises the check separately", () => {
  assert.ok(!ENGINE_BOUNDARY_RULES.includes("—"));
  assert.ok(!ENGINE_BOUNDARY_CHECK.includes("—"));
  // The promise that the server verifies the prose lives apart from the
  // contract so a table with the guard off is never told a lie.
  assert.ok(!ENGINE_BOUNDARY_RULES.includes("compares your finished narration"));
  assert.ok(ENGINE_BOUNDARY_CHECK.includes("compares your finished narration"));
});

test("the correction prompt states the truth, the wrong clause, and no tools", () => {
  const prompt = buildCorrectionPrompt([
    { kind: "hit", detail: "the attack on Goblin 1 MISSED", clause: "the blade hits the goblin" },
  ]);
  assert.ok(prompt.includes("the attack on Goblin 1 MISSED"));
  assert.ok(prompt.includes("the blade hits the goblin"));
  assert.ok(prompt.includes("Do not call any tool"));
  assert.ok(!prompt.includes("—"));
});

// ---------------------------------------------------------------------------
// Part 2: reading the turn's ground truth
// ---------------------------------------------------------------------------

test("exchanges pair each tool call with the result that answered it", () => {
  const exchanges = collectExchanges(conversationOf([attackHit, ogreWounded]));
  assert.equal(exchanges.length, 2);
  assert.equal(exchanges[0].name, "pc_attack");
  assert.equal(exchanges[0].result.hit, true);
  assert.equal(exchanges[1].name, "damage_enemy");
  assert.equal(exchanges[1].result.name, "Ogre");
});

test("a parked call keeps a null result instead of borrowing another's", () => {
  const conversation = [
    {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "a", type: "function", function: { name: "pc_attack", arguments: "{}" } },
        { id: "b", type: "function", function: { name: "damage_enemy", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "b", content: JSON.stringify({ ok: true, name: "Ogre" }) },
  ];
  const exchanges = collectExchanges(conversation);
  assert.equal(exchanges[0].result, null);
  assert.equal(exchanges[1].result.name, "Ogre");
});

test("resumed-turn results with no matching call id are still read", () => {
  const conversation = [
    { role: "tool", content: JSON.stringify({ ok: true, name: "Ogre", hp: "47/59" }) },
  ];
  const outcomes = resolveOutcomes(collectExchanges(conversation));
  assert.equal(outcomes.creatures.get("ogre").hp, 47);
});

test("names normalize to what a narrator would actually write", () => {
  assert.equal(normalizeCreatureName("Goblin 1"), "goblin");
  assert.equal(normalizeCreatureName("the Ogre"), "ogre");
  assert.equal(normalizeCreatureName("Goblin A"), "goblin");
  assert.equal(normalizeCreatureName("Bugbear Chief"), "bugbear chief");
});

test("resolved outcomes carry attacks, hit points, numbers, and spells", () => {
  const outcomes = resolveOutcomes(
    collectExchanges(
      conversationOf([
        attackHit,
        { name: "use_spell_slot", args: { characterId: "c2", level: 3, spell: "Fireball" }, result: { ok: true, slot: "level 3: 1/2 left" } },
      ]),
    ),
  );
  assert.equal(outcomes.attacks.get("goblin").hit, true);
  assert.equal(outcomes.creatures.get("goblin").hp, 3);
  assert.equal(outcomes.creatures.get("goblin").dead, false);
  assert.ok(outcomes.numbers.has(6));
  assert.ok(outcomes.numbers.has(17));
  assert.ok(outcomes.spells.has("fireball"));
});

test("an errored tool result contributes no ground truth", () => {
  const outcomes = resolveOutcomes(
    collectExchanges(
      conversationOf([
        { name: "use_spell_slot", args: { spell: "Fireball", level: 1 }, result: { error: "no slot" } },
      ]),
    ),
  );
  assert.equal(outcomes.spells.size, 0);
  assert.equal(outcomes.toolResultCount, 0);
});

// ---------------------------------------------------------------------------
// Part 3: the ruling catches real contradictions
// ---------------------------------------------------------------------------

test("a hit claimed on a resolved miss is caught", () => {
  const found = rule([about("hit", "goblin", "Kara's blade hits the goblin")], [attackMissed]);
  assert.deepEqual(kinds(found), ["hit"]);
  assert.ok(found[0].detail.includes("MISSED"));
  assert.equal(found[0].clause, "Kara's blade hits the goblin");
});

test("a miss claimed on a resolved hit is caught", () => {
  assert.deepEqual(kinds(rule([about("miss", "goblin")], [attackHit])), ["miss"]);
});

test("a death claimed against live hit points is caught", () => {
  const found = rule([about("dies", "ogre")], [ogreWounded]);
  assert.deepEqual(kinds(found), ["death"]);
  assert.ok(found[0].detail.includes("47/59"));
});

test("a character claimed down while still up is caught", () => {
  const found = rule([about("downed", "kara")], [enemyHitKara]);
  assert.deepEqual(kinds(found), ["death"]);
  assert.ok(found[0].detail.includes("9/24"));
});

test("per-victim rows inside an area effect are read as creature state", () => {
  const fireball = {
    name: "aoe_damage",
    args: { spell: "Fireball", enemyIds: ["e1"], characterIds: ["c1"] },
    result: {
      ok: true,
      damageRolled: 24,
      dc: 15,
      saveAbility: "dex",
      results: [
        { target: "Goblin 1", save: 8, success: false, damage: 24, hp: "0/9", dead: true },
        { target: "Kara", save: 17, success: true, damage: 12, hp: "12/24" },
      ],
    },
  };
  // The goblin really died; only the claim about Kara contradicts the rows.
  assert.deepEqual(rule([about("dies", "goblin")], [fireball]), []);
  assert.deepEqual(kinds(rule([about("downed", "kara")], [fireball])), ["death"]);
});

test("a damage figure no die produced is caught", () => {
  const found = rule([amount(11)], [attackHit]);
  assert.deepEqual(kinds(found), ["number"]);
  assert.ok(found[0].detail.includes("11 damage"));
});

test("a leveled spell cast with nothing spent is caught", () => {
  const found = rule([cast("Lyra", "fireball")], [attackHit]);
  assert.deepEqual(kinds(found), ["spell"]);
  assert.ok(found[0].detail.includes("Lyra casts fireball"));
});

test("several contradictions all surface, once each", () => {
  const found = rule(
    [about("hit", "goblin", "first"), amount(11), about("hit", "goblin", "again")],
    [attackMissed],
  );
  assert.deepEqual(kinds(found), ["hit", "number"]);
});

test("a hit on an attack the engine refused, and a kill with no call, are caught against the live encounter", () => {
  const live = { enemies: [{ id: "e1", name: "Goblin 1", hp: 7, maxHp: 7, status: "alive" }] };
  const refused = {
    name: "pc_attack",
    args: { characterId: "c1", targetEnemyId: "e1", weapon: "longsword" },
    result: { error: "Kara is 30 ft from Goblin 1 and cannot reach them." },
  };
  assert.deepEqual(kinds(rule([about("hit", "goblin")], [refused], live)), ["hit"]);
  assert.deepEqual(kinds(rule([about("dies", "goblin")], [], live)), ["death"]);
  // In a running fight a figure needs a roll behind it, tool or none.
  assert.deepEqual(kinds(rule([amount(14)], [], live)), ["number"]);
});

// ---------------------------------------------------------------------------
// Part 4: the ruling's deliberate false negatives
// ---------------------------------------------------------------------------

test("claims that agree with the dice are no contradiction", () => {
  assert.deepEqual(rule([about("miss", "goblin")], [attackMissed]), []);
  assert.deepEqual(rule([about("hit", "goblin"), amount(6)], [attackHit]), []);
  assert.deepEqual(rule([about("dies", "ogre")], [ogreSlain]), []);
});

test("summed damage across two hits is allowed", () => {
  const second = {
    ...attackHit,
    result: { ...attackHit.result, rolled: 19, damage: 5, hp: "1/9" },
  };
  assert.deepEqual(rule([amount(11)], [attackHit, second]), []);
});

test("d20 totals do not inflate the allowed damage figures", () => {
  // A roll total is allowed on its own (a deliberate false negative), but it
  // must not join the subset sums, or a busy round would allow almost any
  // two-digit figure.
  const d20 = {
    name: "request_roll",
    args: { characterId: "c1", kind: "skill_check", skill: "athletics" },
    result: { total: 18, dice: [], dc: 15, success: true },
  };
  assert.deepEqual(kinds(rule([amount(24)], [d20, attackHit])), ["number"]);
});

test("a number the engine produced anywhere is allowed", () => {
  // 17 was the attack roll, not the damage. Allowing it is a deliberate false
  // negative: mistaking a real number for an invented one is the worse error.
  assert.deepEqual(rule([amount(17)], [attackHit]), []);
});

test("with no numeric ground truth a figure is not checked", () => {
  const bookkeepingOnly = {
    name: "move_party",
    args: { name: "The Cellar" },
    result: { ok: true, location: "The Cellar", note: "Recorded." },
  };
  assert.deepEqual(rule([amount(30)], [bookkeepingOnly]), []);
});

test("two creatures sharing a name make every claim about it unattributable", () => {
  const goblinTwoHit = {
    ...attackHit,
    result: { ...attackHit.result, target: "Goblin 2", name: "Goblin 2", hp: "4/9" },
  };
  assert.deepEqual(rule([about("hit", "goblin")], [attackMissed, goblinTwoHit]), []);
  assert.deepEqual(rule([about("dies", "goblin")], [attackMissed, goblinTwoHit]), []);
});

test("a Multiattack whose swings disagree is never checked", () => {
  const mixed = {
    ...enemyHitKara,
    result: {
      ...enemyHitKara.result,
      multiattack: "2 attacks",
      swings: [
        { rolled: 8, hit: false },
        { rolled: 18, hit: true, damage: 5 },
      ],
    },
  };
  assert.deepEqual(rule([about("miss", "kara"), about("hit", "kara")], [mixed]), []);
});

test("a creature the turn actually killed can be claimed dead", () => {
  assert.deepEqual(rule([about("dies", "ogre")], [ogreSlain]), []);
  // Even when an earlier result in the same turn showed it alive.
  assert.deepEqual(rule([about("dies", "ogre")], [ogreWounded, ogreSlain]), []);
});

test("a spell whose slot was spent, or that a ritual or another tool accounted for, is no contradiction", () => {
  const slot = {
    name: "use_spell_slot",
    args: { characterId: "c2", level: 3, spell: "Fireball" },
    result: { ok: true, slot: "level 3: 1/2 left" },
  };
  assert.deepEqual(rule([cast("Lyra", "fireball")], [slot]), []);
  const ritual = {
    name: "use_spell_slot",
    args: { characterId: "c2", spell: "Detect Magic", ritual: true },
    result: { ok: true, note: "Detect Magic cast as a ritual: no slot spent." },
  };
  assert.deepEqual(rule([cast("Lyra", "detect magic")], [ritual]), []);
  const buff = {
    name: "cast_buff",
    args: { characterId: "c2", spell: "Bless", level: 1 },
    result: { ok: true, applied: "bless", rounds: 10 },
  };
  assert.deepEqual(rule([cast("Lyra", "bless")], [buff]), []);
});

test("a decorated spell name in the tool call still accounts for the cast", () => {
  // Models write "Hunter's Mark" with either apostrophe and tack the slot level
  // onto the name; none of that means the slot went unspent.
  const curly = {
    name: "use_spell_slot",
    args: { characterId: "c2", level: 1, spell: "Hunter’s Mark" },
    result: { ok: true, slot: "level 1: 3/4 left" },
  };
  assert.deepEqual(rule([cast("Avery", "hunter's mark")], [curly]), []);
  const decorated = {
    name: "cast_at_enemy",
    args: { characterId: "c2", spell: "Fireball (3rd level)", enemyIds: ["e1"] },
    result: { ok: true, damage: 21 },
  };
  assert.deepEqual(rule([cast("Avery", "fireball")], [decorated]), []);
});

test("a claim about a creature the turn knows nothing of is not checked", () => {
  assert.deepEqual(rule([about("dies", "dragon"), about("hit", "dragon")], [attackHit]), []);
  assert.deepEqual(rule([], [attackMissed]), []);
});

test("a fight start and a roll ask are not the guard's to rule on", () => {
  assert.deepEqual(
    rule([{ kind: "fight_start", quote: "Roll initiative!" }, { kind: "roll_ask", character: "all", check: "initiative", quote: "Roll initiative!" }], [attackHit]),
    [],
  );
});

// ---------------------------------------------------------------------------
// Part 5: fights announced, and blows landed, in prose alone
// ---------------------------------------------------------------------------

test("a fight announced is a fight_start claim", () => {
  assert.equal(fightAnnounced([{ kind: "fight_start", quote: "Roll for initiative!" }]), true);
  assert.equal(fightAnnounced([about("hit", "goblin")]), false);
  assert.equal(fightAnnounced([]), false);
});

test("the fake-encounter correction says what to call and what not to restate", () => {
  assert.match(FAKE_ENCOUNTER_PROMPT, /start_encounter/);
  assert.match(FAKE_ENCOUNTER_PROMPT, /no encounter exists/);
  assert.match(FAKE_ENCOUNTER_PROMPT, /encounter panel/);
});

test("a figure no tool rolled and the model was never shown is a blow landed in prose", () => {
  const quiet = conversationOf([]);
  assert.equal(unrolledFigure([{ ...amount(8), quote: "Hit! 8 damage." }], quiet), "Hit! 8 damage.");
  assert.equal(unrolledFigure([], quiet), null);
  // A figure the model was shown (a table note, an earlier line) is no blow.
  const noted = [...quiet, { role: "user", content: "[Table] The spikes deal 8 damage to Kara." }];
  assert.equal(unrolledFigure([amount(8)], noted), null);
  // A turn that rolled damage leaves a misquoted figure to the rewrite.
  assert.equal(unrolledFigure([amount(8)], conversationOf([attackHit])), null);
});

console.log(`engine boundary: ${passed} tests passed`);
