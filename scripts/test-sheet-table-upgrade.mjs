// character_sheets was created with UNIQUE (campaign_id, user_id), which a
// table that allows several characters per player cannot live with. The
// schema rebuilds the table without it (src/lib/db/core.ts
// rebuildCharacterSheets). This file holds that upgrade to three promises:
// a database made by the old schema comes through with every row exactly as
// it was stored, running the upgrade again changes nothing, and the second
// sheet can then be stored.
//
// The old database is made the way a real one came to be: the first CREATE
// TABLE as it was written, then one ALTER TABLE ADD COLUMN per column the
// table gained since.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";

const core = await import("../src/lib/db/core.ts");
const sheets = await import("../src/lib/db/sheets.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const ORIGINAL_DDL = `
  CREATE TABLE character_sheets (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    race TEXT NOT NULL,
    class TEXT NOT NULL,
    background TEXT NOT NULL DEFAULT '',
    alignment TEXT NOT NULL DEFAULT '',
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    abilities_json TEXT NOT NULL,
    max_hp INTEGER NOT NULL,
    current_hp INTEGER NOT NULL,
    temp_hp INTEGER NOT NULL DEFAULT 0,
    ac INTEGER NOT NULL,
    speed INTEGER NOT NULL DEFAULT 30,
    hit_dice_json TEXT NOT NULL,
    proficiencies_json TEXT NOT NULL,
    equipment_json TEXT NOT NULL DEFAULT '[]',
    gold INTEGER NOT NULL DEFAULT 0,
    feats_json TEXT NOT NULL DEFAULT '[]',
    features_json TEXT,
    spellcasting_json TEXT NOT NULL DEFAULT 'null',
    conditions_json TEXT NOT NULL DEFAULT '[]',
    portrait_json TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (campaign_id, user_id)
  );
`;

const ddlOf = (db) =>
  db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'character_sheets'`).get().sql;
const rowsOf = (db) => db.prepare(`SELECT * FROM character_sheets ORDER BY id`).all();
const hasOwnerRule = (sql) => /UNIQUE\s*\(\s*campaign_id\s*,\s*user_id\s*\)/i.test(sql);

// Closes the connection and opens it again, which runs the whole schema
// pass the way a server boot does.
function reboot() {
  globalThis.__localRoleplayDb.close();
  globalThis.__localRoleplayDb = undefined;
  return core.getDatabase();
}

// Puts character_sheets back to the shape an old database holds it in, with
// the rows it has now.
function makeOld(db) {
  const columns = db.prepare(`PRAGMA table_info(character_sheets)`).all();
  const original = new Set(
    [...ORIGINAL_DDL.matchAll(/^\s{4}([a-z_]+) (?:TEXT|INTEGER)/gm)].map((match) => match[1]),
  );
  const added = columns.filter((column) => !original.has(column.name));
  const names = columns.map((column) => column.name).join(", ");
  db.pragma("foreign_keys = OFF");
  db.exec(`ALTER TABLE character_sheets RENAME TO character_sheets_new_shape`);
  db.exec(`DROP INDEX IF EXISTS idx_character_sheets_member`);
  db.exec(ORIGINAL_DDL);
  for (const column of added) {
    const rule = `${column.notnull ? " NOT NULL" : ""}${column.dflt_value === null ? "" : ` DEFAULT ${column.dflt_value}`}`;
    db.exec(`ALTER TABLE character_sheets ADD COLUMN ${column.name} ${column.type}${rule}`);
  }
  db.exec(`INSERT INTO character_sheets (${names}) SELECT ${names} FROM character_sheets_new_shape`);
  db.exec(`DROP TABLE character_sheets_new_shape`);
  db.pragma("foreign_keys = ON");
  return added.length;
}

const world = await openWorld({ gameSettings: { multiCharacter: "one_active" } });
const fighter = world.addHero({ class: "fighter", level: 5, maxHp: 44, gold: 12, equipment: [{ name: "Longsword", qty: 1 }] });
const wizard = world.addHero({
  class: "wizard",
  level: 3,
  maxHp: 17,
  abilities: { int: 16 },
  spellcasting: {
    ability: "int",
    slots: { 1: { max: 4, used: 2 }, 2: { max: 2, used: 1 } },
    prepared: ["Shield"],
    known: [],
    cantrips: ["Light"],
    spellbook: ["Shield", "Sleep"],
  },
});
// State only play writes: the upgrade must carry it as it stands.
world.patch(fighter.id, {
  currentHp: 0,
  tempHp: 0,
  conditions: ["unconscious"],
  deathSaves: { successes: 1, failures: 2, stable: false, dead: false },
  exhaustion: 2,
  xp: 7000,
  hitDice: { die: "d10", total: 5, spent: 3 },
});
world.patch(wizard.id, { concentratingOn: "Shield", notes: "kept as written" });

let before;

await test("a new database is created without the one-sheet-per-player constraint", () => {
  assert.equal(hasOwnerRule(ddlOf(core.getDatabase())), false);
});

await test("a database made by the old schema upgrades with every row as it was stored", () => {
  const db = core.getDatabase();
  const added = makeOld(db);
  assert.ok(added > 10, "the old table gained its later columns by ALTER TABLE");
  assert.equal(hasOwnerRule(ddlOf(db)), true);
  before = rowsOf(db);
  assert.equal(before.length, 2);
  assert.throws(
    () => world.addHero({ user: { id: wizard.userId }, name: "Second" }),
    /UNIQUE/,
    "the old table refuses a second sheet",
  );

  const upgraded = reboot();
  assert.equal(hasOwnerRule(ddlOf(upgraded)), false);
  assert.deepEqual(rowsOf(upgraded), before);
  assert.deepEqual(
    upgraded.prepare(`PRAGMA table_info(character_sheets)`).all().map((column) => column.name),
    Object.keys(before[0]),
    "the same columns in the same order",
  );
  assert.equal(
    upgraded.prepare(`SELECT name FROM sqlite_master WHERE name = 'character_sheets_rebuilt'`).get(),
    undefined,
  );
  assert.deepEqual(upgraded.prepare(`PRAGMA foreign_key_check`).all(), []);
  assert.equal(upgraded.prepare(`PRAGMA foreign_keys`).get().foreign_keys, 1);
});

await test("the sheets read after the upgrade as they did before it", () => {
  const stored = sheets.getSheetById(fighter.id);
  assert.equal(stored.currentHp, 0);
  assert.deepEqual(stored.deathSaves, { successes: 1, failures: 2, stable: false, dead: false });
  assert.deepEqual(stored.conditions, ["unconscious"]);
  assert.equal(stored.exhaustion, 2);
  assert.equal(stored.xp, 7000);
  assert.equal(stored.hitDice.spent, 3);
  const caster = sheets.getSheetById(wizard.id);
  assert.equal(caster.concentratingOn, "Shield");
  assert.equal(caster.spellcasting.slots[1].used, 2);
  assert.equal(caster.notes, "kept as written");
});

await test("running the upgrade again changes nothing", () => {
  const ddl = ddlOf(core.getDatabase());
  const again = reboot();
  assert.equal(ddlOf(again), ddl);
  assert.deepEqual(rowsOf(again), before);
});

await test("an upgraded database stores a player's second sheet", () => {
  const second = world.addHero({ user: { id: wizard.userId }, name: "Second" });
  assert.deepEqual(
    sheets.listSheetsForUser(world.campaignId, wizard.userId).map((sheet) => sheet.id),
    [wizard.id, second.id],
  );
  assert.equal(sheets.getSheetForUser(world.campaignId, wizard.userId).id, wizard.id);
});

await test("an upgrade cut off before it finished is picked up by the next boot", () => {
  const db = core.getDatabase();
  db.prepare(`DELETE FROM character_sheets WHERE name = 'Second'`).run();
  makeOld(db);
  // What a crash between the copy and the swap would leave, had the swap not
  // been one transaction: a stray half-built table beside the old one.
  db.exec(`CREATE TABLE character_sheets_rebuilt (id TEXT PRIMARY KEY)`);
  const upgraded = reboot();
  assert.equal(hasOwnerRule(ddlOf(upgraded)), false);
  assert.deepEqual(rowsOf(upgraded), before);
});

world.close();
console.log(`\n${passed} sheet table upgrade tests passed.`);
