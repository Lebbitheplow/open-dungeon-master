// The starter one-shot (src/lib/starter/one-shot.ts) and its ready-made
// heroes (src/lib/starter/pregens.ts): every hero passes the same admission
// door as a player's character and arrives with gear, the one-shot campaign
// carries its premise and the DM's outline, and solo means one seat. Real
// throwaway database.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-starter-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { admitSheet } = await import("../src/lib/characters/admit.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { createSheet, listSheets } = await import("../src/lib/db/sheets.ts");
const { createCharacter, listCharactersForUser } = await import("../src/lib/db/characters.ts");
const { PREGENS, pregenById, pregenSummaries } = await import("../src/lib/starter/pregens.ts");
const { STARTER_ONE_SHOT, createStarterCampaign } = await import("../src/lib/starter/one-shot.ts");

let failed = 0;
function test(name, run) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`not ok - ${name}`);
    console.log(error);
  }
}

const host = createUser("Host", "x");

test("the one-shot campaign carries its premise, its secret outline and a short length; solo is one seat", () => {
  const table = createStarterCampaign(host.id, { solo: false });
  assert.equal(table.title, STARTER_ONE_SHOT.title);
  assert.equal(table.maxPlayers, 5);
  assert.equal(table.startingLevel, 1);
  assert.equal(table.gameSettings.dmMode, "ai");
  assert.equal(table.gameSettings.campaignLength, "short");
  assert.equal(table.gameSettings.genre, "high_fantasy");
  const stored = getCampaignById(table.id);
  assert.ok(stored.dmOutline.includes("Aldo Merrin"), "the DM's outline is written");
  assert.ok(stored.description.includes("Marrow's Crossing"));
  assert.ok(!stored.description.includes("ghoul"), "the players' premise keeps the twist");
  const solo = createStarterCampaign(host.id, { solo: true });
  assert.equal(solo.maxPlayers, 1);
});

test("every ready-made hero passes the table's admission door at level 1 and arrives armed", () => {
  const table = createStarterCampaign(host.id, { solo: false });
  assert.equal(PREGENS.length, 4);
  for (const pregen of PREGENS) {
    const player = createUser(`player-${pregen.id}`, "x");
    const input = createSheetSchema.parse(pregen.sheet);
    const admitted = admitSheet({ door: "table", level: 1, sheet: input, userId: player.id, campaign: table });
    assert.ok(admitted.ok, `${pregen.sheet.name}: ${admitted.ok ? "" : admitted.problems.join(" | ")}`);
    const sheet = admitted.sheet;
    assert.ok(sheet.equipment.length >= 8, `${sheet.name} carries a kit`);
    assert.ok(sheet.equipment.some((item) => /axe|sword|rapier|mace/i.test(item.name)), `${sheet.name} carries a weapon`);
    assert.ok(sheet.maxHp >= 10 && sheet.ac >= 14, `${sheet.name} hp ${sheet.maxHp} ac ${sheet.ac}`);
    // Seated the way the route seats it: a library copy and a table copy.
    const libraryCharacter = createCharacter(player.id, 1, sheet);
    createSheet(table.id, player.id, 1, sheet, libraryCharacter.id);
    admitted.settle();
    assert.equal(listCharactersForUser(player.id).length, 1);
  }
  assert.equal(listSheets(table.id).length, 4);
  const sera = listSheets(table.id).find((sheet) => sheet.name === "Sera");
  assert.equal(sera.spellcasting?.cantrips.length, 3);
  assert.ok(sera.spellcasting?.prepared.includes("Cure Wounds"));
});

test("the picker's summaries carry no sheet, and ids resolve", () => {
  const summaries = pregenSummaries();
  assert.deepEqual(summaries.map((hero) => hero.id), ["brakk", "kara", "vex", "sera"]);
  for (const hero of summaries) {
    assert.deepEqual(Object.keys(hero).sort(), ["blurb", "class", "id", "name", "race", "tagline"]);
  }
  assert.equal(pregenById("vex")?.sheet.class, "rogue");
  assert.equal(pregenById("nobody"), null);
});

removeTempDir(dir);
if (failed) {
  process.exit(1);
}
console.log("\nstarter checks passed");
