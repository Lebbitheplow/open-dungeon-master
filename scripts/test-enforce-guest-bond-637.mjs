// Issue 637: a town NPC the GM drafted as a guest ally for one fight was
// marked "parted" when the fight ended, so romance_advance and an NPC's first
// move refused them as "not with the party right now" while they stood in the
// same town. A guest who is someone from the world goes back to being that
// NPC with their bond as it was; anyone who really leaves is still parted.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-guest-bond-637");
const npcs = await import("../src/lib/db/npcs.ts");
const relationships = await import("../src/lib/db/relationships.ts");
const { dismissGuestCompanions } = await import("../src/lib/dm/companion-tools.ts");

async function table() {
  const world = await openWorld({ gameSettings: { companions: "full" } });
  const hero = world.addHero({ name: "Tamsin", gender: "Female" });
  const bond = (subject) => relationships.getRelationship(world.campaignId, hero.id, subject);
  return { world, hero, bond };
}

function companionSheet(world, name) {
  return world.sheets().find((sheet) => sheet.isCompanion && sheet.name === name) ?? null;
}

await test("a town NPC who fought beside the party as a guest keeps an active bond when the fight ends", async () => {
  const { world, hero, bond } = await table();
  const npc = npcs.upsertNpc({ campaignId: world.campaignId, name: "Corwin Hale", attitude: "friendly", gender: "Male" });
  npcs.markNpcMet(npc.id);
  const before = relationships.ensureRelationship({
    campaignId: world.campaignId,
    characterId: hero.id,
    characterName: hero.name,
    subjectKind: "npc",
    subjectName: "Corwin Hale",
    subjectId: npc.id,
  });
  relationships.patchRelationship(before.id, { approval: 6 });

  const added = await world.invoke("add_companion", { name: "Corwin Hale", class: "artificer", gender: "Male", personality: "Earnest lamplighter.", kind: "guest" });
  assert.equal(added.ok, true, added.error);
  assert.ok(companionSheet(world, "Corwin Hale"), "Corwin fights as a guest");

  assert.deepEqual(dismissGuestCompanions(world.campaign(), "the fight ended"), ["Corwin Hale"]);
  assert.equal(companionSheet(world, "Corwin Hale"), null, "the guest sheet goes when the fight ends");
  const after = bond("Corwin Hale");
  assert.equal(after.status, "active", "Corwin is still in town, so the bond is not parted");
  assert.equal(after.approval, 6, "what Tamsin built with him is kept");
  assert.equal(after.subjectKind, "npc");
  assert.equal(after.subjectId, npc.id, "the bond still points at Corwin's NPC row");
});

await test("a guest with no place in the world leaves for real, and their bond parts", async () => {
  const { world, hero, bond } = await table();
  const added = await world.invoke("add_companion", { name: "Dace", class: "fighter", gender: "Male", personality: "Hired blade.", kind: "guest" });
  assert.equal(added.ok, true, added.error);
  relationships.ensureRelationship({
    campaignId: world.campaignId,
    characterId: hero.id,
    characterName: hero.name,
    subjectKind: "companion",
    subjectName: "Dace",
    subjectId: companionSheet(world, "Dace").id,
  });
  dismissGuestCompanions(world.campaign(), "the fight ended");
  assert.equal(bond("Dace").status, "parted");
});

await test("a companion dismissed from the party is still parted, and stays parted after a guest return", async () => {
  const { world, bond } = await table();
  const added = await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern and devout.", kind: "party" });
  assert.equal(added.ok, true, added.error);
  assert.equal(bond("Seren").status, "active");
  const dismissed = await world.invoke("dismiss_companion", { characterId: companionSheet(world, "Seren").id, reason: "parted ways" });
  assert.equal(dismissed.ok, true, dismissed.error);
  assert.equal(bond("Seren").status, "parted", "a companion who walks out is parted");

  // Back for one fight as a guest: with the party again, then away again.
  const guest = await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern and devout.", kind: "guest" });
  assert.equal(guest.ok, true, guest.error);
  assert.equal(bond("Seren").status, "active", "the bond opens while she fights beside them");
  dismissGuestCompanions(world.campaign(), "the fight ended");
  assert.equal(bond("Seren").status, "parted", "she leaves as she came: apart from the party");
});

finish();
