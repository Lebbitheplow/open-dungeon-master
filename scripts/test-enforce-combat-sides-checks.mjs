// A contest against a character on the other side (issue 503, Phase 6;
// src/lib/dm/roll-gates.ts): the character makes its side of it as any
// check of theirs is made (contest-roll.ts rollCharacterCheck), not from a
// stat block read off its sheet.
//
//   - a party member looking for a hidden turncoat rogue meets the rogue's
//     own Stealth: expertise, Supreme Sneak's advantage, and Reliable
//     Talent turning a 2 into a 10;
//   - a lie told to a turncoat meets its own Insight, with the disadvantage
//     its poisoning gives every ability check.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-combat-sides-checks");
const world = await openWorld();
const kit = await combatKit(world);
const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");
const rolls = await import("../src/lib/db/rolls.ts");

const lookout = world.addHero({ name: "Mira", class: "ranger", level: 5, abilities: { wis: 16 }, proficiencies: { ...TRAINED, skills: ["perception"] } });
const liar = world.addHero({ name: "Bram", class: "bard", level: 5, abilities: { cha: 16 }, proficiencies: { ...TRAINED, skills: ["deception"] } });

async function stage(extra) {
  await kit.endFight();
  const joined = await world.invoke("add_companion", { gender: "Unknown", name: "Sable", class: "rogue", race: "human", level: 11, personality: "Quiet.", kind: "guest" });
  assert.equal(joined.ok, true, joined.error);
  const turncoat = joined.result.characterId;
  world.patch(turncoat, {
    abilities: { str: 10, dex: 16, con: 12, int: 10, wis: 12, cha: 10 },
    proficiencies: { ...TRAINED, skills: ["stealth", "insight"], expertise: ["stealth"] },
    features: [...world.sheet(turncoat).features.filter((feature) => !/reliable talent/i.test(feature.name)), { name: "Reliable Talent", source: "class", level: 11 }],
    conditions: [], conditionMeta: {},
    ...extra,
  });
  await kit.fight(1, { heroFaces: { [lookout.id]: 19, [liar.id]: 18, [turncoat]: 3 } });
  moveToSide(world.campaign(), turncoat, "foe", { quiet: true });
  return world.sheet(turncoat);
}

const contestRollOf = (sheet) => rolls.listRecentRolls(world.campaignId, 20).find((roll) => roll.characterId === sheet.id && /contest/.test(roll.detail ?? ""));

await test("A hidden turncoat rogue meets the lookout with its own Stealth: expertise, and Reliable Talent turning a 2 into a 10", async () => {
  const turncoat = await stage({});
  world.clearDice();
  // Its d20s: a level 11 rogue companion is a Thief (its class's SRD
  // subclass), and Supreme Sneak gives it advantage when it moved little, so
  // both dice are 2s, which Reliable Talent makes 10s; DEX +3 and twice +4.
  // One forced die left the other to chance, and a real die over 10 won.
  world.dice(2, 2);
  const out = await world.invoke("check_notice", { characterIds: [lookout.id], againstEnemyId: turncoat.id, reason: "a rogue in the shadows" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.dc, 21, JSON.stringify(out.result));
  const roll = contestRollOf(turncoat);
  assert.ok(roll, "the check is the character's own, on its own card");
});

await test("A lie told to a turncoat meets its own Insight, at the disadvantage its poisoning gives", async () => {
  const turncoat = await stage({ conditions: ["poisoned"], conditionMeta: {} });
  world.clearDice();
  world.diceLog();
  // Its two d20s (disadvantage): 15 and 4; Reliable Talent lifts the 4 to a
  // 10 (it is proficient in Insight), WIS +1 and proficiency +4: 15. The
  // liar's 12 + 5 = 17 beats it.
  world.dice(15, 4, 12);
  const out = await world.invoke("request_roll", { characterId: liar.id, kind: "skill_check", skill: "deception", againstEnemyId: turncoat.id, reason: "a bluff" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const dice = world.diceLog().filter((die) => die.sides === 20);
  assert.ok(dice.length >= 3, "two d20s for the turncoat's disadvantage, one for the liar");
  assert.equal(rolls.listRecentRolls(world.campaignId, 20).find((roll) => roll.characterId === liar.id && roll.kind === "skill_check")?.dc, 16, "a tie leaves things as they were: 15 + 1");
});

// conditions, Charmed: 'The charmer has advantage on any ability check to interact socially with the creature.'
await test("A character who charmed the turncoat persuades it with advantage, and a turncoat that charmed a character lies to them with advantage", async () => {
  const missed = [];
  // The bard charmed the turncoat: the bard's Persuasion, against its Insight.
  let turncoat = await stage({ conditions: ["charmed"], conditionMeta: { charmed: { source: liar.id } } });
  world.clearDice();
  world.dice(10, 7, 13);
  const plea = await world.invoke("request_roll", { characterId: liar.id, kind: "skill_check", skill: "persuasion", againstEnemyId: turncoat.id, reason: "a plea to a charmed friend" });
  world.clearDice();
  assert.equal(plea.ok, true, plea.error);
  // The newest of the bard's checks (the list runs oldest first).
  const pleaded = rolls.listRecentRolls(world.campaignId, 20).filter((roll) => roll.characterId === liar.id && roll.kind === "skill_check").at(-1);
  if (d20Faces(pleaded).length !== 2) {
    missed.push("the charmer's own check against the turncoat");
  }
  // The turncoat charmed the lookout: its Deception, against her Insight.
  turncoat = await stage({});
  world.patch(lookout.id, { conditions: ["charmed"], conditionMeta: { charmed: { source: turncoat.id } } });
  try {
    world.clearDice();
    world.dice(7, 13, 10);
    const read = await world.invoke("request_roll", { characterId: lookout.id, kind: "skill_check", skill: "insight", againstEnemyId: turncoat.id, reason: "is the friend lying" });
    world.clearDice();
    assert.equal(read.ok, true, read.error);
    if (d20Faces(contestRollOf(turncoat)).length !== 2) {
      missed.push("the turncoat's side of the contest against the character it charmed");
    }
  } finally {
    world.patch(lookout.id, { conditions: [], conditionMeta: {} });
  }
  assert.deepEqual(missed, [], `no advantage for the charmer on ${missed.join("; ")}`);
});

await kit.endFight();
finish();
