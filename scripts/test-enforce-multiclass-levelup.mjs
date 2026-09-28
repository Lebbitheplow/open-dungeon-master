// Multiclassing through the door a player actually uses: PATCH on the
// campaign sheet route with levelUpClass, which builds the class list, the
// hit-die pools and the proficiency grants on the server.
//
// The rules guarded here are SRD 5.1's "Multiclassing" section and ODM's own
// additions to it (docs/rules-coverage.md, "Multiclassing (enforced)"):
//
// - A new class needs 13 in its prerequisite scores AND in those of every
//   class already held. 12 is refused, and a refusal writes nothing.
// - At most three classes (ODM's rule; the SRD sets no limit), never the same
//   class twice, never past character level 20, and no new class at a table
//   that switched multiclassing off.
// - A second class grants the SRD's multiclass proficiency row and never a
//   saving throw. The one skill some rows offer comes from the row's list.
// - Each class brings its own hit die, and the summed mirror follows.
// - The class list, the pools and the proficiencies are the server's: a
//   player's request cannot write them.
// - Custom genre classes ask for 13 in their casting ability, or in their
//   first saving throw when they cast nothing (ODM's rule).
import assert from "node:assert/strict";
import {
  SRD_CLASS_IDS,
  SRD_HIT_DIE,
  SRD_PREREQS,
  assertCoherent,
  openTable,
  scores,
  scoresMeeting,
} from "./lib/enforce-multiclass.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-multiclass-levelup");
const table = await openTable();
const { world, send, hero, now, levelUp, levelInto, assertRefused } = table;
const { multiclassPrereq } = await import("../src/lib/srd/multiclass.ts");

// SRD 5.1, "Multiclassing Proficiencies". Bard and ranger and rogue also
// offer one skill, checked apart.
const SRD_GRANTS = {
  barbarian: { armor: ["shields"], weapons: ["simple weapons", "martial weapons"], tools: [] },
  bard: { armor: ["light armor"], weapons: [], tools: 1 },
  cleric: { armor: ["light armor", "medium armor", "shields"], weapons: [], tools: [] },
  druid: { armor: ["light armor", "medium armor", "shields"], weapons: [], tools: [] },
  fighter: { armor: ["light armor", "medium armor", "shields"], weapons: ["simple weapons", "martial weapons"], tools: [] },
  monk: { armor: [], weapons: ["simple weapons", "shortswords"], tools: [] },
  paladin: { armor: ["light armor", "medium armor", "shields"], weapons: ["simple weapons", "martial weapons"], tools: [] },
  ranger: { armor: ["light armor", "medium armor", "shields"], weapons: ["simple weapons", "martial weapons"], tools: [] },
  rogue: { armor: ["light armor"], weapons: [], tools: ["thieves' tools"] },
  sorcerer: { armor: [], weapons: [], tools: [] },
  warlock: { armor: ["light armor"], weapons: ["simple weapons"], tools: [] },
  wizard: { armor: [], weapons: [], tools: [] },
};

// SRD 5.1 class skill lists for the two rows that pick from one.
const SRD_SKILL_LISTS = {
  ranger: ["animal_handling", "athletics", "insight", "investigation", "nature", "perception", "stealth", "survival"],
  rogue: ["acrobatics", "athletics", "deception", "insight", "intimidation", "investigation", "perception", "performance", "persuasion", "sleight_of_hand", "stealth"],
};

const bare = (saves = []) => ({
  saves, skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: [],
});
const all13 = scores({ str: 13, dex: 13, con: 13, int: 13, wis: 13, cha: 13 });

await test("ODM's prerequisite table is the SRD's, class for class", () => {
  for (const classId of SRD_CLASS_IDS) {
    assert.deepEqual(multiclassPrereq(classId), SRD_PREREQS[classId], classId);
  }
});

await test("every SRD class pair: 13 in both classes' scores opens the door", async () => {
  for (const from of SRD_CLASS_IDS) {
    for (const to of SRD_CLASS_IDS.filter((id) => id !== from)) {
      hero({ class: from, level: 1, abilities: scoresMeeting(from, to) });
      const out = await levelUp(to);
      assert.equal(out.status, 200, `${from} into ${to}: ${out.error}`);
      assert.deepEqual(
        now().classes.map((entry) => [entry.id, entry.level]),
        [[from, 1], [to, 1]],
        `${from} into ${to}`,
      );
      assertCoherent(now(), `${from}/${to}`);
    }
  }
});

await test("every SRD class pair: 12 in a score the NEW class needs is refused", async () => {
  for (const from of SRD_CLASS_IDS) {
    for (const to of SRD_CLASS_IDS.filter((id) => id !== from)) {
      // Everything at 13 except what the new class asks for: each of its
      // alternatives is one point short in one score.
      const short = { ...all13 };
      for (const alternative of SRD_PREREQS[to]) {
        short[alternative[alternative.length - 1]] = 12;
      }
      // A score the old class needs too may drop with it; either way the
      // request is illegal, which is all this asserts.
      hero({ class: from, level: 1, abilities: short });
      await assertRefused({ level: 2, levelUpClass: to }, `${from} into ${to}`);
      assert.deepEqual(now().classes, [], `${from} into ${to}`);
    }
  }
});

await test("every SRD class pair: 12 in a score the HELD class needs is refused", async () => {
  for (const from of SRD_CLASS_IDS) {
    for (const to of SRD_CLASS_IDS.filter((id) => id !== from)) {
      const short = { ...all13 };
      for (const alternative of SRD_PREREQS[from]) {
        short[alternative[0]] = 12;
      }
      hero({ class: from, level: 1, abilities: short });
      await assertRefused({ level: 2, levelUpClass: to }, `leaving ${from} for ${to}`);
    }
  }
});

await test("a class with two alternatives opens on either and shuts on neither", async () => {
  for (const [abilities, legal] of [
    [scores({ str: 13, dex: 8, int: 13 }), true],
    [scores({ str: 8, dex: 13, int: 13 }), true],
    [scores({ str: 12, dex: 12, int: 13 }), false],
  ]) {
    hero({ class: "wizard", level: 1, abilities });
    const out = await levelUp("fighter");
    assert.equal(out.status === 200, legal, JSON.stringify(abilities));
  }
  // A class with two scores needs both: one at 13 is not enough.
  for (const [classId, abilities] of [
    ["monk", scores({ str: 13, dex: 13, wis: 12 })],
    ["monk", scores({ str: 13, dex: 12, wis: 13 })],
    ["paladin", scores({ str: 13, cha: 12 })],
    ["ranger", scores({ str: 13, dex: 12, wis: 13 })],
  ]) {
    hero({ class: "fighter", level: 1, abilities });
    await assertRefused({ level: 2, levelUpClass: classId }, classId);
  }
});

// ODM's own rule. SRD 5.1 puts no limit on the number of classes.
await test("a fourth class is refused (ODM's cap of three)", async () => {
  hero({ class: "fighter", level: 1, abilities: all13 });
  await levelInto("rogue");
  await levelInto("wizard");
  await assertRefused({ level: 4, levelUpClass: "cleric" }, "fourth class");
  assert.equal(now().classes.length, 3);
  // The three it has still level.
  await levelInto("rogue");
  assert.deepEqual(now().classes.map((entry) => entry.level), [1, 2, 1]);
});

await test("a class already held gains a level, never a second entry", async () => {
  hero({ class: "fighter", level: 2, abilities: all13 });
  await levelInto("rogue");
  await levelInto("rogue");
  await levelInto("fighter");
  assert.deepEqual(now().classes.map((entry) => [entry.id, entry.level]), [["fighter", 3], ["rogue", 2]]);
  // No class named: the level goes to the first class.
  const out = await send("sheet", "PATCH", { level: 6 });
  assert.equal(out.status, 200, out.error);
  assert.deepEqual(now().classes.map((entry) => entry.level), [4, 2]);
  assertCoherent(now());
});

await test("an unknown class is refused", async () => {
  hero({ class: "fighter", level: 1, abilities: all13 });
  await assertRefused({ level: 2, levelUpClass: "demigod" }, "unknown class");
});

await test("a table with multiclassing off refuses a new class and nothing else", async () => {
  const off = await openTable({ gameSettings: { multiclassingEnabled: false } });
  off.hero({ class: "fighter", level: 1, abilities: all13 });
  await off.assertRefused({ level: 2, levelUpClass: "rogue" }, "multiclassing off");
  const own = await off.levelUp("fighter");
  assert.equal(own.status, 200, own.error);
  assert.equal(off.now().level, 2);
});

await test("character level stops at 20 however the levels are split", async () => {
  hero({ class: "fighter", level: 17, abilities: all13 });
  await levelInto("rogue", 2);
  await levelInto("wizard", 1);
  assert.equal(now().level, 20);
  assertCoherent(now());
  for (const classId of ["fighter", "rogue", "wizard"]) {
    await assertRefused({ level: 21, levelUpClass: classId }, `level 21 in ${classId}`);
    await assertRefused({ level: 20, levelUpClass: classId }, `a level that gains nothing in ${classId}`);
  }
});

await test("the second class grants the SRD's multiclass row, and never a saving throw", async () => {
  for (const to of SRD_CLASS_IDS) {
    const from = to === "fighter" ? "rogue" : "fighter";
    const saves = from === "fighter" ? ["str", "con"] : ["dex", "int"];
    hero({ class: from, level: 1, abilities: all13, proficiencies: bare(saves) });
    await levelInto(to);
    const held = now().proficiencies;
    const row = SRD_GRANTS[to];
    assert.deepEqual(held.saves, saves, `${to} granted a saving throw`);
    assert.deepEqual(held.armor, row.armor, `${to} armor`);
    assert.deepEqual(held.weapons, row.weapons, `${to} weapons`);
    if (typeof row.tools === "number") {
      // One musical instrument of the player's choice.
      assert.equal(held.tools.length, row.tools, `${to} tools`);
      assert.match(held.tools[0], /instrument/i);
    } else {
      assert.deepEqual(held.tools, row.tools, `${to} tools`);
    }
    assert.deepEqual(held.skills, [], `${to} granted a skill nobody picked`);
    assert.deepEqual(held.languages, ["Common"], `${to} languages`);
  }
});

await test("a grant the character already holds is not written twice", async () => {
  hero({
    class: "fighter", level: 1, abilities: all13,
    proficiencies: { ...bare(["str", "con"]), armor: ["Light Armor", "shields"], weapons: ["simple weapons"] },
  });
  await levelInto("paladin");
  assert.deepEqual(now().proficiencies.armor, ["Light Armor", "shields", "medium armor"]);
  assert.deepEqual(now().proficiencies.weapons, ["simple weapons", "martial weapons"]);
});

await test("the skill a row offers comes from that row's list, once", async () => {
  for (const classId of ["ranger", "rogue"]) {
    for (const skill of SRD_SKILL_LISTS[classId]) {
      hero({ class: "fighter", level: 1, abilities: all13 });
      await levelInto(classId, 1, { levelUpSkill: skill });
      assert.deepEqual(now().proficiencies.skills, [skill], `${classId} ${skill}`);
    }
    // Arcana is on neither list.
    hero({ class: "fighter", level: 1, abilities: all13 });
    await levelInto(classId, 1, { levelUpSkill: "arcana" });
    assert.deepEqual(now().proficiencies.skills, [], `${classId} took a skill off its list`);
  }
  // A bard picks any skill, but it has to be a skill.
  hero({ class: "fighter", level: 1, abilities: all13 });
  await levelInto("bard", 1, { levelUpSkill: "arcana" });
  assert.deepEqual(now().proficiencies.skills, ["arcana"]);
  hero({ class: "fighter", level: 1, abilities: all13 });
  await levelInto("bard", 1, { levelUpSkill: "juggling" });
  assert.deepEqual(now().proficiencies.skills, []);
});

await test("no skill for a row without one, a skill already held, or a later level", async () => {
  for (const classId of SRD_CLASS_IDS.filter((id) => !["bard", "ranger", "rogue", "fighter"].includes(id))) {
    hero({ class: "fighter", level: 1, abilities: all13 });
    await levelInto(classId, 1, { levelUpSkill: "athletics" });
    assert.deepEqual(now().proficiencies.skills, [], classId);
  }
  hero({ class: "fighter", level: 1, abilities: all13, proficiencies: { ...bare(), skills: ["stealth"] } });
  await levelInto("rogue", 1, { levelUpSkill: "stealth" });
  assert.deepEqual(now().proficiencies.skills, ["stealth"]);
  // The pick belongs to the first level in the class, not to every level.
  await send("sheet", "PATCH", { level: 3, levelUpClass: "rogue", levelUpSkill: "acrobatics" });
  assert.deepEqual(now().proficiencies.skills, ["stealth"]);
});

await test("each class brings its own hit die and the mirror follows", async () => {
  for (const to of SRD_CLASS_IDS.filter((id) => id !== "fighter")) {
    hero({ class: "fighter", level: 3, abilities: all13, hitDice: { die: "d10", total: 3, spent: 2 } });
    await levelInto(to);
    assert.deepEqual(now().hitDicePools, [
      { classId: "fighter", die: "d10", total: 3, spent: 2 },
      { classId: to, die: SRD_HIT_DIE[to], total: 1, spent: 0 },
    ]);
    assert.deepEqual(now().hitDice, { die: "d10", total: 4, spent: 2 });
  }
});

await test("the class list, the pools and the proficiencies are not a player's to write", async () => {
  hero({ class: "fighter", level: 3, abilities: all13, gold: 5 });
  await levelInto("rogue");
  const forged = {
    class: "wizard",
    classes: [{ id: "wizard", subclass: "", level: 20 }],
    hitDicePools: [{ classId: "wizard", die: "d12", total: 20, spent: 0 }],
    proficiencies: { ...bare(["str", "dex", "con", "int", "wis", "cha"]), armor: ["heavy armor"] },
    resources: { action_surge: { max: 9, used: 0 } },
  };
  // Alone, the forged fields are dropped and nothing is left to write.
  const before = now();
  await send("sheet", "PATCH", forged);
  assert.deepEqual({ ...now(), updatedAt: "" }, { ...before, updatedAt: "" });
  // Riding on a real level-up they are dropped too, with every field the
  // multiclass path does not own.
  const out = await send("sheet", "PATCH", {
    ...forged,
    level: 5,
    levelUpClass: "rogue",
    hitDice: { die: "d12", total: 20, spent: 0 },
    gold: 99999,
    xp: 1,
    ac: 30,
    conditions: ["invisible"],
    equipment: [{ name: "Holy Avenger", qty: 1 }],
    spellcasting: { ability: "int", slots: { 9: { max: 4, used: 0 } }, prepared: ["Wish"], known: [] },
  });
  assert.equal(out.status, 200, out.error);
  const after = now();
  assert.deepEqual(after.classes.map((entry) => [entry.id, entry.level]), [["fighter", 3], ["rogue", 2]]);
  assert.deepEqual(after.hitDicePools.map((pool) => [pool.die, pool.total]), [["d10", 3], ["d8", 2]]);
  assert.deepEqual(after.proficiencies.saves, []);
  assert.ok(!after.proficiencies.armor.includes("heavy armor"));
  assert.equal(after.resources.action_surge.max, 1);
  assert.deepEqual(
    [after.gold, after.xp, after.ac, after.conditions, after.equipment, after.spellcasting],
    [5, before.xp, before.ac, [], [], null],
  );
  assertCoherent(after);
});

await test("a level cannot be handed back, and stats cannot move without one", async () => {
  hero({ class: "fighter", level: 3, abilities: all13 });
  await levelInto("rogue");
  await assertRefused({ level: 3, levelUpClass: "rogue" }, "a lower level");
  await assertRefused({ levelUpClass: "wizard" }, "a class with no level");
  await assertRefused({ maxHp: 200 }, "hit points with no level");
  await assertRefused({ abilities: all13, subclass: "Thief" }, "scores with no level");
});

await test("mirrors and counters hold through a long run of level-ups and spends", async () => {
  hero({ class: "barbarian", level: 1, abilities: all13 });
  const order = ["rogue", "barbarian", "wizard", "rogue", "wizard", "barbarian", "rogue", "wizard",
    "wizard", "barbarian", "rogue", "wizard", "barbarian", "rogue", "wizard", "barbarian", "rogue",
    "wizard", "barbarian"];
  for (const [step, classId] of order.entries()) {
    await levelInto(classId);
    // Ask for more spent dice than exist, then for fewer than none are spent.
    const spend = await send("usage", "POST", { hitDiceSpent: step % 3 === 0 ? 20 : step % 5 });
    assert.equal(spend.status, 200, spend.error);
    assertCoherent(now(), `step ${step + 1}`);
  }
  assert.equal(now().level, 20);
  assert.deepEqual(now().classes.map((entry) => entry.level), [7, 6, 7]);
});

// ODM's rule (docs/rules-coverage.md): a custom caster asks for 13 in its
// casting ability, any other custom class for 13 in its first saving throw.
await test("custom genre classes: 13 in the casting ability, else in the first save", async () => {
  for (const [classId, ability] of [
    ["grave_knight", "cha"],
    ["netrunner", "int"],
    ["exorcist", "wis"],
    ["street_samurai", "str"],
    ["fixer", "dex"],
    ["detective", "int"],
  ]) {
    hero({ class: "fighter", level: 1, abilities: scores({ str: 13, dex: 13, [ability]: 12 }) });
    await assertRefused({ level: 2, levelUpClass: classId }, `${classId} at ${ability} 12`);
    hero({ class: "fighter", level: 1, abilities: scores({ str: 13, [ability]: 13 }) });
    await levelInto(classId);
    assert.equal(now().classes[1].id, classId);
    assertCoherent(now(), classId);
  }
  // And the class already held is checked on the way out.
  hero({ class: "grave_knight", level: 1, abilities: scores({ str: 13, cha: 12 }) });
  await assertRefused({ level: 2, levelUpClass: "fighter" }, "leaving grave_knight at cha 12");
});

await test("custom genre classes grant no saving throw and no heavy armor", async () => {
  hero({ class: "fighter", level: 1, abilities: all13, proficiencies: bare(["str", "con"]) });
  await levelInto("steam_knight");
  const held = now().proficiencies;
  assert.deepEqual(held.saves, ["str", "con"]);
  assert.ok(held.armor.length > 0);
  assert.ok(!held.armor.some((entry) => /heavy/i.test(entry)), held.armor.join(", "));
});

// ---- not enforced today ----

await test(
  "A level in a class adds that class's hit die (rolled or its average) plus the Constitution modifier to the hit point maximum.",
  async () => {
    hero({ class: "fighter", level: 3, abilities: scores({ str: 13, int: 13 }), maxHp: 28 });
    const out = await levelUp("wizard", { maxHp: 500 });
    // A wizard level is worth at most 6 with Constitution 10.
    assert.ok(out.status >= 400 || now().maxHp <= 28 + 6, `maximum hit points went from 28 to ${now().maxHp}`);
  },
);

await test(
  "Ability scores rise only through an Ability Score Improvement, by two points in all, to at most 20.",
  async () => {
    hero({ class: "fighter", level: 1, abilities: scores({ str: 13, dex: 13 }) });
    // Level 2 earns no improvement under the SRD or under ODM's thresholds.
    const out = await levelUp("rogue", { abilities: scores({ str: 30, dex: 30, con: 30, int: 30, wis: 30, cha: 30 }) });
    assert.ok(out.status >= 400 || now().abilities.int === 10, `scores are now ${JSON.stringify(now().abilities)}`);
  },
);

await test(
  "Class features come from class levels: Extra Attack (3) is a fighter's at level 20.",
  async () => {
    const { attacksAllowedFor } = await import("../src/lib/dm/action-tools.ts");
    hero({ class: "fighter", level: 1, abilities: all13 });
    await levelUp("rogue", { features: [{ name: "Extra Attack (3)", source: "story" }] });
    assert.equal(attacksAllowedFor(now()), 1, "a fighter 1 / rogue 1 attacks four times an action");
  },
);

await test(
  "A character gains one level at a time (ODM says so itself in mutation-math.ts sheetBuffViolation).",
  async () => {
    hero({ class: "fighter", level: 1, abilities: all13 });
    const out = await send("sheet", "PATCH", { level: 8, levelUpClass: "wizard" });
    assert.ok(out.status >= 400, `a level 1 fighter with 0 XP became ${JSON.stringify(now().classes)}`);
  },
);

await test(
  "A subclass belongs to its class: Champion is a fighter's Martial Archetype.",
  async () => {
    hero({ class: "fighter", level: 3, abilities: all13 });
    const out = await levelUp("rogue", { subclass: "Champion" });
    assert.ok(out.status >= 400 || now().classes[1].subclass === "", `rogue entry holds "${now().classes[1]?.subclass}"`);
  },
);

await test(
  "Each class picks its subclass at its own level: a rogue at rogue level 3.",
  async () => {
    hero({ class: "fighter", level: 3, abilities: all13 });
    const out = await levelUp("rogue", { subclass: "Thief" });
    assert.ok(out.status >= 400 || now().classes[1].subclass === "", `rogue 1 holds "${now().classes[1]?.subclass}"`);
  },
);

await test(
  "Expertise is a rogue's (levels 1 and 6) and a bard's (levels 3 and 10), two skills each time.",
  async () => {
    hero({
      class: "fighter", level: 3, abilities: all13,
      proficiencies: { ...bare(["str", "con"]), skills: ["athletics", "perception"] },
    });
    await levelUp("wizard", { expertise: ["athletics", "perception"] });
    assert.deepEqual(now().proficiencies.expertise, [], "a fighter 3 / wizard 1 holds expertise");
  },
);

world.close();
finish();
