// Ability Score Improvements and feats, as a level-up grants them.
//
// SRD 5.1: at 4th, 8th, 12th, 16th and 19th level a character raises one
// ability score by 2 or two scores by 1, never past 20. The optional feat
// rule trades that improvement for a feat, which may have a prerequisite and
// is taken once. SRD 5.1 prints one feat, Grappler (Strength 13 or higher).
//
// ODM ships the feat rule switched on: the content pack carries Grappler and
// the third-party feats, and src/lib/srd/authored-feats.json adds 52 in
// ODM's own wording. A feat is a name in sheet.feats. Two have a mechanic
// the server applies to derived numbers (Alert, Observant); Elven Accuracy
// says it has one; the rest are guidance the model narrates
// (docs/rules-coverage.md, "Alert (+5 initiative), Observant (+5 passive)").
//
// The improvement is worked out in the level-up dialog and sent to PATCH
// /api/campaigns/[id]/sheet as finished ability scores and a feats list.
// This suite sends what the dialog sends and what it never would, then reads
// the stored sheet and the numbers derived from it.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { XP_BY_LEVEL, patchSheetAs } from "./lib/enforce-srd-progression.mjs";

const { test, finish } = suite("test-enforce-feats");

const { computeSheetDerived, speedFor } = await import("../src/lib/srd/index.ts");
const { hasElvenAccuracy } = await import("../src/lib/srd/feature-effects.ts");
const { applyAsiChoices } = await import("../src/lib/srd/asi.ts");
const authoredFeats = (
  await import("../src/lib/srd/authored-feats.json", { with: { type: "json" } })
).default.feats;

const first = await openWorld();
const sheetRoute = await first.route("campaigns/[campaignId]/sheet");

// A table with one hero who has earned `toLevel`.
async function table(hero, toLevel) {
  const world = await openWorld();
  const made = world.addHero(hero);
  let owed = XP_BY_LEVEL[toLevel - 1];
  while (owed > 0) {
    const amount = Math.min(20000, owed);
    await world.invoke("award_xp", { characterIds: [made.id], amount, reason: "earned" });
    owed -= amount;
  }
  return {
    world,
    id: made.id,
    sheet: () => world.sheet(made.id),
    patch: (body) => patchSheetAs(world, sheetRoute, world.owner, body),
  };
}

const SCORES = { str: 15, dex: 14, con: 14, int: 8, wis: 12, cha: 10 };
const total = (scores) => Object.values(scores).reduce((sum, score) => sum + score, 0);
const fighter = (level, extra = {}) => ({
  class: "fighter",
  level,
  maxHp: 12 + (level - 1) * 8,
  abilities: SCORES,
  ...extra,
});
// The dialog's request for one fighter level at the fixed hit point value.
// A feat list names every feat the sheet will hold; the new ones go to the
// server as choices, a half-feat that offers a choice of score naming the
// first it offers (the level-up asks for the score; see feat-effects.ts).
const { featAbilityIncrease } = await import("../src/lib/srd/feat-effects.ts");
const featChoices = (sheet, feats) =>
  feats
    .filter((feat) => !sheet.feats.includes(feat))
    .map((feat) => {
      const increase = featAbilityIncrease(feat);
      return increase && increase.from.length > 1
        ? { mode: "feat", feat, ability: increase.from[0] }
        : { mode: "feat", feat };
    });
const oneLevel = (sheet, extra = {}) => {
  const { feats, ...rest } = extra;
  return {
    level: sheet.level + 1,
    maxHp: sheet.maxHp + 6 + abilityMod(sheet.abilities.con),
    currentHp: sheet.currentHp + 6 + abilityMod(sheet.abilities.con),
    hitDice: { ...sheet.hitDice, total: sheet.level + 1 },
    ...(feats ? { asiChoices: featChoices(sheet, feats) } : {}),
    ...rest,
  };
};

// ---- enforced today ----

await test("an improvement taken at 4th level is stored, and every number that reads it moves", async () => {
  const { sheet, patch } = await table(
    fighter(3, {
      acOverride: false,
      equipment: [{ name: "Leather Armor", qty: 1, equipped: true }],
      proficiencies: {
        saves: ["str", "con"], skills: ["acrobatics"], expertise: [], languages: ["Common"],
        tools: [], armor: ["light", "medium", "heavy", "shields"], weapons: ["simple", "martial"],
      },
    }),
    4,
  );
  const before = sheet();
  // Leather is 11 + DEX.
  assert.equal(before.ac, 11 + 2);
  const abilities = applyAsiChoices(before.abilities, [{ mode: "plus2", ability: "dex" }]);
  assert.equal(abilities.dex, 16);
  const response = await patch(oneLevel(before, { abilities }));
  assert.equal(response.status, 200, response.json.error);
  const after = sheet();
  assert.deepEqual(after.abilities, { ...SCORES, dex: 16 });
  assert.equal(after.ac, 11 + 3);
  const derived = computeSheetDerived(after);
  assert.equal(derived.initiative, 3);
  assert.equal(derived.saves.dex, 3);
  assert.equal(derived.skills.acrobatics, 3 + proficiencyBonus(4));
});

await test("a caster's save DC and spell attack follow the improved score", async () => {
  const { sheet, patch } = await table(
    {
      class: "wizard",
      level: 3,
      maxHp: 14,
      abilities: { int: 17, con: 10 },
      spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, prepared: [], known: [], cantrips: [] },
    },
    4,
  );
  assert.equal(computeSheetDerived(sheet()).spellSaveDc, 8 + 2 + 3);
  const response = await patch({
    level: 4,
    maxHp: 18,
    abilities: applyAsiChoices(sheet().abilities, [{ mode: "plus1x2", abilities: ["int", "con"] }]),
  });
  assert.equal(response.status, 200, response.json.error);
  const derived = computeSheetDerived(sheet());
  assert.equal(sheet().abilities.int, 18);
  assert.equal(derived.spellSaveDc, 8 + 2 + 4);
  assert.equal(derived.spellAttack, 2 + 4);
});

await test("the improvement itself stops at 20", () => {
  const high = { ...SCORES, str: 19, dex: 20 };
  assert.equal(applyAsiChoices(high, [{ mode: "plus2", ability: "str" }]).str, 20);
  assert.equal(applyAsiChoices(high, [{ mode: "plus2", ability: "dex" }]).dex, 20);
  assert.deepEqual(applyAsiChoices(high, [{ mode: "plus1x2", abilities: ["str", "dex"] }]), { ...high, str: 20 });
  assert.deepEqual(applyAsiChoices(high, [{ mode: "feat", feat: "Alert" }]), high);
});

await test("Alert and Observant, taken as feats, reach the numbers they change", async () => {
  // One feat an improvement: Alert with the fighter's at 4th level and
  // Observant with the one at 6th. (This case used to take both at 4th,
  // which is two feats for one improvement.)
  const { world, id, sheet, patch } = await table(fighter(3), 6);
  const plain = computeSheetDerived(sheet());
  const both = await patch(oneLevel(sheet(), { feats: ["Alert", "Observant"] }));
  assert.equal(both.status, 400, "two feats for one improvement");
  for (const feats of [["Alert"], ["Alert"], ["Alert", "Observant"]]) {
    const response = await patch(oneLevel(sheet(), sheet().level === 4 ? {} : { feats }));
    assert.equal(response.status, 200, response.json.error);
  }
  assert.deepEqual(sheet().feats, ["Alert", "Observant"]);
  const derived = computeSheetDerived(sheet());
  assert.equal(derived.initiative, plain.initiative + 5);
  assert.equal(derived.passivePerception, plain.passivePerception + 5);
  // And the initiative the engine rolls, not only the number on the sheet.
  const fight = await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [id]: 10 } });
  const entry = fight.order.find((row) => row.characterId === id);
  assert.equal(entry.initiative, 10 + abilityMod(SCORES.dex) + 5);
});

await test("ODM's own feats: 52 (the 2014 Alert among them), each named once, each with rules text", () => {
  assert.equal(authoredFeats.length, 52);
  const names = authoredFeats.map((feat) => feat.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
  // SRD 5.1's one feat comes from the content pack, not from this list.
  assert.equal(names.includes("grappler"), false);
  for (const feat of authoredFeats) {
    assert.ok(feat.desc.length > 40, feat.name);
    assert.equal(typeof feat.prerequisite, "string", feat.name);
    assert.ok(feat.name.length <= 80, feat.name);
  }
  // Every prerequisite is one of the kinds a server could check.
  for (const feat of authoredFeats.filter((entry) => entry.prerequisite)) {
    assert.match(
      feat.prerequisite,
      /^(?:(?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)(?: or (?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma))? 13 or higher|Proficiency with (?:light|medium|heavy) armor|The ability to cast at least one spell|Spellcasting or Pact Magic|Elf or half-elf)$/,
      feat.name,
    );
  }
});

// ---- findings: the improvement ----

await test(
  "Ability scores rise at 4th, 8th, 12th, 16th and 19th level, and at no other.",
  async () => {
    const { sheet, patch } = await table(fighter(1), 2);
    await patch(oneLevel(sheet(), { abilities: { ...SCORES, str: 17 } }));
    assert.deepEqual(sheet().abilities, SCORES, `a fighter 2 holds ${JSON.stringify(sheet().abilities)}`);
  },
);

await test(
  "One improvement is two points: +2 to one score or +1 to two.",
  async () => {
    const { sheet, patch } = await table(fighter(3), 4);
    await patch(oneLevel(sheet(), { abilities: { str: 20, dex: 20, con: 20, int: 20, wis: 20, cha: 20 } }));
    const gained = total(sheet().abilities) - total(SCORES);
    assert.ok(gained <= 2, `one improvement raised the scores by ${gained} points`);
  },
);

await test(
  "An Ability Score Improvement cannot raise a score above 20.",
  async () => {
    const { sheet, patch } = await table(fighter(3, { abilities: { ...SCORES, str: 19 } }), 4);
    await patch(oneLevel(sheet(), { abilities: { ...SCORES, str: 21 } }));
    assert.ok(sheet().abilities.str <= 20, `Strength is ${sheet().abilities.str}`);
  },
);

await test(
  "An improvement raises scores; it does not move points from one score to another.",
  async () => {
    const { sheet, patch } = await table(fighter(3), 4);
    await patch(oneLevel(sheet(), { abilities: { str: 20, dex: 14, con: 18, int: 3, wis: 12, cha: 8 } }));
    for (const [ability, score] of Object.entries(sheet().abilities)) {
      assert.ok(score >= SCORES[ability], `${ability} fell from ${SCORES[ability]} to ${score}`);
    }
  },
);

await test(
  "When the Constitution modifier rises by 1, the hit point maximum rises by 1 for every level the character has.",
  async () => {
    const { sheet, patch } = await table(fighter(3), 4);
    const before = sheet();
    await patch(
      oneLevel(before, {
        abilities: applyAsiChoices(before.abilities, [{ mode: "plus2", ability: "con" }]),
      }),
    );
    assert.equal(sheet().abilities.con, 16);
    assert.equal(sheet().maxHp, 10 + 3 + 3 * (6 + 3), `a fighter 4 with CON 16 holds ${sheet().maxHp}`);
  },
);

// ---- findings: feats ----

await test(
  "A feat is taken in place of an Ability Score Improvement: none at 2nd level, and not both at 4th.",
  async () => {
    const early = await table(fighter(1), 2);
    await early.patch(oneLevel(early.sheet(), { feats: ["Alert", "Lucky", "Sentinel"] }));
    assert.deepEqual(early.sheet().feats, [], `a fighter 2 holds ${early.sheet().feats.join(", ")}`);
    const both = await table(fighter(3), 4);
    await both.patch(oneLevel(both.sheet(), { feats: ["Alert"], abilities: { ...SCORES, str: 17 } }));
    const spent = total(both.sheet().abilities) - total(SCORES) + 2 * both.sheet().feats.length;
    // Two points or a feat, never both: the request is refused whole, or
    // one of the two is taken. (As a finding this asked for exactly 2, which
    // a refusal that changes nothing does not give.)
    assert.ok(spent <= 2, "one improvement bought two points and a feat");
  },
);

await test(
  "A feat is taken once unless its text says otherwise.",
  async () => {
    const { sheet, patch } = await table(fighter(7, { feats: ["Alert"] }), 8);
    await patch(oneLevel(sheet(), { feats: ["Alert", "Alert"] }));
    assert.deepEqual(sheet().feats, ["Alert"], `the sheet's feats are ${sheet().feats.join(", ")}`);
  },
);

await test(
  "A feat with a prerequisite can be taken only by a character who meets it: Grappler needs Strength 13.",
  async () => {
    const weak = { str: 8, dex: 8, con: 10, int: 8, wis: 8, cha: 8 };
    for (const feat of ["Grappler", "Defensive Duelist", "Inspiring Leader", "War Caster", "Heavy Armor Master", "Elven Accuracy"]) {
      const { sheet, patch } = await table(
        { class: "fighter", level: 3, maxHp: 28, abilities: weak, race: "human", proficiencies: {
          saves: ["str", "con"], skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: [],
        } },
        4,
      );
      await patch({ level: 4, maxHp: 34, feats: [feat] });
      assert.deepEqual(sheet().feats, [], `a human fighter with 8 in every score and no armor training took ${feat}`);
    }
  },
);

await test(
  "A feat on a sheet is one the table's content offers.",
  async () => {
    const { sheet, patch } = await table(fighter(3), 4);
    await patch(oneLevel(sheet(), { feats: ["Immune to all damage"] }));
    assert.deepEqual(sheet().feats, [], `the sheet holds the feat "${sheet().feats.join(", ")}"`);
  },
);

await test(
  "Elven Accuracy: with advantage on a Dexterity, Intelligence, Wisdom or Charisma attack the server rolls a third d20, for a feat held in sheet.feats.",
  async () => {
    const { sheet, patch } = await table(fighter(3, { race: "high_elf" }), 4);
    await patch(oneLevel(sheet(), { feats: ["Elven Accuracy"] }));
    assert.deepEqual(sheet().feats, ["Elven Accuracy"]);
    assert.equal(hasElvenAccuracy(sheet()), true, "an elf holding the feat Elven Accuracy is not seen to have it");
  },
);

const featFx = await import("../src/lib/srd/feat-effects.ts");

await test("a half-feat's increase is the one its text names, the choice is the player's where it offers one, and 20 is the cap", () => {
  const base = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 20 };
  assert.deepEqual(featFx.featAbilityIncrease("Actor"), { from: ["cha"], amount: 1 });
  assert.deepEqual(featFx.featAbilityIncrease("Athlete").from, ["str", "dex"]);
  assert.equal(featFx.featAbilityIncrease("Resilient").from.length, 6);
  assert.equal(featFx.featAbilityIncrease("Alert"), null);
  assert.equal(featFx.featAbilityIncrease("Tough"), null);
  assert.equal(featFx.applyFeatIncrease(base, "Actor").abilities.cha, 20);
  assert.equal(featFx.applyFeatIncrease(base, "Durable").abilities.con, 14);
  assert.ok("error" in featFx.applyFeatIncrease(base, "Athlete"));
  assert.ok("error" in featFx.applyFeatIncrease(base, "Athlete", "cha"));
  assert.equal(featFx.applyFeatIncrease(base, "Athlete", "dex").abilities.dex, 15);
  const resilient = featFx.applyFeatIncrease(base, "Resilient", "wis");
  assert.equal(featFx.featSaveProficiency("Resilient", resilient.raised), "wis");
  assert.equal(featFx.featSaveProficiency("Actor", "cha"), null);
});

await test("Tough, Mobile, War Caster and Heavy Armor Master are read from sheet.feats", () => {
  const holder = { feats: ["Tough", "Mobile", "War Caster", "Heavy Armor Master"], features: [] };
  assert.equal(featFx.featHitPointBonus(holder, 4), 8);
  assert.equal(featFx.featHitPointBonus({ feats: [] }, 4), 0);
  assert.equal(featFx.featSpeedBonus(holder), 10);
  assert.equal(featFx.hasWarCaster(holder), true);
  assert.equal(featFx.hasWarCaster({ feats: ["Warcaster Robes"] }), false);
  const hit = (over) => featFx.heavyArmorMasterReduction(holder, { wearingHeavyArmor: true, damageType: "slashing", magical: false, ...over });
  assert.equal(hit({}), 3);
  assert.equal(hit({ magical: true }), 0);
  assert.equal(hit({ wearingHeavyArmor: false }), 0);
  assert.equal(hit({ damageType: "fire" }), 0);
});

await test(
  "A feat that changes a number on the sheet changes it: Actor is +1 Charisma, Tough is +2 hit points a level, Mobile is +10 feet of speed.",
  async () => {
    const actor = await table(fighter(3), 4);
    await actor.patch(oneLevel(actor.sheet(), { feats: ["Actor"] }));
    assert.equal(actor.sheet().abilities.cha, SCORES.cha + 1, "Actor left Charisma where it was");
    const tough = await table(fighter(3), 4);
    await tough.patch(oneLevel(tough.sheet(), { feats: ["Tough"] }));
    assert.equal(tough.sheet().maxHp, 36 + 2 * 4, "Tough added no hit points");
    const mobile = await table(fighter(3), 4);
    await mobile.patch(oneLevel(mobile.sheet(), { feats: ["Mobile"] }));
    assert.equal(speedFor({ ...mobile.sheet(), features: [...mobile.sheet().features, ...mobile.sheet().feats.map((name) => ({ name }))] }), 40);
  },
);

await test("a half-feat with a choice of score raises the score chosen, Resilient adds that saving throw, and no choice is refused", async () => {
  const resilient = await table(fighter(3), 4);
  const before = resilient.sheet();
  const blank = await resilient.patch({ ...oneLevel(before), asiChoices: [{ mode: "feat", feat: "Resilient" }] });
  assert.equal(blank.status, 400, "Resilient taken without saying which score");
  assert.deepEqual(resilient.sheet().abilities, before.abilities);
  const taken = await resilient.patch({ ...oneLevel(before), asiChoices: [{ mode: "feat", feat: "Resilient", ability: "wis" }] });
  assert.equal(taken.status, 200, taken.json.error);
  assert.equal(resilient.sheet().abilities.wis, before.abilities.wis + 1);
  assert.ok(resilient.sheet().proficiencies.saves.includes("wis"), "Resilient (Wisdom) gave no Wisdom save");
});

// ---- half-feats taken when the character is made ----

const { openCreation } = await import("./lib/enforce-creation.mjs");
const { openBuilder, standardScores } = await import("./lib/enforce-builder.mjs");
const creation = await openCreation({ campaign: { startingLevel: 8 } });
const builder = await openBuilder();
// A level 8 human soldier fighter, three improvements (4th, 6th, 8th) chosen.
const madeFighter = (fields) =>
  builder.build({
    race: "human",
    class: "fighter",
    background: "soldier",
    level: 8,
    subclass: "Champion",
    chosenSkills: ["acrobatics", "perception"],
    stylePicks: ["defense"],
    bonusLanguages: ["Giant"],
    ...fields,
  });

await test(
  "A half-feat taken when the character is made raises its score by 1, never past 20, as at a level-up: the score chosen where the feat offers a choice, with Resilient's saving throw, and a choosing half-feat with no score is refused with nothing stored.",
  async () => {
    // Human: +1 to every score. Charisma 15 + 1, +2, +2 is 20, and Actor stops there.
    const actor = madeFighter({
      scores: standardScores(["cha", "str", "dex", "con", "int", "wis"]),
      asiChoices: [{ mode: "plus2", ability: "cha" }, { mode: "plus2", ability: "cha" }, { mode: "feat", feat: "Actor" }],
    });
    assert.equal(actor.blocker, null, actor.blocker?.message);
    const actorAt = await creation.atTable(actor.sheet);
    assert.equal(actorAt.status, 201, actorAt.error);
    assert.equal(actorAt.sheet.abilities.cha, 20);
    assert.deepEqual(actorAt.sheet.feats, ["Actor"]);

    // Resilient (Wisdom): Wisdom 10 + 1 + 1, and the Wisdom save.
    const resilient = madeFighter({
      asiChoices: [{ mode: "plus2", ability: "str" }, { mode: "plus2", ability: "str" }, { mode: "feat", feat: "Resilient", ability: "wis" }],
    });
    assert.equal(resilient.blocker, null, resilient.blocker?.message);
    const resilientAt = await creation.atTable(resilient.sheet);
    assert.equal(resilientAt.status, 201, resilientAt.error);
    assert.deepEqual(resilientAt.sheet.abilities, { str: 20, dex: 15, con: 14, int: 13, wis: 12, cha: 9 });
    assert.ok(resilientAt.sheet.proficiencies.saves.includes("wis"), "Resilient (Wisdom) gave no Wisdom save");
    assert.ok(computeSheetDerived(resilientAt.sheet).saves.wis >= 1 + proficiencyBonus(8));

    // Durable raises Constitution, and the hit points follow it.
    const durable = madeFighter({
      asiChoices: [{ mode: "plus2", ability: "str" }, { mode: "plus2", ability: "str" }, { mode: "feat", feat: "Durable" }],
    });
    const durableAt = await creation.atTable(durable.sheet);
    assert.equal(durableAt.status, 201, durableAt.error);
    assert.equal(durableAt.sheet.abilities.con, 15);
    assert.equal(durableAt.sheet.maxHp, 10 + 2 + 7 * (6 + 2));

    // No score named for a feat that offers a choice: refused, nothing stored.
    const blank = {
      ...resilient.sheet,
      asiChoices: [{ mode: "plus2", ability: "str" }, { mode: "plus2", ability: "str" }, { mode: "feat", feat: "Resilient" }],
    };
    const blankAt = await creation.atTable(blank);
    assert.equal(blankAt.status, 400, "Resilient taken at creation without saying which score");
    assert.match(blankAt.error, /Resilient raises one of/);
    assert.equal(blankAt.sheet, null);
    // A score the feat does not offer: refused too.
    const athlete = { ...resilient.sheet, asiChoices: [...blank.asiChoices.slice(0, 2), { mode: "feat", feat: "Athlete", ability: "cha" }] };
    assert.equal((await creation.atTable(athlete)).status, 400, "Athlete raising Charisma");
  },
);

await test("a variant human's own half-feat raises the score it names, and the score is kept with the character", async () => {
  const human = madeFighter({
    race: "variant_human",
    racialAsi: ["str", "dex"],
    // Not Athletics: the soldier grants it, and a racial pick on it is
    // blanked and asked for again (issue #124).
    racialSkills: ["stealth"],
    chosenSkills: ["acrobatics", "perception"],
    asiChoices: [{ mode: "plus2", ability: "str" }, { mode: "plus2", ability: "str" }, { mode: "plus2", ability: "dex" }],
    feats: ["Resilient"],
    racialFeatAbility: "wis",
  });
  assert.equal(human.blocker, null, human.blocker?.message);
  assert.equal(human.sheet.racialChoices.featAbility, "wis");
  const at = await creation.atTable(human.sheet);
  assert.equal(at.status, 201, at.error);
  assert.deepEqual(at.sheet.abilities, { str: 20, dex: 17, con: 13, int: 12, wis: 11, cha: 8 });
  assert.ok(at.sheet.proficiencies.saves.includes("wis"));
  // Without a score the feat is refused, as a level-up refuses it.
  const blank = { ...human.sheet, racialChoices: { ...human.sheet.racialChoices, featAbility: undefined } };
  assert.equal((await creation.atTable(blank)).status, 400);
});

await test("a half-feat's point is taken once: a character made in the library keeps the same scores when it comes to a table", async () => {
  const resilient = madeFighter({
    asiChoices: [{ mode: "plus2", ability: "str" }, { mode: "plus2", ability: "str" }, { mode: "feat", feat: "Resilient", ability: "wis" }],
  });
  const brought = await creation.throughLibrary(resilient.sheet, 8);
  assert.equal(brought.status, 201, brought.error);
  assert.equal(brought.character.sheet.abilities.wis, 12);
  assert.deepEqual(brought.sheet.abilities, brought.character.sheet.abilities);
  assert.ok(brought.sheet.proficiencies.saves.includes("wis"));
});

await test("the builder shows the scores, saves and hit points the server stores, a half-feat's point included", async () => {
  const cases = [
    madeFighter({
      asiChoices: [{ mode: "plus2", ability: "str" }, { mode: "plus2", ability: "str" }, { mode: "feat", feat: "Durable" }],
    }),
    madeFighter({
      asiChoices: [{ mode: "plus2", ability: "str" }, { mode: "plus2", ability: "str" }, { mode: "feat", feat: "Resilient", ability: "wis" }],
    }),
    madeFighter({
      race: "variant_human",
      racialAsi: ["str", "con"],
      racialSkills: ["stealth"],
      asiChoices: [{ mode: "plus2", ability: "str" }, { mode: "plus2", ability: "str" }, { mode: "plus2", ability: "dex" }],
      // The racial half-feat's score left unpicked: the builder sends the first.
      feats: ["Resilient"],
    }),
  ];
  for (const built of cases) {
    assert.equal(built.blocker, null, built.blocker?.message);
    const at = await creation.atTable(built.sheet);
    assert.equal(at.status, 201, at.error);
    assert.deepEqual(built.derived.shownAbilities, at.sheet.abilities, "the scores shown are the scores stored");
    assert.equal(built.derived.preview.maxHp, at.sheet.maxHp, "the hit points shown are the hit points stored");
    const stored = computeSheetDerived(at.sheet);
    assert.deepEqual(built.derived.preview.derived.saves, stored.saves, "the saves shown are the saves stored");
    assert.equal(built.derived.preview.derived.initiative, stored.initiative);
  }
  // What the builder sends stays the scores before the half-feat: Durable's
  // point is the server's to add.
  assert.equal(cases[0].sheet.abilities.con + 1, cases[0].derived.shownAbilities.con);
});

// ---- Alert: the 2014 feat, one of it ----
//
// The pack's only Alert is a 2024 row, which a 2014 character is never
// offered; ODM's own 2014 Alert (authored-feats.json) is served in its place
// (src/lib/content/authored-feats.ts). The builder's and the level-up's
// pickers both read GET /api/content/feats, a page at a time.

const { getContentDb } = await import("../src/lib/content/db.ts");
const { getEntryDetail } = await import("../src/lib/content/index.ts");
const featsRoute = await first.route("content/[kind]");

// Every feat name the picker would list, paged as CatalogBrowser pages.
async function pickerFeats(q = "") {
  first.signIn(first.owner);
  const names = [];
  for (let offset = 0; offset < 1000; offset += 50) {
    const url = `http://odm.test/api/content/feats?limit=50&offset=${offset}${q ? `&q=${q}` : ""}`;
    const response = await featsRoute.GET(new Request(url), { params: Promise.resolve({ kind: "feats" }) });
    const page = (await response.json()).results;
    names.push(...page.map((entry) => entry.name));
    if (page.length < 50) {
      break;
    }
  }
  return names;
}

async function withoutPack(fn) {
  getContentDb();
  const saved = globalThis.__odmContentDb;
  globalThis.__odmContentDb = null;
  try {
    return await fn();
  } finally {
    globalThis.__odmContentDb = saved;
  }
}

const alerts = (names) => names.filter((name) => name.toLowerCase() === "alert").length;

await test("the feat pickers offer exactly one Alert, the 2014 feat, with the content pack and without it", async () => {
  for (const [label, run] of [["with the pack", (fn) => fn()], ["without the pack", withoutPack]]) {
    await run(async () => {
      assert.equal(alerts(await pickerFeats()), 1, `${label}: the whole list`);
      assert.equal(alerts(await pickerFeats("aler")), 1, `${label}: a search`);
      const all = await pickerFeats();
      for (const feat of authoredFeats) {
        assert.equal(all.filter((name) => name === feat.name).length, 1, `${label}: ${feat.name}`);
      }
      const shown = getEntryDetail("feats", "alert");
      assert.equal(shown?.documentSlug, "odm-expanded", `${label}: the Alert a picker's info button opens`);
      assert.match(String(shown.data.desc), /initiative/);
    });
  }
});

await test("a character stored with Alert before the 2014 row came back keeps +5 initiative and cannot be surprised", async () => {
  const world = await openWorld();
  const watchful = world.addHero({ class: "fighter", level: 4, feats: ["Alert"], abilities: SCORES });
  const plain = world.addHero({ class: "fighter", level: 4, abilities: SCORES });
  assert.equal(computeSheetDerived(world.sheet(watchful.id)).initiative, computeSheetDerived(world.sheet(plain.id)).initiative + 5);
  const fight = await world.beginFight([{ monster: "goblin", count: 1 }], {
    surprised: "party", heroFaces: { [watchful.id]: 10, [plain.id]: 10 },
  });
  assert.deepEqual(fight.surprisedIds, [plain.id], "only the character without Alert is caught");
  const rolled = (id) => fight.order.find((row) => row.characterId === id).initiative;
  assert.equal(rolled(watchful.id), rolled(plain.id) + 5);
  world.close();
});

await test("ODM's 2014 Alert is written in ODM's own words, not the Player's Handbook's", () => {
  const alert = authoredFeats.find((feat) => feat.name === "Alert");
  for (const printed of [
    "Always on the lookout for danger",
    "You gain a +5 bonus to initiative",
    "You can't be surprised while you are conscious",
    "as a result of being unseen by you",
  ]) {
    assert.equal(alert.desc.toLowerCase().includes(printed.toLowerCase()), false, printed);
  }
});

creation.world.close();
first.close();
finish();
