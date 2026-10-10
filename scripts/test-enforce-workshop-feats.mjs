// A feat written in the workshop runs at the table. A renamed copy of a
// published feat runs as that feat (the workshop's "Runs at the table as",
// which "start from" fills in), and a feat of the DM's own words is read
// for what its text grants, as a content pack's is. Before, the engines
// knew a feat only by its published name, so "Headsman's Swing", a copy of
// Great Weapon Master, offered no -5/+10, "Hardy Frame", a copy of Tough,
// added no hit points, and a workshop feat that said "Your speed increases
// by 10 feet" moved nobody (SRD 5.1 and ODM's feats, src/lib/srd/feat-*.ts).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { XP_BY_LEVEL, patchSheetAs } from "./lib/enforce-srd-progression.mjs";

const { test, finish } = suite("test-enforce-workshop-feats");
const { featMechanicsOf } = await import("../src/lib/workshop/catalog-mechanics.ts");
const { draftFromCatalog } = await import("../src/app/workshop/homebrew/draft.ts");
const { speedFor } = await import("../src/lib/srd/index.ts");
const { holdsFeat } = await import("../src/lib/srd/feat-effects.ts");
const { featEngineTag } = await import("../src/lib/srd/feat-combat.ts");
const authored = (await import("../src/lib/srd/authored-feats.json", { with: { type: "json" } })).default.feats;

const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);
const homebrew = await world.route("homebrew");
const sheetRoute = await world.route("campaigns/[campaignId]/sheet");

// "Start from" one of the published feats, renamed and saved by `author`.
async function brewCopy(feat, name, author = world.owner) {
  const row = authored.find((entry) => entry.name === feat);
  const table = featMechanicsOf({ name: row.name, source: "open5e", data: { desc: row.desc, prerequisite: row.prerequisite ?? "" } });
  const { data } = draftFromCatalog("feat", { name: row.name, data: {}, table });
  return brew(name, data, author);
}

async function brew(name, data, author = world.owner) {
  world.signIn(author);
  const response = await homebrew.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ kind: "feat", name, data }) }));
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.entry;
}

const swing = await brewCopy("Great Weapon Master", "Headsman's Swing");
assert.equal(swing.data.runsAs, "Great Weapon Master", "the copy does not say what it runs as");
await brewCopy("Tough", "Hardy Frame");
await brew("Fleetfoot", { desc: "You are quick on your feet. Your speed increases by 10 feet.", prerequisite: "" });

await test("A renamed copy of Great Weapon Master trades -5 to hit for +10 damage with a heavy weapon.", async () => {
  const hero = world.addHero({
    class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
    equipment: [{ name: "Greatsword", qty: 1 }], feats: ["Headsman's Swing"],
  });
  assert.equal(featEngineTag("Headsman's Swing", world.campaignId), "[pc_attack powerAttack]");
  await kit.fight(1, { heroFaces: { [hero.id]: 20 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  const out = await kit.swing(hero.id, enemy.id, [15, 3, 3], { weapon: "Greatsword", powerAttack: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.toHit.total, 15 + abilityMod(16) + proficiencyBonus(5) - 5);
  assert.equal(out.damage.total, 3 + 3 + abilityMod(16) + 10);
  await kit.endFight();
});

await test("A renamed copy of Tough taken at a level-up adds Tough's two hit points a level.", async () => {
  const player = world.addUser("hardy-player");
  const hero = world.addHero({ user: player, class: "fighter", level: 3, maxHp: 28, abilities: { str: 15, dex: 14, con: 14, int: 8, wis: 12, cha: 10 } });
  world.patch(hero.id, { xp: XP_BY_LEVEL[3] });
  const before = world.sheet(hero.id);
  const out = await patchSheetAs(world, sheetRoute, player, {
    level: 4,
    maxHp: before.maxHp + 6 + 2,
    currentHp: before.currentHp + 6 + 2,
    hitDice: { ...before.hitDice, total: 4 },
    asiChoices: [{ mode: "feat", feat: "Hardy Frame" }],
  });
  assert.equal(out.status, 200, out.json.error);
  assert.equal(world.sheet(hero.id).maxHp, before.maxHp + 6 + 2 + 2 * 4, "the copy of Tough added no hit points");
});

await test("A workshop feat of the DM's own words is read for what its text grants: +10 feet of speed.", async () => {
  const hero = world.addHero({ class: "fighter", level: 1, feats: ["Fleetfoot"] });
  const sheet = world.sheet(hero.id);
  assert.equal(speedFor({ ...sheet, features: [...sheet.features, ...sheet.feats.map((name) => ({ name }))] }), 40);
});

await test("A workshop feat is its author's: at another DM's table the same name runs as nothing.", async () => {
  const other = await openWorld();
  const hero = other.addHero({ class: "fighter", level: 5, feats: ["Headsman's Swing"] });
  assert.equal(holdsFeat(other.sheet(hero.id), "Great Weapon Master"), false);
  assert.equal(holdsFeat({ feats: ["Headsman's Swing"], campaignId: world.campaignId }, "Great Weapon Master"), true);
});

finish();
