// What a player's level-up request may carry, one field at a time.
//
// PATCH /api/campaigns/[id]/sheet refuses every rules field outside a
// level-up (test-enforce-player-patch.mjs holds that). Inside one, the route
// lets every key of patchSheetSchema through, so the question asked here is
// asked once per key: a player who HAS earned the level sends the dialog's
// own request with one field written by hand, and the stored sheet is read.
//
// The rule, from the table's owner: a player changes nothing on their own
// sheet that the rules do not give them. Hit points, experience, coin, gear,
// armor class, conditions, scores, feats, features, spells and hit dice are
// the engine's, and a correction is the DM's or the party lead's to make. A
// level gives one hit die, the die's roll plus the Constitution modifier in
// hit points, the class table's features, and an improvement only at 4th,
// 8th, 12th, 16th and 19th level (SRD 5.1, "Beyond 1st Level").
//
// Every key of the schema has a row; a key added to the schema fails the
// first test until it has one. A row is a test() where the server holds the
// rule today and a gap() named patch-<field> where it stores what it was
// sent. test-enforce-levelup.mjs asks the same route about the level itself
// (experience, subclass timing, slots) and records those under levelup-*.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-patch-fields");
const { patchSheetSchema } = await import("../src/lib/schemas/sheet.ts");

const first = await openWorld();
const sheetRoute = await first.route("campaigns/[campaignId]/sheet");

const FIGHTER = {
  class: "fighter",
  level: 1,
  maxHp: 12,
  gold: 10,
  abilities: { str: 16, con: 14 },
  equipment: [{ name: "Longsword", qty: 1 }],
  proficiencies: {
    saves: ["str", "con"], skills: ["athletics", "perception"], expertise: [], languages: ["Common"],
    tools: [], armor: ["light", "medium", "heavy", "shields"], weapons: ["simple", "martial"],
  },
};

// A hero with the experience for 2nd level, and the request the dialog sends
// for it: one level, one hit die, the fixed hit point gain.
async function earned(hero = FIGHTER, prepare) {
  const world = await openWorld();
  const made = world.addHero(hero);
  const awarded = await world.invoke("award_xp", { characterIds: [made.id], amount: 300, reason: "earned" });
  assert.equal(awarded.ok, true, awarded.error);
  await prepare?.(world, made.id);
  const before = world.sheet(made.id);
  const gain = 6 + abilityMod(before.abilities.con);
  const honest = {
    level: before.level + 1,
    maxHp: before.maxHp + gain,
    currentHp: Math.min(before.currentHp + gain, before.maxHp + gain),
    hitDice: { ...before.hitDice, total: before.level + 1 },
  };
  world.signIn(world.owner);
  const send = (extra) =>
    call(sheetRoute, "PATCH", { ...honest, ...extra }, { campaignId: world.campaignId });
  return { world, id: made.id, before, gain, send, after: () => world.sheet(made.id) };
}

const names = (sheet) => sheet.equipment.map((item) => item.name);

// One row per key. `attempt` sends the request and asserts the state a legal
// sheet is in afterwards, whether the server refused or corrected it.
const ROWS = {
  level: {
    rule: "A level is earned with experience: a sheet at 0 XP stays at 1st level.",
    severity: "high",
    note: "levelingUp is `level > sheet.level` and nothing more; also levelup-without-xp.",
    attempt: async () => {
      const world = await openWorld();
      const hero = world.addHero(FIGHTER);
      world.signIn(world.owner);
      await call(sheetRoute, "PATCH", { level: 2, maxHp: 20 }, { campaignId: world.campaignId });
      assert.equal(world.sheet(hero.id).level, 1, "level 2 on 0 XP");
    },
  },
  maxHp: {
    rule: "A fighter's level adds at most 10 + the Constitution modifier to the hit point maximum.",
    severity: "high",
    note: "Stored as sent, up to the schema's 500.",
    attempt: async () => {
      const { send, after, before } = await earned();
      await send({ maxHp: 500 });
      assert.ok(after().maxHp <= before.maxHp + 10 + 2, `max HP ${after().maxHp}`);
    },
  },
  currentHp: {
    rule: "Levelling is not a rest: current hit points rise by the level's gain and no more.",
    severity: "high",
    note: "A wounded character leaves the dialog at full health.",
    attempt: async () => {
      const { send, after, gain } = await earned(FIGHTER, (world, id) =>
        world.invoke("apply_damage", { characterId: id, amount: 9, reason: "a fall" }),
      );
      await send({ currentHp: 12 + gain });
      assert.ok(after().currentHp <= 3 + gain, `current HP ${after().currentHp} from 3`);
    },
  },
  tempHp: {
    rule: "Temporary hit points come from a spell or a feature, never from the player.",
    severity: "high",
    note: "Any value to 200 is stored.",
    attempt: async () => {
      const { send, after } = await earned();
      await send({ tempHp: 200 });
      assert.equal(after().tempHp, 0, `temporary hit points ${after().tempHp}`);
    },
  },
  ac: {
    rule: "Armor class is what the armor, the shield and Dexterity make it.",
    severity: "high",
    note: "On a pinned sheet the number is stored; every attack against the hero is judged against it.",
    attempt: async () => {
      const { send, after, before } = await earned();
      await send({ ac: 30 });
      assert.equal(after().ac, before.ac, `armor class ${after().ac}`);
    },
  },
  acOverride: {
    rule: "Pinning an armor class over the armor engine is a correction, and corrections are the DM's.",
    severity: "medium",
    note: "A player turns the armor engine off for their own sheet; with `ac` beside it the pinned number is theirs.",
    attempt: async () => {
      const { send, after } = await earned({ ...FIGHTER, acOverride: false });
      await send({ acOverride: true, ac: 30 });
      assert.equal(after().acOverride, false, `pinned, at armor class ${after().ac}`);
      assert.ok(after().ac < 20, `armor class ${after().ac} in no armor`);
    },
  },
  xp: {
    rule: "Experience is awarded by whoever runs the story.",
    severity: "high",
    note: "355,000 XP is stored, which earns every later level at once.",
    attempt: async () => {
      const { send, after } = await earned();
      await send({ xp: 355000 });
      assert.equal(after().xp, 300, `${after().xp} XP`);
    },
  },
  gold: {
    rule: "Coin is gained by loot, sale or award.",
    severity: "high",
    note: "Stored as sent.",
    attempt: async () => {
      const { send, after } = await earned();
      await send({ gold: 1000000 });
      assert.equal(after().gold, 10, `${after().gold} gp`);
    },
  },
  copper: {
    rule: "Coin is gained by loot, sale or award.",
    severity: "low",
    note: "Stored as sent, to the schema's 99.",
    attempt: async () => {
      const { send, after } = await earned();
      await send({ copper: 99 });
      assert.equal(after().copper, 0, `${after().copper} cp`);
    },
  },
  conditions: {
    rule: "A condition ends when its duration, its save or its cure ends it.",
    severity: "high",
    note: "An empty list clears poison, paralysis and the rest; the durations in conditionMeta are left behind.",
    attempt: async () => {
      const { send, after } = await earned(FIGHTER, (world, id) =>
        world.invoke("set_condition", { characterId: id, condition: "poisoned", rounds: 10, reason: "a dart" }),
      );
      await send({ conditions: [] });
      assert.deepEqual(after().conditions, ["poisoned"], `conditions ${JSON.stringify(after().conditions)}`);
    },
  },
  equipment: {
    rule: "Gear is found, bought or given in play.",
    severity: "high",
    note: "The list is replaced whole, so a player writes any item, equipped.",
    attempt: async () => {
      const { send, after, before } = await earned();
      await send({ equipment: [{ name: "Plate", qty: 1, equipped: true }, { name: "Vorpal Sword", qty: 1 }] });
      assert.deepEqual(names(after()), names(before), `carrying ${names(after()).join(", ")}`);
    },
  },
  hitDice: {
    rule: "A character has one hit die per level, of the class's die.",
    severity: "medium",
    note: "Die and total are stored as sent.",
    attempt: async () => {
      const { send, after } = await earned();
      await send({ hitDice: { die: "d12", total: 20, spent: 0 } });
      assert.deepEqual(after().hitDice, { die: "d10", total: 2, spent: 0 }, JSON.stringify(after().hitDice));
    },
  },
  spellcasting: {
    rule: "A fighter with no spellcasting feature casts no spells and holds no slots.",
    severity: "high",
    note: "The spell counts are checked only when the sheet already casts; a class that does not is handed the block as sent.",
    attempt: async () => {
      const { send, after } = await earned();
      await send({
        spellcasting: {
          ability: "int",
          slots: { 9: { max: 4, used: 0 } },
          prepared: [],
          known: ["Wish"],
          cantrips: [],
        },
      });
      assert.equal(after().spellcasting, null, JSON.stringify(after().spellcasting));
    },
  },
  feats: {
    rule: "A feat is taken in place of an Ability Score Improvement, which 2nd level does not give.",
    severity: "high",
    note: "The list is stored as sent.",
    attempt: async () => {
      const { send, after } = await earned();
      await send({ feats: ["Lucky", "Sharpshooter", "Tough"] });
      assert.deepEqual(after().feats, [], `feats ${after().feats.join(", ")}`);
    },
  },
  features: {
    rule: "Class features come from the class table.",
    severity: "high",
    note: "A fighter sends Rage as a class feature and is given the counter; also levelup-features-by-hand.",
    attempt: async () => {
      const { send, after } = await earned();
      await send({ features: [{ name: "Rage", source: "class" }] });
      assert.equal(after().resources.rage, undefined, JSON.stringify(after().resources));
    },
  },
  abilities: {
    rule: "Ability scores rise with an Ability Score Improvement, first given at 4th level.",
    severity: "high",
    note: "All six at 20 are stored at 2nd level.",
    attempt: async () => {
      const { send, after, before } = await earned();
      await send({ abilities: { str: 20, dex: 20, con: 20, int: 20, wis: 20, cha: 20 } });
      assert.deepEqual(after().abilities, before.abilities, JSON.stringify(after().abilities));
    },
  },
  expertise: {
    rule: "Expertise is a rogue's and a bard's feature; a fighter has none to pick.",
    severity: "medium",
    note: "The pick is kept when the sheet is proficient in the skill, whatever the class.",
    attempt: async () => {
      const { send, after } = await earned();
      await send({ expertise: ["athletics", "perception"] });
      assert.deepEqual(after().proficiencies.expertise, [], `expertise in ${after().proficiencies.expertise.join(", ")}`);
    },
  },
  subclass: {
    rule: "A fighter chooses a Martial Archetype at 3rd level.",
    severity: "low",
    note: "Stored at 2nd; also levelup-subclass-early.",
    attempt: async () => {
      const { send, after } = await earned();
      await send({ subclass: "Champion" });
      assert.equal(after().subclass, "", `subclass ${after().subclass}`);
    },
  },
  levelUpClass: {
    rule: "Multiclassing into wizard needs Intelligence 13.",
    severity: "high",
    note: "",
    attempt: async () => {
      const { send, after } = await earned();
      const response = await send({ levelUpClass: "wizard" });
      assert.equal(response.status, 400, JSON.stringify(response.json));
      assert.equal(after().level, 1);
      assert.deepEqual(after().classes, []);
    },
  },
  levelUpSkill: {
    rule: "A multiclass skill pick comes from the new class's list, and only a class that grants one gives it.",
    severity: "medium",
    note: "",
    attempt: async () => {
      // Barbarian grants no skill; rogue grants one from its own list.
      const brute = await earned();
      assert.equal((await brute.send({ levelUpClass: "barbarian", levelUpSkill: "arcana" })).status, 200);
      assert.ok(!brute.after().proficiencies.skills.includes("arcana"));
      const sneak = await earned({ ...FIGHTER, abilities: { str: 16, dex: 14, con: 14 } });
      assert.equal((await sneak.send({ levelUpClass: "rogue", levelUpSkill: "arcana" })).status, 200);
      assert.ok(!sneak.after().proficiencies.skills.includes("arcana"), "arcana is not a rogue skill");
    },
  },
  levelUpForget: {
    rule: "On gaining a level a sorcerer may replace one spell they know, and it must be one they know.",
    severity: "medium",
    note: "",
    attempt: async () => {
      const sorcerer = {
        class: "sorcerer", level: 1, maxHp: 8, abilities: { cha: 16, con: 14 },
        spellcasting: {
          ability: "cha", slots: { 1: { max: 2, used: 0 } }, prepared: [],
          known: ["Magic Missile", "Shield"], cantrips: ["Fire Bolt", "Light", "Mage Hand", "Prestidigitation"],
        },
      };
      const stranger = await earned(sorcerer);
      const refused = await stranger.send({ levelUpSpells: ["Sleep"], levelUpForget: "Fireball" });
      assert.equal(refused.status, 400, JSON.stringify(refused.json));
      assert.equal(stranger.after().level, 1);
      const swap = await earned(sorcerer);
      const taken = await swap.send({ levelUpSpells: ["Sleep", "Burning Hands"], levelUpForget: "Shield" });
      assert.equal(taken.status, 200, JSON.stringify(taken.json));
      assert.deepEqual(swap.after().spellcasting.known, ["Magic Missile", "Sleep", "Burning Hands"]);
    },
  },
  asiChoices: {
    rule: "An Ability Score Improvement is taken at the class's improvement levels: a fighter's first is at 4th.",
    severity: "high",
    note: "",
    attempt: async () => {
      const { send, after, before } = await earned();
      const early = await send({ asiChoices: [{ mode: "plus2", ability: "str" }] });
      assert.equal(early.status, 400, JSON.stringify(early.json));
      assert.deepEqual(after().abilities, before.abilities);
      assert.equal(after().level, 1);
    },
  },
  featChoices: {
    rule: "A feat's own picks (Linguist's three languages) come with the feat, which an improvement level grants; at a level with none they change nothing.",
    severity: "high",
    note: "",
    attempt: async () => {
      const { send, after, before } = await earned();
      const early = await send({ featChoices: { linguist: { languages: ["Dwarvish", "Giant", "Orc"] } } });
      assert.equal(early.status, 200, JSON.stringify(early.json));
      assert.deepEqual(after().proficiencies.languages, before.proficiencies.languages);
    },
  },
  hpChoice: {
    rule: "Hit points follow the table's method: at a table that takes the fixed value, asking to roll changes nothing.",
    severity: "medium",
    note: "",
    attempt: async () => {
      const { send, after, before, gain } = await earned();
      const response = await send({ hpChoice: "roll" });
      assert.equal(response.status, 200, JSON.stringify(response.json));
      assert.equal(response.json.rolled, undefined);
      assert.equal(after().maxHp, before.maxHp + gain);
    },
  },
  levelUpSpells: {
    rule: "A first wizard level writes six spells of 1st level in the spellbook.",
    severity: "high",
    note: "",
    attempt: async () => {
      const { send, after } = await earned({ ...FIGHTER, abilities: { str: 16, int: 14, con: 14 } });
      const tooMany = await send({
        levelUpClass: "wizard",
        levelUpSpells: ["Magic Missile", "Shield", "Sleep", "Mage Armor", "Burning Hands", "Thunderwave", "Grease"],
      });
      assert.equal(tooMany.status, 400, JSON.stringify(tooMany.json));
      assert.equal(after().level, 1);
    },
  },
};

const COSMETIC = ["portrait", "notes", "backstory"];

await test("every key of the player's patch schema has a row here", () => {
  for (const key of Object.keys(patchSheetSchema.shape)) {
    assert.ok(COSMETIC.includes(key) || key in ROWS, `patchSheetSchema gained "${key}": give it a row`);
  }
  for (const key of Object.keys(ROWS)) {
    assert.ok(key in patchSheetSchema.shape, `${key} left the schema`);
  }
});

await test("the dialog's own request, with nothing added, is taken", async () => {
  const { send, after } = await earned();
  const response = await send({});
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(after().level, 2);
  assert.equal(after().maxHp, 20);
  assert.equal(after().xp, 300);
});

// Every key is held: what began as one finding a key (patch-<key>) is one
// rule a key.
for (const [key, row] of Object.entries(ROWS)) {
  await test(`${key}: ${row.rule}`, row.attempt);
}

await test(
  "A spell learned at a level-up is of a level the character has slots for: a wizard of 1st level learns 1st level spells.",
  async () => {
    const { send, after } = await earned({ ...FIGHTER, abilities: { str: 16, int: 14, con: 14 } });
    await send({ levelUpClass: "wizard", levelUpSpells: ["Wish", "Meteor Swarm"] });
    const held = [...(after().spellcasting?.spellbook ?? []), ...(after().spellcasting?.prepared ?? [])];
    assert.ok(!held.includes("Wish"), `a wizard 1 holds ${held.join(", ")}`);
  },
);

first.close();
finish();
