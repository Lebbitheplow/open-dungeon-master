// "Is this legal at this table?" The validator the workshop plan deferred
// twice: findings for an item, a spell, a monster or a map against the
// selected ruleset. See docs/workshop-parity-audit.md phase 11.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { averageOf, validateDraft, worstLevel } = await import("../src/lib/rulesets/validate.ts");
const { draftFromCr } = await import("../src/lib/bestiary/monster-draft.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const plain = { variantRules: {} };
const texts = (findings) => findings.map((finding) => finding.text).join(" | ");

test("averageOf reads dice and flat parts", () => {
  assert.equal(averageOf("1d8"), 4.5);
  assert.equal(averageOf("2d6+3"), 10);
  assert.equal(averageOf("2d10+8+2d6"), 26);
  assert.equal(averageOf("lots"), null);
});

test("a mundane weapon harder-hitting than any in the SRD is a warning, not a refusal", () => {
  const findings = validateDraft(plain, {
    kind: "item",
    item: { name: "Doom axe", itemKind: "weapon", weapon: { name: "Doom axe", category: "martial", kind: "melee", damage: "3d8 slashing" } },
  });
  assert.equal(worstLevel(findings), "warn");
  assert.ok(texts(findings).includes("3d8"));
  const fine = validateDraft(plain, {
    kind: "item",
    item: { name: "Longsword", itemKind: "weapon", weapon: { name: "Longsword", category: "martial", kind: "melee", damage: "1d8 slashing" } },
  });
  assert.equal(fine.length, 0);
});

test("heavy and light together is an error; ammunition is only a note when the table counts it", () => {
  const both = validateDraft(plain, {
    kind: "item",
    item: { name: "Odd", itemKind: "weapon", weapon: { name: "Odd", category: "simple", kind: "melee", damage: "1d6 bludgeoning", properties: ["heavy", "light"] } },
  });
  assert.equal(worstLevel(both), "error");
  const bow = { name: "Bow", itemKind: "weapon", weapon: { name: "Bow", category: "simple", kind: "ranged", damage: "1d6 piercing", rangeFt: 80 } };
  assert.equal(validateDraft(plain, { kind: "item", item: bow }).length, 0);
  const counted = validateDraft({ variantRules: { ammunition: true } }, { kind: "item", item: bow });
  assert.equal(worstLevel(counted), "note");
  assert.ok(texts(counted).includes("ammunition"));
});

test("armour findings follow the SRD's own patterns", () => {
  const plate = validateDraft(plain, {
    kind: "item",
    item: { name: "Sky plate", itemKind: "armor", armor: { name: "Sky plate", category: "heavy", baseAc: 20, weightLb: 60 } },
  });
  assert.equal(worstLevel(plate), "warn");
  assert.ok(texts(plate).includes("Strength requirement"));
  assert.ok(texts(plate).includes("Stealth"));
  const weightless = validateDraft(
    { variantRules: { encumbrance: true } },
    { kind: "item", item: { name: "Mist mail", itemKind: "armor", armor: { name: "Mist mail", category: "medium", baseAc: 14, dexCap: 2, weightLb: 0 } } },
  );
  assert.ok(texts(weightless).includes("weighs"));
});

// docs/workshop-rulebook-audit-pr169.md F13: no false deviation on the SRD's
// own rows, and the magic the workshop authors is measured too.
test("an unchanged SRD suit or shield draws no false finding", () => {
  const ringMail = validateDraft(plain, {
    kind: "item",
    item: { name: "Ring Mail", itemKind: "armor", armor: { name: "Ring Mail", category: "heavy", baseAc: 14, stealthDisadvantage: true, weightLb: 40 } },
  });
  assert.ok(!texts(ringMail).includes("Strength"), texts(ringMail));
  const shieldPlusThree = validateDraft(plain, {
    kind: "item",
    item: { name: "Shield, +3", itemKind: "magic_item", armor: { name: "Shield", category: "shield", baseAc: 2, weightLb: 6 }, armorRiders: { bonus: 3 } },
  });
  assert.equal(worstLevel(shieldPlusThree), null, texts(shieldPlusThree));
  const baseFour = validateDraft(plain, {
    kind: "item",
    item: { name: "Tower", itemKind: "armor", armor: { name: "Tower", category: "shield", baseAc: 4, weightLb: 15 } },
  });
  assert.ok(texts(baseFour).includes("magic bonus"), texts(baseFour));
  assert.ok(!texts(baseFour).includes("magical ones included"));
});

test("riders, charges, checks, item spells and curses are measured against the SRD", () => {
  const brutal = validateDraft(plain, {
    kind: "item",
    item: {
      name: "Brute blade",
      itemKind: "magic_item",
      rarity: "uncommon",
      weaponRiders: { bonus: 5, extra: [{ dice: "4d10", type: "fire" }, { dice: "1d6", type: "shadow" }] },
      armorRiders: { bonus: 4 },
      charges: { max: 80 },
      checks: { bonus: 3, skillBonus: { stealth: 9 } },
      spells: [{ spell: "Wish", charges: 1, level: 9 }],
      cursed: true,
      effects: [{ kind: "resistance", types: ["shadow"] }],
    },
  });
  const said = texts(brutal);
  for (const expected of ["+5 to hit", "4d10", "\"shadow\" is not one of the 13 damage types", "+4 AC", "80 charges", "never come back", "+3 to every check", "+9 to stealth", "Casts Wish at level 9", "Cursed", "Resistance to shadow"]) {
    assert.ok(said.includes(expected), `missing "${expected}" in: ${said}`);
  }
  const flameTongue = validateDraft(plain, {
    kind: "item",
    item: { name: "Flame Tongue", itemKind: "magic_item", rarity: "rare", requiresAttunement: true, weaponRiders: { extra: [{ dice: "2d6", type: "fire" }] } },
  });
  assert.equal(worstLevel(flameTongue), null, texts(flameTongue));
});

test("a spell that lays a condition the engine has no rules for says so", () => {
  const made = validateDraft(plain, {
    kind: "spell",
    spell: { name: "Gloom", level: 2, desc: "The target must succeed on a Wisdom saving throw.", mech: { resolution: "save", save: "wis", condition: { name: "glumly" } } },
  });
  assert.ok(texts(made).includes("no rules for \"glumly\""), texts(made));
  const web = validateDraft(plain, {
    kind: "spell",
    spell: { name: "Silkbind", level: 2, desc: "Each creature must make a Dexterity saving throw or be restrained.", mech: { resolution: "save", save: "dex", condition: { name: "restrained" } } },
  });
  assert.ok(!texts(web).includes("no rules"), texts(web));
});

test("magic item effects beyond the books are warnings; stacked effects without attunement a note", () => {
  const strong = validateDraft(plain, {
    kind: "item",
    item: { name: "Ring", itemKind: "magic_item", effects: [{ kind: "ac_bonus", amount: 4 }], requiresAttunement: true },
  });
  assert.equal(worstLevel(strong), "warn");
  const stacked = validateDraft(plain, {
    kind: "item",
    item: { name: "Ring", itemKind: "magic_item", effects: [{ kind: "ac_bonus", amount: 1 }, { kind: "save_bonus", amount: 1 }], requiresAttunement: false },
  });
  assert.equal(worstLevel(stacked), "note");
  assert.ok(texts(stacked).includes("attunement"));
});

test("a spell's damage is read from its prose and compared to the DMG guideline", () => {
  const hot = validateDraft(plain, {
    kind: "spell",
    spell: { name: "Sun lance", level: 1, desc: "The target takes 8d10 radiant damage." },
  });
  assert.equal(worstLevel(hot), "warn");
  assert.ok(texts(hot).includes("8d10"));
  const fine = validateDraft(plain, {
    kind: "spell",
    spell: { name: "Bolt", level: 1, desc: "The target takes 2d10 force damage." },
  });
  assert.equal(fine.length, 0);
  const area = validateDraft(plain, {
    kind: "spell",
    spell: { name: "Burst", level: 3, desc: "Each creature in a 20-foot radius takes 6d6 fire damage." },
  });
  assert.equal(area.length, 0, "6d6 is exactly the multi-target guideline at level 3");
});

test("a spell block without a save ability, or attack damage without dice, is an error", () => {
  const noSave = validateDraft(plain, {
    kind: "spell",
    spell: { name: "Hex", level: 1, desc: "The target is cursed.", mech: { resolution: "save" } },
  });
  assert.equal(worstLevel(noSave), "error");
  const noDice = validateDraft(plain, {
    kind: "spell",
    spell: { name: "Zap", level: 0, desc: "A bolt of lightning strikes.", mech: { resolution: "attack" } },
  });
  assert.equal(worstLevel(noDice), "error");
  assert.ok(texts(noDice).includes("2d8"));
});

test("concentration on an instant spell and higher-level text on a cantrip are notes", () => {
  const findings = validateDraft(plain, {
    kind: "spell",
    spell: { name: "Snap", level: 0, desc: "The target takes 1d8 cold damage.", duration: "Instantaneous", concentration: true, higherLevel: "More." },
  });
  assert.equal(worstLevel(findings), "note");
  assert.equal(findings.length, 2);
});

test("a monster whose rating disagrees with its numbers is warned about", () => {
  const draft = draftFromCr("Ogre-ish", 2);
  assert.equal(validateDraft(plain, { kind: "monster", monster: draft }).length, 0, "a monster built from its CR agrees with it");
  const inflated = { ...draft, stats: { ...draft.stats, cr: 10, xp: 5900 } };
  const findings = validateDraft(plain, { kind: "monster", monster: inflated });
  assert.equal(worstLevel(findings), "warn");
  assert.ok(texts(findings).includes("CR 10"));
  const broken = { ...draft, stats: { ...draft.stats, attacks: [{ name: "Bite", toHit: 4, damage: "1dx", type: "piercing" }] } };
  assert.equal(worstLevel(validateDraft(plain, { kind: "monster", monster: broken })), "error");
});

test("a map with a sealed pocket, or no lights in the dark, says so", () => {
  const width = 10;
  const height = 6;
  const tiles = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      tiles.push(x === 0 || y === 0 || x === width - 1 || y === height - 1 || x === 5 ? "#" : ".");
    }
  }
  const terrain = tiles.join("");
  const findings = validateDraft(plain, { kind: "map", map: { terrain, width, height, ambient: "dark", lights: [] } });
  assert.equal(worstLevel(findings), "warn");
  assert.ok(texts(findings).includes("sealed pocket"));
  assert.ok(texts(findings).includes("Dark"));
  const open = tiles.map((ch, index) => (index === 3 * width + 5 ? "+" : ch)).join("");
  const joined = validateDraft(plain, { kind: "map", map: { terrain: open, width, height, ambient: "bright", lights: [] } });
  assert.equal(joined.length, 0);
  const solid = validateDraft(plain, { kind: "map", map: { terrain: "#".repeat(width * height), width, height, ambient: "bright", lights: [] } });
  assert.equal(worstLevel(solid), "error");
});

console.log(`test-ruleset-validate: ${passed} passed`);
