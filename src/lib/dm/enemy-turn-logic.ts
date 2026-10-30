// An enemy's turn as the fight remembers it (issue #621): how many times it
// has Dashed, whether it has Disengaged, and what its action went on. A
// character's turn has kept this since #590 and #603 (src/lib/dm/action-
// budget.ts TurnBudget), but that budget belongs to whoever the pointer rests
// on, and the pointer rests only on characters: an enemy had nowhere to keep
// a Dash, so it could not take one, and a turned or frightened creature told
// to "Dash away" was stopped at its speed.
//
// The record rides inside the encounter's legendary state (legendary-logic.ts
// normalizeLegendaryState keeps it through a save), keyed by round like the
// action ledger beside it (can-act.ts): a record from another round reads as
// empty, so nothing has to clear it when the round turns. A turn starting
// mid-round (the pointer walking past the enemy, an ambusher's own turn after
// the one it was owed) forgets the enemy's entry, as it refills its movement.
//
// Pure, with no "@/" imports, so scripts/test-enemy-turn-logic.mjs loads it
// directly.

// The actions an enemy takes through take_action. Hide is not one: the engine
// has no hidden state for an enemy that its attacks and the party's would
// read and end.
export const ENEMY_TAKE_ACTIONS = ["dash", "disengage", "dodge", "escape"] as const;
export type EnemyTakeAction = (typeof ENEMY_TAKE_ACTIONS)[number];

export function isEnemyTakeAction(action: string): action is EnemyTakeAction {
  return (ENEMY_TAKE_ACTIONS as readonly string[]).includes(action);
}

export type EnemyTurnEntry = {
  // Each Dash adds its speed once more (SRD 5.1, Dash).
  dashes?: number;
  // A Disengage holds for the rest of the turn: every walk after it, the
  // attack's own walk-up included, draws no opportunity attack.
  disengaged?: boolean;
  // What its own action went on, so an attack refused for it says why.
  spentOn?: EnemyTakeAction;
  // Squares the turn it was owed left unwalked when a Dash closed that turn
  // and its own turn followed at once (a surprised party's lost round):
  // the two turns are played back to back on one movement count.
  carried?: number;
  // Haste's extra action is taken (one weapon attack, Dash, Disengage, Hide
  // or Use an Object, SRD 5.1).
  hasteUsed?: boolean;
};

export type EnemyTurns = { round: number; byId: Record<string, EnemyTurnEntry> };

type TurnsReader = { round: number; legendary?: { turns?: EnemyTurns } } | null | undefined;
type TurnsHolder = { round: number; legendary: { turns?: EnemyTurns } };

function count(raw: unknown): number {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function cleanEntry(raw: unknown): EnemyTurnEntry {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const spent = typeof record.spentOn === "string" && isEnemyTakeAction(record.spentOn) ? record.spentOn : null;
  return {
    ...(count(record.dashes) ? { dashes: count(record.dashes) } : {}),
    ...(record.disengaged === true ? { disengaged: true } : {}),
    ...(spent ? { spentOn: spent } : {}),
    ...(count(record.carried) ? { carried: count(record.carried) } : {}),
    ...(record.hasteUsed === true ? { hasteUsed: true } : {}),
  };
}

// The stored record, or null for nothing worth keeping. Anything unreadable
// reads as no enemy having done anything this round.
export function normalizeEnemyTurns(raw: unknown): EnemyTurns | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const byIdRaw = (record.byId && typeof record.byId === "object" ? record.byId : {}) as Record<string, unknown>;
  const byId: Record<string, EnemyTurnEntry> = {};
  for (const [id, entry] of Object.entries(byIdRaw)) {
    const clean = cleanEntry(entry);
    if (Object.keys(clean).length) {
      byId[id] = clean;
    }
  }
  return Object.keys(byId).length ? { round: count(record.round), byId } : null;
}

// What this enemy's turn has recorded in the fight's current round.
export function enemyTurnEntry(holder: TurnsReader, enemyId: string): EnemyTurnEntry {
  const turns = holder?.legendary?.turns;
  return turns && turns.round === holder?.round ? (turns.byId[enemyId] ?? {}) : {};
}

function currentById(holder: TurnsHolder): Record<string, EnemyTurnEntry> {
  const turns = holder.legendary.turns;
  return turns && turns.round === holder.round ? turns.byId : {};
}

// Adds to the enemy's entry for the round on the encounter object; a stale
// round's entries are dropped as it is written. The caller saves.
export function recordEnemyTurn(holder: TurnsHolder, enemyId: string, patch: EnemyTurnEntry): void {
  const byId = currentById(holder);
  const next = cleanEntry({ ...(byId[enemyId] ?? {}), ...patch });
  holder.legendary.turns = { round: holder.round, byId: { ...byId, [enemyId]: next } };
}

// The enemies whose turns are starting: what an earlier turn of theirs in
// the round recorded is no part of the new one. The caller saves.
export function forgetEnemyTurns(holder: TurnsHolder, enemyIds: Iterable<string>): void {
  const byId = { ...currentById(holder) };
  let changed = false;
  for (const id of enemyIds) {
    if (byId[id]) {
      delete byId[id];
      changed = true;
    }
  }
  if (!changed) {
    return;
  }
  if (Object.keys(byId).length) {
    holder.legendary.turns = { round: holder.round, byId };
  } else {
    delete holder.legendary.turns;
  }
}

export function dashesOf(entry: EnemyTurnEntry): number {
  return count(entry.dashes);
}

// The squares an enemy may still walk this turn: its speed, once more for
// each Dash, with what an owed turn carried in, less what it has walked. A
// speed of 0 (grappled, restrained) is 0 however many Dashes it took.
export function enemyTilesLeft(speedTiles: number, entry: EnemyTurnEntry, movedTiles: number): number {
  if (speedTiles <= 0) {
    return 0;
  }
  return Math.max(0, speedTiles * (1 + dashesOf(entry)) + count(entry.carried) - Math.max(0, movedTiles));
}

// A Dash or a Disengage that closes the turn an enemy was owed (the round a
// surprised party lost), with its own turn following at once: its movement
// is spent after the action, in the owed turn, so what that turn had left
// (and a Dash's speed) is carried into the own turn, which starts on fresh
// movement. Without it the ambusher that Dashed walked its speed twice, not
// three times. The entry to store; the caller resets the token's movement.
export function owedTurnCarry(speedTiles: number, entry: EnemyTurnEntry, movedTiles: number, dash: boolean): EnemyTurnEntry {
  return {
    ...(dash ? { dashes: 1 } : {}),
    carried: enemyTilesLeft(speedTiles, entry, movedTiles),
    ...(entry.disengaged ? { disengaged: true } : {}),
  };
}

// The board's count, said the way a character's Dash reply says it
// (action-tools.ts), so the GM narrates the distance the map allows.
export function movementLeftLine(tiles: number): string {
  return `Movement left this turn: ${Math.max(0, tiles) * 5} ft, counted by the board.`;
}

const SPENT_WORDS: Record<EnemyTakeAction, string> = {
  dash: "took the Dash action",
  disengage: "took the Disengage action",
  dodge: "took the Dodge action",
  escape: "spent its action trying to escape",
};

// Why an enemy that spent its action on one of these makes no attack: an
// already-acted refusal that only said "already taken its action" sent the
// model looking for a mistake in its call.
export function spentOnSentence(name: string, spentOn: EnemyTakeAction): string {
  return `${name} ${SPENT_WORDS[spentOn]} this turn: its action is spent, so it makes no attack with it. It can still move, or use a bonus action or reaction.`;
}

// "speed 30 ft, 60 ft with its Dash": the out-of-movement refusal names
// the Dashes, so the GM does not Dash again for movement already counted.
export function speedWords(speedTiles: number, entry: EnemyTurnEntry): string {
  const dashes = dashesOf(entry);
  const total = speedTiles * (1 + dashes) + count(entry.carried);
  if (total === speedTiles) {
    return `speed ${speedTiles * 5} ft`;
  }
  const why = dashes ? `with its ${dashes === 1 ? "Dash" : `${dashes} Dashes`}` : "with what its owed turn left";
  return `speed ${speedTiles * 5} ft, ${total * 5} ft ${why}`;
}
