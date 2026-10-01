// The one answer to "may this combatant act right now". Before this module
// each handler asked its own version of the question: pc_attack refused an
// incapacitated character, take_action and use_reaction read hit points
// only, the cast paths read less, and nothing read the death track, so a
// dead character could still swing.
//
// Pure: the sheet and the encounter come in as values and nothing is read
// from the database, so scripts/test-can-act.mjs can walk every branch and
// every handler (attacks, actions, reactions, casting, movement) can ask
// the same question above its first spend.
//
// The order of the refusals is the order a person would give them: the dead
// are told they are dead before they are told whose turn it is.

import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { incapacitatedBy } from "@/lib/dm/condition-logic";
import { spellTurnHold } from "@/lib/srd/condition-effect-queries";

// What the combatant is trying to spend. "attack" and "cast" are actions
// with their own handlers, "free" is anything that costs nothing but still
// belongs to a turn (ending it, dropping what is held).
export type ActKind = "action" | "bonus" | "reaction" | "attack" | "cast" | "move" | "free";

export type CannotActReason =
  | "dead"
  | "down"
  | "incapacitated"
  | "surprised"
  | "no_initiative"
  | "not_your_turn"
  | "already_acted";

export type CanActResult =
  | { ok: true }
  | { ok: false; reason: CannotActReason; error: string };

export type ActingSheet = Pick<CharacterSheet, "id" | "name" | "currentHp" | "conditions"> & {
  deathSaves?: CharacterSheet["deathSaves"] | null;
};

// Only what the question reads, so a test (or a caller holding a partial
// row) does not have to build a whole encounter.
export type ActingEncounter = Pick<
  Encounter,
  "orderReady" | "order" | "turnIndex" | "round" | "surprisedIds"
> & {
  kind?: Encounter["kind"];
  status?: Encounter["status"];
  legendary?: { acted?: EnemyActedLedger };
};

export type ActingEnemy = Pick<EncounterEnemy, "id" | "displayName" | "status" | "conditions">;

// Which enemies have taken their action in which round. It rides inside the
// encounter's legendary state (src/lib/dm/legendary-logic.ts keeps it
// through a save), because that is the per-enemy, per-round record the
// encounter row already stores.
// `owed` lists enemies with one action more to take in that round: the round
// a wholly surprised party lost to them.
export type EnemyActedLedger = { round: number; ids: string[]; owed?: string[] };

const KIND_WORDS: Record<ActKind, string> = {
  action: "take an action",
  bonus: "take a bonus action",
  reaction: "take a reaction",
  attack: "attack",
  cast: "cast a spell",
  move: "move",
  free: "act",
};

function refuse(reason: CannotActReason, error: string): CanActResult {
  return { ok: false, reason, error };
}

function entryRef(entry: Encounter["order"][number]): string {
  if (entry.kind === "pc") {
    return entry.characterId;
  }
  return entry.kind === "enemy" ? entry.enemyId : entry.npcId;
}

// A fight that binds turns: running, and a fight rather than a scene laid
// out on the map for exploration.
function isRunningFight(encounter: ActingEncounter | null): encounter is ActingEncounter {
  return (
    encounter !== null &&
    (encounter.status ?? "active") === "active" &&
    (encounter.kind ?? "fight") === "fight"
  );
}

// The id of the combatant the pointer rests on, or null before the order is
// locked.
export function actingCombatantId(encounter: ActingEncounter | null): string | null {
  if (!isRunningFight(encounter) || !encounter.orderReady) {
    return null;
  }
  const entry = encounter.order[encounter.turnIndex];
  return entry ? entryRef(entry) : null;
}

// Surprise costs the first turn, and the reaction until that turn has
// ended. `forReaction` asks the second question: a surprised combatant whose
// place in the order the pointer has already gone by has had its (lost)
// turn, and reacts again.
export function isSurprised(
  encounter: ActingEncounter | null,
  combatantId: string,
  forReaction = false,
): boolean {
  if (!isRunningFight(encounter) || encounter.round > 1) {
    return false;
  }
  if (!encounter.surprisedIds.includes(combatantId)) {
    return false;
  }
  if (!forReaction || !encounter.orderReady) {
    return true;
  }
  const place = encounter.order.findIndex((entry) => entryRef(entry) === combatantId);
  return place < 0 || place >= encounter.turnIndex;
}

export function canAct(input: {
  sheet: ActingSheet;
  encounter: ActingEncounter | null;
  kind: ActKind;
}): CanActResult {
  const { sheet, kind } = input;
  const encounter = isRunningFight(input.encounter) ? input.encounter : null;
  const what = KIND_WORDS[kind];

  if (sheet.deathSaves?.dead) {
    return refuse(
      "dead",
      `${sheet.name} is dead and cannot ${what}. Only magic that raises the dead brings them back.`,
    );
  }
  if (sheet.currentHp <= 0) {
    return refuse(
      "down",
      `${sheet.name} is at 0 HP and cannot ${what}. They act again once they are healed above 0.`,
    );
  }
  const stoppedBy = incapacitatedBy(sheet.conditions);
  // Bare incapacitation takes actions and reactions, not speed (SRD 5.1); the
  // conditions that also stop movement zero the speed (condition-logic.ts).
  if (stoppedBy && !(kind === "move" && stoppedBy === "incapacitated")) {
    return refuse(
      "incapacitated",
      `${sheet.name} is ${stoppedBy} and cannot ${what} until the condition ends.`,
    );
  }
  // A spell's hold on the turn: Stinking Cloud, Command's Halt, Gaseous Form.
  const held = spellTurnHold(sheet.conditions, kind);
  if (held) {
    return refuse("incapacitated", `${sheet.name} is ${held} and cannot ${what} while it lasts.`);
  }
  if (!encounter) {
    // Outside a fight there are no turns to wait for.
    return { ok: true };
  }
  if (isSurprised(encounter, sheet.id, kind === "reaction")) {
    return refuse(
      "surprised",
      kind === "reaction"
        ? `${sheet.name} is surprised and has no reaction until their first turn has passed.`
        : `${sheet.name} is surprised and cannot ${what} in the first round. They act from round 2.`,
    );
  }
  if (!encounter.orderReady) {
    return refuse(
      "no_initiative",
      `Initiative is still being rolled, so ${sheet.name} cannot ${what} yet. Roll initiative for every character first.`,
    );
  }
  if (kind !== "reaction") {
    const current = encounter.order[encounter.turnIndex];
    if (!current || entryRef(current) !== sheet.id) {
      return refuse(
        "not_your_turn",
        `It is ${current?.name ?? "someone else"}'s turn, not ${sheet.name}'s. Off their own turn a character can only use their reaction.`,
      );
    }
  }
  return { ok: true };
}

// ---- the enemy side ----

export function enemyActedThisRound(encounter: ActingEncounter | null, enemyId: string): boolean {
  const ledger = encounter?.legendary?.acted;
  if (!ledger || ledger.round !== encounter?.round) {
    return false;
  }
  return ledger.ids.includes(enemyId) && !(ledger.owed ?? []).includes(enemyId);
}

type LedgerHolder = { round: number; legendary: { acted?: EnemyActedLedger } };

function ledgerOf(encounter: LedgerHolder): { ids: string[]; owed: string[] } {
  const ledger = encounter.legendary.acted;
  const current = ledger && ledger.round === encounter.round ? ledger : null;
  return { ids: current?.ids ?? [], owed: current?.owed ?? [] };
}

function writeLedger(encounter: LedgerHolder, ids: string[], owed: string[]) {
  encounter.legendary.acted = {
    round: encounter.round,
    ids,
    ...(owed.length ? { owed } : {}),
  };
}

// Records an enemy's action for the round on the encounter object. An
// action it is owed is spent before the round's own. The caller saves the
// encounter.
export function markEnemyActed(encounter: LedgerHolder, enemyId: string) {
  const { ids, owed } = ledgerOf(encounter);
  const at = owed.indexOf(enemyId);
  if (at >= 0) {
    writeLedger(encounter, ids, [...owed.slice(0, at), ...owed.slice(at + 1)]);
    return;
  }
  writeLedger(encounter, ids.includes(enemyId) ? ids : [...ids, enemyId], owed);
}

// One action more for each enemy named, on top of the round's own: the
// round a wholly surprised party lost to them, or a legendary action that
// is an attack. The caller saves the encounter.
export function oweEnemiesAnAction(encounter: LedgerHolder, enemyIds: string[]) {
  const { ids, owed } = ledgerOf(encounter);
  writeLedger(encounter, ids, [...owed, ...enemyIds]);
}

// An enemy's action, reaction or legendary action. Dead and incapacitated
// enemies do nothing; a surprised one loses round 1; an action is one a
// round. A legendary action is spent on somebody else's turn, so the action
// already taken does not refuse it (the pool does, in legendary-tools.ts).
export function canEnemyAct(input: {
  enemy: ActingEnemy;
  encounter: ActingEncounter | null;
  kind: "action" | "reaction" | "legendary";
}): CanActResult {
  const { enemy, kind } = input;
  const encounter = isRunningFight(input.encounter) ? input.encounter : null;
  if (enemy.status !== "alive") {
    return refuse("dead", `${enemy.displayName} is ${enemy.status} and cannot act.`);
  }
  const stoppedBy = incapacitatedBy(enemy.conditions);
  if (stoppedBy) {
    return refuse(
      "incapacitated",
      `${enemy.displayName} is ${stoppedBy} and cannot act until the condition ends.`,
    );
  }
  const held = kind === "action" ? spellTurnHold(enemy.conditions, "action") : null;
  if (held) {
    return refuse("incapacitated", `${enemy.displayName} is ${held} and loses its action this turn.`);
  }
  if (!encounter) {
    return { ok: true };
  }
  if (isSurprised(encounter, enemy.id, kind !== "action")) {
    return refuse(
      "surprised",
      `${enemy.displayName} is surprised and does nothing in the first round. It acts from round 2.`,
    );
  }
  if (!encounter.orderReady) {
    return refuse(
      "no_initiative",
      `Initiative is still being rolled, so ${enemy.displayName} cannot act yet. Roll initiative for every character first.`,
    );
  }
  if (kind === "action" && enemyActedThisRound(encounter, enemy.id)) {
    return refuse(
      "already_acted",
      `${enemy.displayName} has already taken its action this round (round ${encounter.round}). It acts again next round; legendary actions and reactions are separate.`,
    );
  }
  return { ok: true };
}
