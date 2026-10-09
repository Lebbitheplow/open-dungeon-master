// Whose workshop content a table admits, what forgetting an entry does to
// what already carries it, what a browser remembers between tables, and
// what the catalog serves with no content pack
// (docs/workshop-rulebook-audit-pr169.md F04, F06, F07, F08).
//
//   - One scope everywhere: at a table, the shelves of whoever runs it (its
//     owner, its human DM and its assistant DM seats). A player's picker
//     offers the DM's custom feat, the server's legality check admits it,
//     and a DM seat's monster fights; a player's own entry is offered
//     nowhere at the table and the picker says so.
//   - Forgetting an entry archives it: pickers drop it, a sheet that carries
//     it keeps its rules; bringing it back restores it; deleting it for good
//     leaves the sheet the name alone, as the dialog says.
//   - The browser keeps each table's feats apart and drops what a table's
//     snapshot no longer names.
//   - With no pack the catalog still serves the bundled book's spells, magic
//     items, mundane gear and races, and their info reads.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { call } from "./lib/enforce-campaign.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { hasPack, openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-workshop-scope");
const campaigns = await import("../src/lib/db/campaigns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { hydrateHomebrewGear, listHomebrew } = await import("../src/lib/db/homebrew.ts");
const { createHomebrewMonster } = await import("../src/lib/bestiary/homebrew-monsters.ts");
const { draftFromCr } = await import("../src/lib/bestiary/monster-draft.ts");
const { legalityContextFor } = await import("../src/lib/characters/catalog.ts");

const world = await openWorld({ campaign: { maxPlayers: 8 } });
const content = await world.route("content/[kind]");
const detail = await world.route("content/[kind]/[slug]");
const homebrew = await world.route("homebrew");
const one = await world.route("homebrew/[id]");

// A seat at the table: a hero and the player who owns it.
function seat(name) {
  const sheet = world.addHero({ name, class: "fighter", level: 3 });
  return { id: sheet.userId, sheet };
}
world.addHero({ name: "Owner's hero", class: "fighter", level: 3 });
const player = seat("Player");
const assistant = seat("Assistant");
const dm = seat("Human DM");
getDatabase().prepare("UPDATE campaigns SET assistant_dm_user_id = ? WHERE id = ?").run(assistant.id, world.campaignId);
assert.equal(campaigns.setHumanDm(world.campaignId, dm.id), true);

async function keep(user, kind, name, data) {
  world.signIn(user);
  const out = await call(homebrew, "POST", { kind, name, data });
  assert.equal(out.status, 201, `${name}: ${JSON.stringify(out.json)}`);
  return out.json.entry;
}

async function search(user, kind, q, { atTable = true, mechanics = false } = {}) {
  world.signIn(user);
  const query = new URLSearchParams({ q, limit: "40", ...(atTable ? { campaign: world.campaignId } : {}), ...(mechanics ? { mechanics: "1" } : {}) });
  const out = await call(content, "GET", undefined, { kind }, `http://test/api/content/${kind}?${query}`);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  return out.json;
}

const FEAT = (runsAs) => ({ desc: "You have practiced long shots.", prerequisite: "", runsAs });
await keep(world.owner, "feat", "Audit Marksman", FEAT("Sharpshooter"));
await keep({ id: assistant.id }, "feat", "Assistant Gambit", FEAT("Alert"));
await keep({ id: dm.id }, "feat", "Seat Feint", FEAT("Alert"));
await keep({ id: player.id }, "feat", "Player Trick", FEAT("Lucky"));

await test("F04: a player's picker at the table offers the feats of the owner, the human DM and the assistant DM.", async () => {
  for (const name of ["Audit Marksman", "Assistant Gambit", "Seat Feint"]) {
    const body = await search({ id: player.id }, "feats", name);
    assert.ok(body.results.some((row) => row.name === name && row.source === "homebrew"), `${name} is not offered at the table`);
  }
});

await test("F04: away from the table the player's picker offers their own shelf, not the DM's.", async () => {
  const body = await search({ id: player.id }, "feats", "Audit Marksman", { atTable: false });
  assert.ok(!body.results.some((row) => row.name === "Audit Marksman"), "the DM's feat leaked into the player's library");
  assert.ok((await search({ id: player.id }, "feats", "Player Trick", { atTable: false })).results.some((row) => row.name === "Player Trick"));
});

await test("F04: a player's own feat is not offered at the table, and the picker names it as not admitted.", async () => {
  const body = await search({ id: player.id }, "feats", "Player Trick");
  assert.ok(!body.results.some((row) => row.name === "Player Trick"), "an unadmitted feat was offered");
  assert.deepEqual(body.unadmitted, ["Player Trick"]);
});

await test("F04: the server's legality check at the table admits what the picker offered and refuses what it did not.", () => {
  const context = legalityContextFor({ userId: player.id, campaign: world.campaign(), sheet: player.sheet, level: 4, door: "table" });
  assert.ok(context.featOf("Audit Marksman"), "the DM's feat was refused at creation");
  assert.ok(context.featOf("Seat Feint"), "the human DM's feat was refused at creation");
  assert.equal(context.featOf("Player Trick"), null, "the player's unadmitted feat was admitted");
});

await test("F04: a human DM seat's own monster fights by name; a player's does not.", async () => {
  createHomebrewMonster(dm.id, { ...draftFromCr("Bog Lurker", 2), stats: { ...draftFromCr("Bog Lurker", 2).stats, maxHp: 33, ac: 14 } }, "");
  createHomebrewMonster(player.id, { ...draftFromCr("Pocket Drake", 2), stats: { ...draftFromCr("Pocket Drake", 2).stats, maxHp: 77 } }, "");
  const out = await world.invoke("start_encounter", { enemies: [{ monster: "Bog Lurker" }] });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual([world.enemies()[0].stats.maxHp, world.enemies()[0].stats.ac], [33, 14], "the DM seat's monster did not resolve");
  await world.invoke("end_encounter", { outcome: "fled" });
  const theirs = await world.invoke("start_encounter", { enemies: [{ monster: "Pocket Drake" }] });
  assert.ok(!theirs.ok || world.enemies().every((enemy) => enemy.stats.maxHp !== 77), "a player's monster fought at the table");
  if (theirs.ok) await world.invoke("end_encounter", { outcome: "fled" });
});

// ---- forgetting ----

await test("F06: forgetting an item keeps its rules on a sheet that carries it; bringing it back restores it; deleting it for good leaves the name.", async () => {
  const ring = await keep(world.owner, "item", "Ring of Warding", { desc: "A band of cold iron.", itemKind: "magic_item", rarity: "uncommon", requiresAttunement: false, effects: [{ kind: "ac_bonus", amount: 1 }] });
  const carried = [{ name: "Ring of Warding", qty: 1, slug: `homebrew:${ring.id}`, equipped: true }];
  const gear = () => hydrateHomebrewGear(world.owner.id, carried, { campaignId: world.campaignId })[0].gear;
  assert.equal(gear()?.magic?.effects?.[0]?.amount, 1, "the fixture ring has no effect");
  world.signIn(world.owner);
  const forgot = await call(one, "DELETE", undefined, { id: ring.id }, `http://test/api/homebrew/${ring.id}`);
  assert.equal(forgot.status, 200, JSON.stringify(forgot.json));
  assert.ok(!listHomebrew(world.owner.id, "item").some((entry) => entry.id === ring.id), "the forgotten ring is still on the shelf");
  assert.ok(!(await search(world.owner, "items", "Ring of Warding")).results.some((row) => row.name === "Ring of Warding"), "a picker still offers the forgotten ring");
  assert.equal(gear()?.magic?.effects?.[0]?.amount, 1, "the sheet's ring lost its rules when the entry was forgotten");
  const listed = await call(homebrew, "GET", undefined, {}, "http://test/api/homebrew?archived=1");
  assert.ok(JSON.stringify(listed.json).includes("Ring of Warding"), "the forgotten ring is not listed to bring back");
  const back = await call(one, "POST", { restore: true }, { id: ring.id }, `http://test/api/homebrew/${ring.id}`);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.ok(listHomebrew(world.owner.id, "item").some((entry) => entry.id === ring.id), "the ring did not come back");
  const purged = await call(one, "DELETE", undefined, { id: ring.id }, `http://test/api/homebrew/${ring.id}?purge=1`);
  assert.equal(purged.status, 200, JSON.stringify(purged.json));
  assert.equal(gear(), undefined, "a ring deleted for good still carries rules");
});

// ---- no pack ----

await test("F08: the catalog answers with or without the pack, and says which; with none it serves the bundled book whole.", async () => {
  const feats = await search(world.owner, "feats", "Audit", { mechanics: true });
  assert.equal(feats.packInstalled, hasPack);
  assert.ok(feats.results.some((row) => row.name === "Audit Marksman"), "the table's own feat is missing");
  if (hasPack) return;
  const rows = async (kind, q) => (await search(world.owner, kind, q, { mechanics: true })).results;
  const web = (await rows("spells", "Web")).find((row) => row.name === "Web");
  assert.ok(web?.mech, "no bundled Web, or no block with it");
  assert.ok((await rows("items", "Flame Tongue")).some((row) => row.name === "Flame Tongue"), "no bundled magic item");
  const sword = (await rows("items", "Longsword")).find((row) => row.name === "Longsword");
  assert.equal(sword?.weight, 3, "no bundled longsword at 3 lb");
  assert.ok(sword?.gear?.weapon, "the bundled longsword carries no weapon block");
  assert.ok((await rows("races", "hill dwarf")).some((row) => /dwarf/i.test(row.name)), "no bundled hill dwarf");
  world.signIn(world.owner);
  for (const [kind, slug] of [["spells", web.slug], ["items", sword.slug]]) {
    const out = await call(detail, "GET", undefined, { kind, slug }, `http://test/api/content/${kind}/${encodeURIComponent(slug)}`);
    assert.equal(out.status, 200, `${slug}: ${JSON.stringify(out.json)}`);
  }
});

// ---- the browser's feats, table by table ----

await test("F07: in one browser, two tables' feats of one name run as their own table's, and a table's snapshot drops what it no longer names.", async () => {
  globalThis.window ??= {};
  try {
    const { registerBrowserTableFeats, forgetBrowserTableFeats, holdsFeat } = await import("../src/lib/srd/feat-effects.ts");
    const at = (campaignId) => ({ feats: ["Deadeye"], campaignId });
    registerBrowserTableFeats({ Deadeye: { runsAs: "Sharpshooter", desc: "" } }, "table-a", { replace: true });
    registerBrowserTableFeats({}, "table-b", { replace: true });
    assert.equal(holdsFeat(at("table-a"), "Sharpshooter"), true);
    assert.equal(holdsFeat(at("table-b"), "Sharpshooter"), false, "table A's feat leaked into table B");
    registerBrowserTableFeats({ Deadeye: { runsAs: "Great Weapon Master", desc: "" } }, "table-b", { replace: true });
    assert.equal(holdsFeat(at("table-b"), "Great Weapon Master"), true);
    assert.equal(holdsFeat(at("table-a"), "Great Weapon Master"), false);
    registerBrowserTableFeats({}, "table-a", { replace: true });
    assert.equal(holdsFeat(at("table-a"), "Sharpshooter"), false, "a feat the table's snapshot dropped still runs");
    registerBrowserTableFeats({ Deadeye: null }, "table-b");
    assert.equal(holdsFeat(at("table-b"), "Great Weapon Master"), false, "a feat given as removed still runs");
    registerBrowserTableFeats({ Deadeye: { runsAs: "Sharpshooter", desc: "" } }, null);
    assert.equal(holdsFeat({ feats: ["Deadeye"] }, "Sharpshooter"), true);
    forgetBrowserTableFeats();
    assert.equal(holdsFeat({ feats: ["Deadeye"] }, "Sharpshooter"), false, "a sign-out kept the library's feats");
  } finally {
    delete globalThis.window;
  }
});

world.close();
finish();
