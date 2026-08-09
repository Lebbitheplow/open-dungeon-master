// The engine-boundary contract and the narration/outcome consistency guard.
//
// The guard is deliberately biased toward false negatives: it must never fire
// on legitimate flavor text, metaphor, quoted dialogue, or an NPC lying about
// a result. Most of this file is therefore negative cases, and every matcher
// below has one that proves the reason it will not misfire.
import assert from "node:assert/strict";

const {
  ENGINE_BOUNDARY_RULES,
  ENGINE_BOUNDARY_CHECK,
  buildCorrectionPrompt,
  checkNarration,
  collectExchanges,
  narrationClauses,
  normalizeCreatureName,
  resolveOutcomes,
  stripQuotedSpeech,
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

function check(narration, calls, partyNames = []) {
  return checkNarration({ conversation: conversationOf(calls), narration, partyNames });
}

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
// Part 3: reading the prose
// ---------------------------------------------------------------------------

test("quoted speech is cut out before anything is matched", () => {
  assert.equal(stripQuotedSpeech('He grins. "The ogre is dead!"').trim(), "He grins.");
  // An unbalanced quote takes the rest of its line with it.
  assert.equal(stripQuotedSpeech('She calls out, "it is dead').trim(), "She calls out,");
});

test("clauses split on semicolons and dashes, not only full stops", () => {
  const clauses = narrationClauses("The blade sings; the goblin ducks. Steel rings on stone.");
  assert.equal(clauses.length, 3);
});

// ---------------------------------------------------------------------------
// Part 4a: the matchers fire on real contradictions
// ---------------------------------------------------------------------------

test("a hit narrated on a resolved miss is caught", () => {
  const found = check("Kara's blade hits the goblin, and it staggers back.", [attackMissed]);
  assert.deepEqual(kinds(found), ["hit"]);
  assert.ok(found[0].detail.includes("MISSED"));
});

test("a hit narrated on a resolved miss is caught in the passive too", () => {
  const found = check("The goblin is struck across the shoulder.", [attackMissed]);
  assert.deepEqual(kinds(found), ["hit"]);
});

test("a miss narrated on a resolved hit is caught", () => {
  const found = check(
    "Kara's arrow whistles past the goblin and buries itself in the door.",
    [attackHit],
  );
  assert.deepEqual(kinds(found), ["miss"]);
});

test("a miss phrase that takes the target as its object is caught", () => {
  assert.deepEqual(kinds(check("Kara's arrow goes wide of the goblin.", [attackHit])), ["miss"]);
});

test("a death narrated against live hit points is caught", () => {
  const found = check("The ogre crumples, dead, at your feet.", [ogreWounded]);
  assert.deepEqual(kinds(found), ["death"]);
  assert.ok(found[0].detail.includes("47/59"));
});

test("a kill narrated against live hit points is caught", () => {
  assert.deepEqual(kinds(check("Your axe kills the ogre.", [ogreWounded])), ["death"]);
  assert.deepEqual(kinds(check("You step over the ogre's corpse.", [ogreWounded])), ["death"]);
});

test("a character narrated unconscious while still up is caught", () => {
  const found = check("Kara falls unconscious in the mud.", [enemyHitKara]);
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
  assert.deepEqual(check("The goblin dies in the blast.", [fireball]), []);
  assert.deepEqual(kinds(check("Kara falls unconscious in the blast.", [fireball])), ["death"]);
});

test("a damage figure no die produced is caught", () => {
  const found = check("The blade opens a gash for 11 damage.", [attackHit]);
  assert.deepEqual(kinds(found), ["number"]);
  assert.ok(found[0].detail.includes("11 damage"));
});

test("a leveled spell cast with nothing spent is caught", () => {
  const found = check("Lyra casts fireball into the corridor.", [attackHit], ["Lyra", "Kara"]);
  assert.deepEqual(kinds(found), ["spell"]);
  assert.ok(found[0].detail.includes("Lyra casts fireball"));
});

test("several contradictions in one narration all surface, once each", () => {
  const found = check(
    "Kara's blade hits the goblin for 11 damage. The goblin dies where it stands. Kara's blade hits the goblin again.",
    [attackMissed],
  );
  assert.deepEqual(kinds(found), ["hit", "number"]);
});

// ---------------------------------------------------------------------------
// Part 4b: the negative cases, which matter more than the coverage
// ---------------------------------------------------------------------------

test("flavor text about death does not fire", () => {
  // "felt" and "like" both mark the clause as a comparison, not a claim.
  assert.deepEqual(check("The blow felt like death itself.", [ogreWounded]), []);
  assert.deepEqual(check("A deathly silence settles over the hall.", [ogreWounded]), []);
  assert.deepEqual(check("The ogre's eyes are dead things in a dead face.", [ogreWounded]), []);
});

test("metaphor and simile do not fire", () => {
  assert.deepEqual(check("The ogre fights like a dying thing.", [ogreWounded]), []);
  assert.deepEqual(check("The ogre looks nearly dead on its feet.", [ogreWounded]), []);
  assert.deepEqual(
    check("It is as though the goblin were struck by lightning.", [attackMissed]),
    [],
  );
});

test("an NPC lying about a result does not fire", () => {
  assert.deepEqual(
    check('The captain grins. "The ogre is dead, I swear it, dead as stone."', [ogreWounded]),
    [],
  );
  // Reported speech carries the same protection outside quotation marks.
  assert.deepEqual(check("The scout reports that the ogre is dead.", [ogreWounded]), []);
  assert.deepEqual(check("The goblin boasts that it kills the ogre.", [ogreWounded]), []);
});

test("quoted dialogue containing numbers does not fire", () => {
  assert.deepEqual(check('"Twelve damage!" the bard crows, delighted.', [attackHit]), []);
  assert.deepEqual(
    check('The merchant leans in. "Forty gold, or 40 damage to your pride."', [attackHit]),
    [],
  );
});

test("an attempt is not an outcome", () => {
  // "strikes at" and "swings toward" are declared intent; the lookahead in the
  // hit matcher throws them out.
  assert.deepEqual(check("Kara strikes at the goblin, steel ringing.", [attackMissed]), []);
  assert.deepEqual(check("Kara slashes toward the goblin.", [attackMissed]), []);
  assert.deepEqual(check("The arrow tears into the air above the goblin.", [attackMissed]), []);
});

test("negated claims do not fire", () => {
  assert.deepEqual(check("The blade does not hit the goblin.", [attackMissed]), []);
  assert.deepEqual(check("The ogre is not dead yet, nothing like it.", [ogreWounded]), []);
});

test("the creature's own missed swing is not read as the attack on it", () => {
  // The attacks map is keyed by TARGET, so a goblin missing its counterattack
  // says nothing about the resolved hit against the goblin. Enemy ripostes in
  // the same paragraph as a player's hit are the normal shape of combat prose.
  assert.deepEqual(check("The goblin swipes back at her and misses.", [attackHit]), []);
  assert.deepEqual(check("The goblin's rusty blade goes wide.", [attackHit]), []);
});

test("a negated miss phrase does not fire", () => {
  assert.deepEqual(check("Her blade never misses the goblin.", [attackHit]), []);
});

test("narration that agrees with the dice does not fire", () => {
  assert.deepEqual(check("Kara's blade misses the goblin, ringing off stone.", [attackMissed]), []);
  assert.deepEqual(
    check("Kara's blade bites into the goblin for 6 damage; it reels, badly wounded.", [attackHit]),
    [],
  );
  assert.deepEqual(check("The ogre dies where it stands.", [ogreSlain]), []);
});

test("summed damage across two hits is allowed", () => {
  const second = {
    ...attackHit,
    result: { ...attackHit.result, rolled: 19, damage: 5, hp: "1/9" },
  };
  assert.deepEqual(
    check("Two blows land in a heartbeat, 11 damage in all.", [attackHit, second]),
    [],
  );
});

test("dice notation is not read as a damage figure", () => {
  assert.deepEqual(check("The greataxe rolls its 2d6 damage every swing.", [attackHit]), []);
  assert.deepEqual(check("A 1d8 damage die is nothing to a troll.", [attackHit]), []);
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
  assert.deepEqual(kinds(check("The impact is worth 24 damage.", [d20, attackHit])), ["number"]);
});

test("a number the engine produced anywhere is allowed", () => {
  // 17 was the attack roll, not the damage. Allowing it is a deliberate false
  // negative: mistaking a real number for an invented one is the worse error.
  assert.deepEqual(check("The wound is worth 17 damage of pain.", [attackHit]), []);
});

test("with no numeric ground truth the number matcher stays quiet", () => {
  const bookkeepingOnly = {
    name: "move_party",
    args: { name: "The Cellar" },
    result: { ok: true, location: "The Cellar", note: "Recorded." },
  };
  assert.deepEqual(check("You remember taking 30 damage down here.", [bookkeepingOnly]), []);
});

test("two creatures sharing a name make every claim about it unattributable", () => {
  const goblinTwoHit = {
    ...attackHit,
    result: { ...attackHit.result, target: "Goblin 2", name: "Goblin 2", hp: "4/9" },
  };
  assert.deepEqual(check("The blade hits the goblin squarely.", [attackMissed, goblinTwoHit]), []);
  assert.deepEqual(check("The goblin dies where it stands.", [attackMissed, goblinTwoHit]), []);
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
  assert.deepEqual(check("The first blow goes wide of Kara; the second bites deep.", [mixed]), []);
});

test("a creature the turn actually killed can be narrated dead", () => {
  assert.deepEqual(check("The ogre falls dead across the table.", [ogreSlain]), []);
  // Even when an earlier result in the same turn showed it alive.
  assert.deepEqual(check("The ogre falls dead across the table.", [ogreWounded, ogreSlain]), []);
});

test("a cantrip needs no slot, so casting one never fires", () => {
  assert.deepEqual(check("Lyra casts fire bolt at the door.", [attackHit], ["Lyra"]), []);
});

test("a spell whose slot was spent never fires", () => {
  const slot = {
    name: "use_spell_slot",
    args: { characterId: "c2", level: 3, spell: "Fireball" },
    result: { ok: true, slot: "level 3: 1/2 left" },
  };
  assert.deepEqual(check("Lyra casts fireball into the corridor.", [slot], ["Lyra"]), []);
});

test("a ritual or an upcast through another tool still counts as accounted for", () => {
  const ritual = {
    name: "use_spell_slot",
    args: { characterId: "c2", spell: "Detect Magic", ritual: true },
    result: { ok: true, note: "Detect Magic cast as a ritual: no slot spent." },
  };
  assert.deepEqual(check("Lyra casts detect magic over the chest.", [ritual], ["Lyra"]), []);
  const buff = {
    name: "cast_buff",
    args: { characterId: "c2", spell: "Bless", level: 1 },
    result: { ok: true, applied: "bless", rounds: 10 },
  };
  assert.deepEqual(check("Lyra casts bless over the party.", [buff], ["Lyra"]), []);
});

test("a decorated spell name still matches its own tool call", () => {
  // Models write "Hunter's Mark" with either apostrophe and tack the slot level
  // onto the name; none of that means the slot went unspent.
  const curly = {
    name: "use_spell_slot",
    args: { characterId: "c2", level: 1, spell: "Hunter’s Mark" },
    result: { ok: true, slot: "level 1: 3/4 left" },
  };
  assert.deepEqual(check("Avery casts hunter's mark on the wolf.", [curly], ["Avery"]), []);
  assert.deepEqual(check("Avery casts hunter’s mark on the wolf.", [curly], ["Avery"]), []);
  const decorated = {
    name: "cast_at_enemy",
    args: { characterId: "c2", spell: "Fireball (3rd level)", enemyIds: ["e1"] },
    result: { ok: true, damage: 21 },
  };
  assert.deepEqual(check("Avery casts fireball down the hall.", [decorated], ["Avery"]), []);
});

test("an enemy caster is never checked against the party's slots", () => {
  // Monster spells run through cast_at_player and spend no tracked slot, so a
  // name that is not a party character is left entirely alone.
  assert.deepEqual(check("The lich casts finger of death at Kara.", [attackHit], ["Kara"]), []);
});

test("past-tense casting is left alone", () => {
  assert.deepEqual(
    check("Lyra cast hold person on the guard an hour ago.", [attackHit], ["Lyra"]),
    [],
  );
});

test("ordinary scene prose with no mechanics fires nothing", () => {
  const narration = [
    "The cellar smells of wet stone and old iron.",
    "Kara sets her shoulder to the door while the goblin watches from the stair.",
    "Somewhere below, water drips into a cistern, counting seconds nobody is keeping.",
    "What do you do?",
  ].join("\n\n");
  assert.deepEqual(check(narration, [attackHit]), []);
  assert.deepEqual(check(narration, [attackMissed]), []);
  assert.deepEqual(check(narration, [ogreWounded, enemyHitKara]), []);
});

test("empty narration and an empty turn are both no-ops", () => {
  assert.deepEqual(check("", [attackMissed]), []);
  assert.deepEqual(check("   \n  ", [attackMissed]), []);
  assert.deepEqual(check("The goblin dies where it stands.", []), []);
});

test("a name too short or too common to attribute is skipped", () => {
  // Single and double letter enemy labels would match half the prose.
  const tiny = { name: "damage_enemy", args: {}, result: { ok: true, name: "It", hp: "4/9" } };
  assert.deepEqual(check("It dies quietly.", [tiny]), []);
});

console.log(`engine boundary: ${passed} tests passed`);
