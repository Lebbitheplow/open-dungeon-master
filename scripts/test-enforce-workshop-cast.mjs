// A member of the Cast fights with a stat block: the DM picks one in the
// workshop (an SRD stat block, such as the Veteran from Appendix B's
// Nonplayer Characters, or one of their own monsters), and starting a fight
// with that NPC by name brings them in as it, under their own name. Before,
// an NPC had no numbers at all; a brawl with "Captain Vey" was whatever
// monster the DM happened to name, and the name was lost.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-workshop-cast");
const { createNpcFromDraft, listNpcs } = await import("../src/lib/db/npcs.ts");
const { normalizeNpcDraft } = await import("../src/lib/npcs/forge.ts");
const { createHomebrewMonster } = await import("../src/lib/bestiary/homebrew-monsters.ts");
const { draftFromCr } = await import("../src/lib/bestiary/monster-draft.ts");
const { generateSettlement } = await import("../src/lib/overworld/settlement.ts");
const { npcRosterForPrompt } = await import("../src/lib/dm/social-tools.ts");

const world = await openWorld({ campaign: { maxPlayers: 6 } });
world.addHero({ class: "fighter", level: 5 });

function castMember(fields) {
  const outcome = normalizeNpcDraft(fields);
  assert.ok("draft" in outcome, outcome.error);
  return createNpcFromDraft(world.campaignId, outcome.draft);
}

const brute = createHomebrewMonster(world.owner.id, { ...draftFromCr("Dockside Brute", 2), stats: { ...draftFromCr("Dockside Brute", 2).stats, maxHp: 47, ac: 15 } }, "");

await test("A Cast member with one of the DM's own stat blocks starts a fight as it, under their own name.", async () => {
  castMember({ name: "Captain Vey", attitude: "hostile", aliases: ["Vey"], statBlock: `homebrew:${brute.id}` });
  const out = await world.invoke("start_encounter", { enemies: [{ monster: "Captain Vey" }] });
  assert.equal(out.ok, true, out.error ?? JSON.stringify(out.result));
  const [enemy] = world.enemies();
  assert.equal(enemy.displayName, "Captain Vey");
  assert.equal(enemy.stats.maxHp, 47);
  assert.equal(enemy.stats.ac, 15);
  await world.invoke("end_encounter", { outcome: "fled" });
});

await test("An alias reaches the same stat block.", async () => {
  const out = await world.invoke("start_encounter", { enemies: [{ monster: "Vey" }] });
  assert.equal(out.ok, true, out.error ?? JSON.stringify(out.result));
  assert.equal(world.enemies()[0].stats.maxHp, 47);
  await world.invoke("end_encounter", { outcome: "fled" });
});

await test("The DM is told what each Cast member fights as.", () => {
  const vey = npcRosterForPrompt(world.campaignId).find((npc) => npc.name === "Captain Vey");
  assert.equal(vey?.statBlock, `homebrew:${brute.id}`);
});

await test("An SRD stat block from the Nonplayer Characters appendix: the Veteran.", async () => {
  if (!world.hasPack) return;
  castMember({ name: "Sergeant Holt", attitude: "hostile", statBlock: "veteran" });
  const out = await world.invoke("start_encounter", { enemies: [{ monster: "Sergeant Holt" }] });
  assert.equal(out.ok, true, out.error ?? JSON.stringify(out.result));
  const [enemy] = world.enemies();
  assert.equal(enemy.displayName, "Sergeant Holt");
  assert.equal(enemy.stats.maxHp, 58, "the SRD Veteran has 58 hit points");
  assert.equal(enemy.stats.ac, 17);
  await world.invoke("end_encounter", { outcome: "fled" });
});

await test("A generated settlement's townsfolk fight as the SRD's stat blocks for their trade.", () => {
  const town = generateSettlement({ name: "Harrowmere", size: "town", seed: 7 });
  const blocks = Object.fromEntries(town.npcs.map((npc) => [npc.role, npc.statBlock]));
  assert.equal(blocks.guard, "guard");
  assert.equal(blocks.priest, "priest");
  assert.equal(blocks.noble, "noble");
  assert.ok(town.npcs.every((npc) => npc.statBlock), "a townsperson has no stat block");
});

await test("A Cast member with no stat block is not a monster: their name alone starts no fight.", async () => {
  castMember({ name: "Old Marta", attitude: "friendly" });
  assert.ok(listNpcs(world.campaignId).some((npc) => npc.name === "Old Marta" && npc.statBlock === ""));
  const out = await world.invoke("start_encounter", { enemies: [{ monster: "Old Marta" }] });
  assert.ok(out.error || out.result?.error, "an NPC with no stat block became an enemy");
});

finish();
