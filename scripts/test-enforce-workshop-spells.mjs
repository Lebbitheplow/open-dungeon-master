// A spell written in the workshop resolves by the block it carries, the
// same way a published spell resolves by the SRD's (SRD 5.1, Spellcasting:
// Saving Throws, Attack Rolls, Areas of Effect, Combining Magical Effects).
// The homebrew boundary used to keep five fields of a spell's mechanics, and
// a copy of a published spell started with none of them: a renamed Web was
// read from its prose alone and lost its escape check, and the escape, the
// turn-end saves and the auras of a homebrew spell were looked up without
// the table's authors, so they found nothing. A monster built in the
// workshop that knew a homebrew spell could not cast it at all.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, enemyOf, table } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-enforce-workshop-spells");
const { spellMechanicsFor } = await import("../src/lib/content/index.ts");
const { draftFromCatalog } = await import("../src/app/workshop/homebrew/draft.ts");
const { checkSpellMech } = await import("../src/lib/homebrew/spell-mech-schema.ts");

// The SRD 5.1 text of Web, as the content pack stores it.
const WEB = {
  name: "Web",
  level: 2,
  school: "conjuration",
  data: {
    desc: "You conjure a mass of thick, sticky webbing at a point of your choice within range. The webs fill a 20-foot cube from that point for the duration. The webs are difficult terrain and lightly obscure their area.\n\nIf the webs aren't anchored between two solid masses (such as walls or trees) or layered across a floor, wall, or ceiling, the conjured web collapses on itself, and the spell ends at the start of your next turn. Webs layered over a flat surface have a depth of 5 feet.\n\nEach creature that starts its turn in the webs or that enters them during its turn must make a Dexterity saving throw. On a failed save, the creature is restrained as long as it remains in the webs or until it breaks free.\n\nA creature restrained by the webs can use its action to make a Strength check against your spell save DC. If it succeeds, it is no longer restrained.\n\nThe webs are flammable. Any 5-foot cube of webs exposed to fire burns away in 1 round, dealing 2d4 fire damage to any creature that starts its turn in the fire.",
    level_int: 2,
    classes: [{ name: "Sorcerer" }, { name: "Wizard" }],
    concentration: true,
    casting_time: "1 action",
    range: "60 feet",
    components: "V, S, M",
    duration: "Up to 1 hour",
  },
};

// The copy a DM gets from "start from" Web, renamed: what CatalogStart hands
// draftFromCatalog, the published block included.
function silkbindData() {
  const mech = spellMechanicsFor({ spell: "Web" })?.mech;
  assert.ok(mech, "the engine has no block for Web");
  const draft = draftFromCatalog("spell", { ...WEB, mech });
  return draft.data;
}

async function brew(world, name, data) {
  const route = await world.route("homebrew");
  world.signIn(world.owner);
  return call(route, "POST", { kind: "spell", name, data });
}

await test("A renamed copy of Web keeps the published block: restrained on a failed DEX save, no fire, and a STR check to break free.", async () => {
  const data = silkbindData();
  assert.deepEqual(data.mech.condition.escape, ["str"], "the copy did not carry Web's escape check");
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Silkbind"])]);
  const made = await brew(world, "Silkbind", data);
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.deepEqual(made.json.entry.data.mech.condition.escape, ["str"]);
  world.dice(1, 4, 4);
  const out = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Silkbind", saveAbility: "dex", level: 2 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const held = enemyOf(world, goblin.id);
  assert.ok(held.conditions.includes("restrained"), "Silkbind did not restrain");
  assert.equal(held.currentHp, held.maxHp, "Silkbind dealt damage");
  assert.equal(held.conditionMeta.restrained?.spell, "Silkbind");
  const { enemySpellHold } = await import("../src/lib/dm/spell-escape.ts");
  assert.equal(enemySpellHold(world.campaign(), held), true, "the hold was not read from the homebrew spell");
});

await test("A monster built in the workshop casts the table's homebrew spell from its own list, at its own DC.", async () => {
  const data = silkbindData();
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", [])]);
  assert.equal((await brew(world, "Silkbind", data)).status, 201);
  const stats = {
    ...goblin.stats,
    spells: ["Silkbind"],
    spellcasting: { dc: 14, attack: 6, ability: "int", casterLevel: 5, slots: { 2: 2 }, spells: [{ name: "Silkbind", level: 2 }] },
  };
  // Stage the block the way start_encounter writes one (enforce-combat's setEnemy).
  const { combatKit } = await import("./lib/enforce-combat.mjs");
  const kit = await combatKit(world);
  kit.setEnemy(goblin.id, { stats });
  kit.freshRound();
  world.dice(1);
  const out = await world.invoke("cast_at_player", { characterId: wizard.id, casterEnemyId: goblin.id, spell: "Silkbind", saveAbility: "wis", dc: 5 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(wizard.id).conditions.includes("restrained"), "the homebrew spell did not restrain");
});

await test("A spell block the engine could not run is refused when it is saved, naming the field.", async () => {
  const { world } = await table([caster("wizard", "int", [])]);
  const bad = await brew(world, "Broken Bolt", {
    desc: "A bolt.",
    level: 1,
    mech: { resolution: "save", save: "dex", dice: { base: "banana", baseLevel: 1 } },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /dice\.base/);
  assert.ok("error" in checkSpellMech({ resolution: "save", save: "dex", aura: { radiusFeet: 10, save: "wis", dice: "9d999x", baseLevel: 3, type: "fire", halfOnSave: true } }));
});

await closeTables();
finish();
