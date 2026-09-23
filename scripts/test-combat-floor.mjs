// The floor and the initiative pointer are two records of whose turn it is,
// and they must never come apart (issue 17): a spotlight mid-fight, its
// release, an answered spotlight and a lead's "open floor" during a hold all
// used to open the table, after which the order stopped advancing, everyone
// could post, and End Turn was refused for whoever pressed it.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-combat-floor-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, getFloor, setFloor, canAct, combatOwnsFloor } = await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { createEncounter, getActiveEncounter, saveEncounter, endEncounter } = await import("../src/lib/db/encounters.ts");
const { setInitiativeFloor, advanceAfterTurn, endOwnTurn, initiativeFloorFor, floorAfterRelease, fightOwnsFloor } = await import(
  "../src/lib/dm/encounter-tools.ts"
);
const { removeTempDir } = await import("./lib/remove-temp-dir.mjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const sheetOf = (name) =>
  createSheetSchema.parse({
    name,
    race: "human",
    class: "fighter",
    abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 10, cha: 10 },
    maxHp: 20,
    ac: 15,
    hitDice: { die: "d10", total: 2, spent: 0 },
    proficiencies: { saves: ["str"], skills: [], languages: ["common"], tools: [], armor: [], weapons: [] },
    equipment: [],
    gold: 0,
  });
const kara = createUser("kara", "x");
const brom = createUser("brom", "x");
const campaign = createCampaign(kara.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 2, difficulty: "normal" });
const karaSheet = createSheet(campaign.id, kara.id, 2, sheetOf("Kara"));
const bromSheet = createSheet(campaign.id, brom.id, 2, sheetOf("Brom"));
const live = () => getCampaignById(campaign.id);
const pointerName = () => {
  const encounter = getActiveEncounter(campaign.id);
  return encounter.order[encounter.turnIndex].name;
};

test("no fight: nothing owns the floor and a release opens the table", () => {
  assert.equal(initiativeFloorFor(campaign.id), null);
  assert.equal(fightOwnsFloor(campaign.id), false);
  assert.deepEqual(floorAfterRelease(campaign.id), { mode: "open" });
});

const encounter = createEncounter(campaign.id, "Wolves at the ford");
encounter.order = [
  { kind: "pc", characterId: karaSheet.id, userId: kara.id, name: "Kara", initiative: 18 },
  { kind: "pc", characterId: bromSheet.id, userId: brom.id, name: "Brom", initiative: 7 },
];
encounter.orderReady = true;
encounter.turnIndex = 0;
saveEncounter(encounter);
setInitiativeFloor(live(), getActiveEncounter(campaign.id));

test("a locked-in fight owns the floor, whatever the floor row says", () => {
  assert.equal(getFloor(campaign.id).mode, "initiative");
  assert.equal(fightOwnsFloor(campaign.id), true);
  setFloor(campaign.id, { mode: "open" });
  assert.equal(fightOwnsFloor(campaign.id), true, "read from the pointer, not the row");
  assert.equal(combatOwnsFloor({ mode: "hold", next: getFloor(campaign.id) }), false);
  assert.equal(combatOwnsFloor({ mode: "hold", next: initiativeFloorFor(campaign.id) }), true);
});

test("a spotlight released mid-fight restores the fight's floor", () => {
  // What the DM loop used to do on request_player_input, and what the floor
  // route's release does after it.
  setFloor(campaign.id, { mode: "spotlight", userIds: [brom.id], prompt: "?", respondedUserIds: [] });
  assert.equal(canAct(getFloor(campaign.id), kara.id, "do"), false, "the spotlight blocks the current turn");
  const restored = floorAfterRelease(campaign.id);
  setFloor(campaign.id, restored);
  assert.equal(restored.mode, "initiative");
  assert.deepEqual(restored.userIds, [kara.id]);
  assert.equal(canAct(restored, kara.id, "do"), true);
  assert.equal(canAct(restored, brom.id, "do"), false, "Brom cannot post out of turn");
  assert.equal(endOwnTurn(campaign.id, brom.id), false, "and cannot end Kara's turn");
});

test("the order still advances after a spotlight came and went", () => {
  const turn = { resolvedCharacterIds: [karaSheet.id] };
  advanceAfterTurn(live(), turn);
  assert.equal(pointerName(), "Brom");
  assert.deepEqual(getFloor(campaign.id).userIds, [brom.id]);
});

test("a hold wrapping the fight keeps the fight: the pointer moves under it and release re-reads it", () => {
  setFloor(campaign.id, { mode: "hold", next: getFloor(campaign.id) });
  assert.equal(fightOwnsFloor(campaign.id), true, "the lead's open/spotlight override is refused here");
  assert.equal(endOwnTurn(campaign.id, brom.id), true, "Brom ends his turn while held");
  const floor = getFloor(campaign.id);
  assert.equal(floor.mode, "hold", "still held for discussion");
  assert.equal(floor.next.mode, "initiative");
  assert.deepEqual(floor.next.userIds, [kara.id], "the hold now opens into the new turn");
  advanceAfterTurn(live(), { resolvedCharacterIds: [karaSheet.id] });
  assert.equal(pointerName(), "Brom", "an end_turn under the hold still moves the order");
  const released = floorAfterRelease(campaign.id);
  assert.deepEqual(released.userIds, [brom.id], "release reads the pointer, not the stale snapshot");
  setFloor(campaign.id, released);
});

test("a spotlight everyone answered goes back to the fight, not the open table", () => {
  assert.equal(floorAfterRelease(campaign.id).mode, "initiative");
  endEncounter(getActiveEncounter(campaign.id).id, "the wolves flee");
  assert.deepEqual(floorAfterRelease(campaign.id), { mode: "open" }, "and to the open table once the fight is over");
});

removeTempDir(dir);
console.log(`combat floor: ${passed} checks passed`);
