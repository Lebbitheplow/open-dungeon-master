// Structured spell mechanics: every authored spell classifies into a
// resolution bucket, every referenced buff condition has real mechanics (a
// registry row or an SRD condition), and the prose parsers read the SRD's
// regular phrasing. This is the guard that keeps new spells from landing
// with no engine behind them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { MECH_OVERRIDES, parseSpellMech, spellMechFor } = await import(
  "../src/lib/srd/spell-mechanics.ts"
);
const {
  attackKindFor,
  conditionAppliedFor,
  damageTypeFor,
  halfOnSaveFor,
  saveAbilityFor,
} = await import("../src/lib/srd/spell-scaling.ts");
const { conditionEffectsFor } = await import("../src/lib/srd/condition-effects.ts");
const { castRedirect } = await import("../src/lib/dm/cast-tools.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib");
const spells = JSON.parse(readFileSync(join(srcDir, "srd", "authored-spells.json"), "utf8")).spells;

const RESOLUTIONS = new Set(["attack", "save", "auto", "heal", "buff", "summon", "utility"]);
// SRD conditions carry their mechanics in condition-logic.ts, not the
// registry; a buff pointing at one is still fully enforced.
const SRD_CONDITIONS = new Set([
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated",
  "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained",
  "stunned", "unconscious",
]);

function assertBuffEnforced(spellName, buffCondition) {
  const bare = buffCondition.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
  assert.ok(
    conditionEffectsFor(buffCondition) || SRD_CONDITIONS.has(bare),
    `${spellName}: buff condition "${buffCondition}" has no registry row and is no SRD condition`,
  );
}

test("every authored spell classifies into a resolution bucket", () => {
  for (const spell of spells) {
    const mech =
      spellMechFor([spell.name]) ??
      parseSpellMech({ desc: spell.desc, higherLevel: spell.higher_level ?? "" });
    assert.ok(mech, `${spell.name} resolves to nothing; author a mech block for it`);
    assert.ok(RESOLUTIONS.has(mech.resolution), `${spell.name}: unknown resolution ${mech.resolution}`);
    if (mech.resolution === "save") {
      assert.ok(mech.save, `${spell.name} is a save spell with no save ability`);
    }
    if (mech.resolution === "buff") {
      assert.ok(mech.buff, `${spell.name} is a buff with no buff payload`);
    }
    if (mech.buff) {
      assertBuffEnforced(spell.name, mech.buff.condition);
      for (const variant of mech.buff.variants ?? []) {
        assertBuffEnforced(spell.name, variant);
      }
      assert.ok(mech.buff.rounds >= 1, `${spell.name}: buff without a duration`);
      assert.ok(
        ["self", "ally", "allies"].includes(mech.buff.target),
        `${spell.name}: bad buff target`,
      );
    }
  }
});

test("every override references enforceable conditions too", () => {
  for (const [name, mech] of Object.entries(MECH_OVERRIDES)) {
    assert.ok(RESOLUTIONS.has(mech.resolution), `${name}: unknown resolution`);
    if (mech.buff) {
      assertBuffEnforced(name, mech.buff.condition);
      for (const variant of mech.buff.variants ?? []) {
        assertBuffEnforced(name, variant);
      }
    }
    if (mech.condition) {
      const bare = mech.condition.name.toLowerCase();
      assert.ok(
        SRD_CONDITIONS.has(bare) || conditionEffectsFor(bare),
        `${name}: applied condition "${bare}" is neither SRD nor registry`,
      );
    }
  }
});

test("save parser reads the SRD phrasing", () => {
  assert.equal(
    saveAbilityFor("Each creature in a 20-foot radius must make a Dexterity saving throw."),
    "dex",
  );
  assert.equal(saveAbilityFor("It must succeed on a Wisdom saving throw or be frightened."), "wis");
  assert.equal(saveAbilityFor("You strike true."), null);
});

test("half-on-save parser reads both phrasings", () => {
  assert.ok(halfOnSaveFor("taking 8d6 fire damage on a failed save, or half as much damage on a successful one."));
  assert.ok(halfOnSaveFor("taking 3d8 fire damage on a failure and half as much on a success."));
  assert.ok(!halfOnSaveFor("or be knocked prone on a failure."));
});

test("damage type and condition parsers", () => {
  assert.equal(damageTypeFor("takes 4d6 lightning damage and is pushed"), "lightning");
  assert.equal(damageTypeFor("regains hit points"), null);
  assert.equal(conditionAppliedFor("or be poisoned for 1 minute"), "poisoned");
  assert.equal(conditionAppliedFor("and is knocked prone"), "prone");
  assert.equal(conditionAppliedFor("takes fire damage"), null);
  assert.equal(attackKindFor("Make a ranged spell attack against the target."), "ranged");
});

test("castRedirect aims each resolution at its tool", () => {
  const mk = (resolution) => ({ mech: { resolution }, name: "X", spellLevel: 1, concentration: false });
  assert.equal(castRedirect(null, "save"), null);
  assert.equal(castRedirect(mk("save"), "save"), null);
  assert.ok(castRedirect(mk("attack"), "save")?.includes("pc_attack"));
  assert.ok(castRedirect(mk("buff"), "save")?.includes("cast_buff"));
  assert.ok(castRedirect(mk("save"), "attack")?.includes("cast_at_enemy"));
  assert.ok(castRedirect(mk("heal"), "buff")?.includes("heal"));
  // Magic Missile through cast_at_enemy is tolerated (no save rolls).
  assert.equal(castRedirect(mk("auto"), "save"), null);
  assert.ok(castRedirect(mk("auto"), "attack"));
});

test("authored buff staples resolve with their real payloads", () => {
  const shadowBlade = spellMechFor(["Shadow Blade"]);
  assert.equal(shadowBlade.resolution, "buff");
  assert.ok(conditionEffectsFor(shadowBlade.buff.condition).grantedAttack);
  const agathys = spellMechFor(["Armor of Agathys"]);
  assert.equal(agathys.buff.tempHp.base, 5);
  assert.equal(agathys.buff.tempHp.perSlotLevel, 5);
  const bless = spellMechFor(["Bless"]);
  assert.equal(bless.buff.condition, "blessed");
  assert.equal(conditionEffectsFor("blessed").attackDie, "1d4");
});

console.log(`test-spell-mechanics: ${passed} tests passed`);
