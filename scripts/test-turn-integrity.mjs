// Nothing acts for a player on a turn they did not take (issue 17: a token
// that moved, or an attack that landed, with no input). Two paths that could:
// the model moving a character with move_token forced:true on that
// character's own turn, and a parked physical-dice attack landing after the
// turn it was declared on has moved past.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-turn-integrity-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, joinByInviteCode } = await import("../src/lib/db/campaigns.ts");
const { createSheet, listSheets } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { createEncounter, insertEnemy, getActiveEncounter, saveEncounter } = await import("../src/lib/db/encounters.ts");
const { setInitiativeFloor, endOwnTurn } = await import("../src/lib/dm/encounter-tools.ts");
const { createBattleMapForEncounter, handleMoveToken } = await import("../src/lib/dm/map-tools.ts");
const { getBattleMapForEncounter, getTokenByRef, listTokens } = await import("../src/lib/db/battle-maps.ts");
const { occupiedTiles } = await import("../src/lib/battlemap/view.ts");
const { reachableTiles } = await import("../src/lib/battlemap/movement.ts");
const { createDmTurn, createPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { resolvePendingPcAttack } = await import("../src/lib/dm/pc-attack.ts");
const { removeTempDir } = await import("./lib/remove-temp-dir.mjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}
const sheetOf = (name) =>
  createSheetSchema.parse({
    name, race: "human", class: "fighter",
    abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
    maxHp: 24, ac: 16, hitDice: { die: "d10", total: 2, spent: 0 },
    proficiencies: { saves: ["str"], skills: [], languages: ["common"], tools: [], armor: [], weapons: ["martial"] },
    equipment: [{ name: "Longsword", qty: 1 }], gold: 0,
  });
const kara = createUser("kara", "x");
const brom = createUser("brom", "x");
const campaign = createCampaign(kara.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 2, difficulty: "normal" });
assert.ok(!("error" in joinByInviteCode(brom.id, campaign.inviteCode)), "Brom takes a seat");
const karaSheet = createSheet(campaign.id, kara.id, 2, sheetOf("Kara"));
const bromSheet = createSheet(campaign.id, brom.id, 2, sheetOf("Brom"));
const encounter = createEncounter(campaign.id, "Goblins");
const goblin = insertEnemy({
  encounterId: encounter.id, campaignId: campaign.id, slug: "goblin", displayName: "Goblin", initiative: 12,
  stats: { ac: 15, maxHp: 7, dexMod: 2, speed: "30 ft.", attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2", damageType: "slashing", reach: 5, kind: "melee" }], traits: [], resist: "", immune: "", vulnerable: "", conditionImmune: "", cr: 0.25, xp: 50 },
});
createBattleMapForEncounter(getCampaignById(campaign.id), encounter, [goblin], listSheets(campaign.id), "open field");
encounter.order = [
  { kind: "pc", characterId: karaSheet.id, userId: kara.id, name: "Kara", initiative: 18 },
  { kind: "pc", characterId: bromSheet.id, userId: brom.id, name: "Brom", initiative: 7 },
];
encounter.orderReady = true;
encounter.turnIndex = 0;
saveEncounter(encounter);
setInitiativeFloor(getCampaignById(campaign.id), getActiveEncounter(campaign.id));
const live = () => getCampaignById(campaign.id);
const sheets = () => listSheets(campaign.id);
const byId = () => new Map(sheets().map((sheet) => [sheet.id, sheet]));
const map = getBattleMapForEncounter(encounter.id);
const karaToken = () => getTokenByRef(map.id, karaSheet.id);
// A tile one step from Kara that the engine itself says is reachable, so
// the map's random layout cannot fail the test.
const openTile = () => {
  const at = karaToken();
  const occupied = occupiedTiles(map, listTokens(map.id), at);
  const [index] = [...reachableTiles(map.terrain, map.width, map.height, occupied, at, 1, 1, false).keys()].filter((idx) => idx !== at.y * map.width + at.x);
  if (index === undefined) {
    throw new Error("no open tile next to Kara");
  }
  return { x: index % map.width, y: Math.floor(index / map.width) };
};

test("the model cannot walk a character with a forced move on that character's own turn", () => {
  const before = karaToken();
  const to = openTile();
  const result = handleMoveToken(live(), JSON.stringify({ tokenName: "Kara", x: to.x, y: to.y, forced: true }), sheets(), byId());
  assert.match(String(result.error), /own turn/);
  assert.deepEqual([karaToken().x, karaToken().y], [before.x, before.y], "the token stayed put");
});

test("a push on somebody else's turn still moves them", () => {
  assert.equal(endOwnTurn(campaign.id, kara.id), true);
  assert.equal(getActiveEncounter(campaign.id).order[getActiveEncounter(campaign.id).turnIndex].name, "Brom");
  const to = openTile();
  const result = handleMoveToken(live(), JSON.stringify({ tokenName: "Kara", x: to.x, y: to.y, forced: true }), sheets(), byId());
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.deepEqual([karaToken().x, karaToken().y], [to.x, to.y]);
});

const attack = { attacker: "Kara", weapon: "Longsword", targetEnemyId: goblin.id, targetAc: 15, damageExpression: "1d8+3", critDamageExpression: "2d8+3", damageType: "slashing" };
const park = () => {
  const turn = createDmTurn(campaign.id, []);
  return createPendingRoll({ campaignId: campaign.id, turnId: turn.id, toolCallId: "call_1", userId: kara.id, characterId: karaSheet.id, kind: "attack", detail: "Kara: Longsword", expression: "1d20+5", advantage: "none", dc: null, reason: "attack the goblin", targetEnemyId: goblin.id, attack });
};
const d20 = (natural, total) => ({ id: "r", campaignId: campaign.id, characterId: karaSheet.id, requestedBy: "dm", kind: "attack", detail: "", expression: "1d20+5", advantage: "none", dc: null, total, success: null, breakdown: { expression: "1d20+5", total, terms: [], natural }, visibility: "public", messageId: null });

test("a parked attack landing after Kara's turn has passed does not hit", () => {
  // Pointer is on Brom now.
  const pending = park();
  const open = listOpenPendingRolls(campaign.id).length;
  const note = resolvePendingPcAttack(pending, d20(14, 19));
  assert.match(note, /does not land/);
  assert.equal(listOpenPendingRolls(campaign.id).length, open, "no damage roll was parked");
});

test("the same roll on Kara's own turn hits and parks the damage roll", () => {
  const fight = getActiveEncounter(campaign.id);
  fight.turnIndex = 0;
  saveEncounter(fight);
  const pending = park();
  const open = listOpenPendingRolls(campaign.id).length;
  const note = resolvePendingPcAttack(pending, d20(14, 19));
  assert.match(note, /HIT/);
  assert.equal(listOpenPendingRolls(campaign.id).length, open + 1, "the damage roll is parked");
});

removeTempDir(dir);
console.log(`turn integrity: ${passed} checks passed`);
