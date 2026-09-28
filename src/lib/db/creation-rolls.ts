import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { defaultRng } from "@/lib/dice";
import { startingWealthDice, wealthFromFaces } from "@/lib/srd/starting-wealth";

// Dice a player is owed while building a character, thrown and kept by the
// server: the six ability totals of the 4d6 method, and the starting wealth
// of a table that rolls it. The builder used to throw the ability dice in
// the browser, so the server could not tell a rolled hero from a typed one;
// now a rolled score is one the server has on record.
//
// One open roll of each kind per player (and, for wealth, per table and
// class). A roll is spent when a character is made with it.
//
// The table is this module's own and is created on first use, so the schema
// file does not have to know about it.

const REROLL_BELOW = 70;
const POOL_SIZE = 6;

// Keyed by the connection, so a process that opens a second database (a
// test, a restore) makes the table there too.
const ensured = new WeakSet<object>();

function db() {
  const database = getDatabase();
  if (!ensured.has(database)) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS creation_rolls (
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, kind, scope)
      );
    `);
    ensured.add(database);
  }
  return database;
}

export type AbilityPoolRoll = {
  // The four faces of each throw and the total with the lowest set aside.
  throws: Array<{ dice: number[]; dropIndex: number; total: number }>;
  totals: number[];
  // Whether a fresh six may be asked for: ODM's rule, only while the pool
  // adds up to less than 70.
  canReroll: boolean;
};

function read<T>(userId: string, kind: string, scope: string): T | null {
  const row = db()
    .prepare(`SELECT payload_json FROM creation_rolls WHERE user_id = ? AND kind = ? AND scope = ?`)
    .get(userId, kind, scope) as { payload_json: string } | undefined;
  return row ? parseJson<T | null>(row.payload_json, null) : null;
}

function write(userId: string, kind: string, scope: string, payload: unknown) {
  db()
    .prepare(
      `INSERT INTO creation_rolls (user_id, kind, scope, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, kind, scope)
       DO UPDATE SET payload_json = excluded.payload_json, created_at = excluded.created_at`,
    )
    .run(userId, kind, scope, JSON.stringify(payload), nowIso());
}

function clear(userId: string, kind: string, scope: string) {
  db()
    .prepare(`DELETE FROM creation_rolls WHERE user_id = ? AND kind = ? AND scope = ?`)
    .run(userId, kind, scope);
}

function throwFour(): AbilityPoolRoll["throws"][number] {
  const dice = [defaultRng(6), defaultRng(6), defaultRng(6), defaultRng(6)];
  let dropIndex = 0;
  for (let index = 1; index < 4; index += 1) {
    if (dice[index] < dice[dropIndex]) {
      dropIndex = index;
    }
  }
  const total = dice.reduce((sum, face, index) => (index === dropIndex ? sum : sum + face), 0);
  return { dice, dropIndex, total };
}

const shaped = (throws: AbilityPoolRoll["throws"]): AbilityPoolRoll => {
  const totals = throws.map((entry) => entry.total);
  return {
    throws,
    totals,
    canReroll: totals.reduce((sum, total) => sum + total, 0) < REROLL_BELOW,
  };
};

// The player's open pool, or null when none was rolled.
export function openAbilityPool(userId: string): AbilityPoolRoll | null {
  const throws = read<AbilityPoolRoll["throws"]>(userId, "abilities", "");
  return throws?.length === POOL_SIZE ? shaped(throws) : null;
}

// Six throws of 4d6, the lowest die of each set aside. A pool worth 70 or
// more stands: asking again returns the same six.
export function rollAbilityPool(userId: string): AbilityPoolRoll {
  const open = openAbilityPool(userId);
  if (open && !open.canReroll) {
    return open;
  }
  const throws = Array.from({ length: POOL_SIZE }, throwFour);
  write(userId, "abilities", "", throws);
  return shaped(throws);
}

export function spendAbilityPool(userId: string) {
  clear(userId, "abilities", "");
}

export type WealthRoll = { classId: string; faces: number[]; gold: number };

const wealthScope = (campaignId: string, classId: string) =>
  `${campaignId}:${classId.trim().toLowerCase()}`;

export function openWealthRoll(userId: string, campaignId: string, classId: string): WealthRoll | null {
  return read<WealthRoll>(userId, "wealth", wealthScope(campaignId, classId));
}

// The class's starting wealth, rolled once: asking again returns the same
// coin, so a poor roll cannot be thrown back.
export function rollStartingWealth(userId: string, campaignId: string, classId: string): WealthRoll {
  const open = openWealthRoll(userId, campaignId, classId);
  if (open) {
    return open;
  }
  const dice = startingWealthDice(classId);
  const faces = Array.from({ length: dice.count }, () => defaultRng(dice.sides));
  const roll = { classId, faces, gold: wealthFromFaces(classId, faces) };
  write(userId, "wealth", wealthScope(campaignId, classId), roll);
  return roll;
}

export function spendWealthRolls(userId: string, campaignId: string) {
  db()
    .prepare(`DELETE FROM creation_rolls WHERE user_id = ? AND kind = 'wealth' AND scope LIKE ?`)
    .run(userId, `${campaignId}:%`);
}
