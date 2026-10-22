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

import { holdsOn } from "@/lib/dm/vitals-logic";
import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { incapacitatedBy } from "@/lib/dm/condition-logic";
import { spellTurnHold } from "@/lib/srd/condition-effect-queries";
import type { ToolError } from "@/lib/dm/tool-errors";

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
  | ({ ok: false; reason: CannotActReason } & ToolError);

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

function refuse(reason: CannotActReason, refusal: ToolError): CanActResult {
  return { ok: false, reason, ...refusal };
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
      { error: `${sheet.name} is dead and cannot ${what}. Only magic that raises the dead brings them back.`, refused: "rules" },
    );
  }
  // Strength before Death holds them up for the extra turn it gives.
  if (sheet.currentHp <= 0 && !holdsOn(sheet)) {
    return refuse(
      "down",
      { error: `${sheet.name} is at 0 HP and cannot ${what}. They act again once they are healed above 0.`, refused: "rules" },
    );
  }
  const stoppedBy = incapacitatedBy(sheet.conditions);
  // Bare incapacitation takes actions and reactions, not speed (SRD 5.1); the
  // conditions that also stop movement zero the speed (condition-logic.ts).
  if (stoppedBy && !(kind === "move" && stoppedBy === "incapacitated")) {
    return refuse(
      "incapacitated",
      { error: `${sheet.name} is ${stoppedBy} and cannot ${what} until the condition ends.`, refused: "rules" },
    );
  }
  // A spell's hold on the turn: Stinking Cloud, Command's Halt, Gaseous Form.
  const held = spellTurnHold(sheet.conditions, kind);
  if (held) {
    return refuse("incapacitated", { error: `${sheet.name} is ${held} and cannot ${what} while it lasts.`, refused: "rules" });
  }
  if (!encounter) {
    // Outside a fight there are no turns to wait for.
    return { ok: true };
  }
  if (isSurprised(encounter, sheet.id, kind === "reaction")) {
    return refuse(
      "surprised",
      { error: kind === "reaction"
        ? `${sheet.name} is surprised and has no reaction until their first turn has passed.`
        : `${sheet.name} is surprised and cannot ${what} in the first round. They act from round 2.`, refused: "rules" },
    );
  }
  if (!encounter.orderReady) {
    return refuse(
      "no_initiative",
      { error: `Initiative is still being rolled, so ${sheet.name} cannot ${what} yet. Roll initiative for every character first.`, retry: true },
    );
  }
  if (kind !== "reaction") {
    const current = encounter.order[encounter.turnIndex];
    if (!current || entryRef(current) !== sheet.id) {
      return refuse(
        "not_your_turn",
        { error: `It is ${current?.name ?? "someone else"}'s turn, not ${sheet.name}'s. Off their own turn a character can only use their reaction. What they declared waits for their turn.`, refused: "rules" },
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

// The fight's record of who has taken a bonus action this round, the one
// Nimble Escape and an enemy's bonus-action spell keep too
// (src/lib/dm/token-rules.ts, reaction-spells.ts).
type BonusHolder = { round: number; legendary?: { bonus?: { round: number; ids: string[] } } };

function bonusLedgerOf(encounter: BonusHolder): string[] {
  const ledger = encounter.legendary?.bonus;
  return ledger && ledger.round === encounter.round ? ledger.ids : [];
}

// Whether an enemy has taken its bonus action this round (a block's Bonus
// Actions: one a round, beside its action).
export function enemyBonusThisRound(encounter: BonusHolder | null, enemyId: string): boolean {
  return encounter ? bonusLedgerOf(encounter).includes(enemyId) : false;
}

// Records an enemy's bonus action for the round. The caller saves the
// encounter.
export function markEnemyBonus(encounter: { round: number; legendary: { bonus?: { round: number; ids: string[] } } }, enemyId: string) {
  const used = bonusLedgerOf(encounter);
  encounter.legendary.bonus = { round: encounter.round, ids: used.includes(enemyId) ? used : [...used, enemyId] };
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

// Whether the action an enemy is about to spend closes a turn it was owed
// and its own turn of the round follows at once: an ambusher ahead of the
// first character plays the round the party lost and then its own in the
// same DM turn, and the second walks on fresh movement. Not when its own
// action is already taken (a legendary attack is owed on top of it) or its
// place in the order is still ahead of the pointer (its own turn comes when
// the pointer passes it).
export function endsOwedTurn(
  encounter: LedgerHolder & Pick<ActingEncounter, "order" | "turnIndex">,
  enemyId: string,
): boolean {
  const { ids, owed } = ledgerOf(encounter);
  const slot = encounter.order.findIndex((entry) => entry.kind === "enemy" && entry.enemyId === enemyId);
  return owed.includes(enemyId) && !ids.includes(enemyId) && slot >= 0 && slot < encounter.turnIndex;
}

// One action more for each enemy named, on top of the round's own: the
// round a wholly surprised party lost to them, or a legendary action that
// is an attack. The caller saves the encounter.
export function oweEnemiesAnAction(encounter: LedgerHolder, enemyIds: string[]) {
  const { ids, owed } = ledgerOf(encounter);
  writeLedger(encounter, ids, [...owed, ...enemyIds]);
}

// An enemy's action, bonus action, reaction or legendary action. Dead and
// incapacitated enemies do nothing; a surprised one loses round 1; an action
// is one a round, and so is a bonus action. A legendary action is spent on
// somebody else's turn, so the action already taken does not refuse it (the
// pool does, in legendary-tools.ts).
export function canEnemyAct(input: {
  enemy: ActingEnemy;
  encounter: ActingEncounter | null;
  kind: "action" | "bonus" | "reaction" | "legendary";
}): CanActResult {
  const { enemy, kind } = input;
  const encounter = isRunningFight(input.encounter) ? input.encounter : null;
  if (enemy.status !== "alive") {
    return refuse("dead", { error: `${enemy.displayName} is ${enemy.status} and cannot act.`, retry: true });
  }
  const stoppedBy = incapacitatedBy(enemy.conditions);
  if (stoppedBy) {
    return refuse(
      "incapacitated",
      { error: `${enemy.displayName} is ${stoppedBy} and cannot act until the condition ends.`, refused: "rules" },
    );
  }
  // A bonus action is held by whatever holds its action.
  const held = kind === "action" || kind === "bonus" ? spellTurnHold(enemy.conditions, "action") : null;
  if (held) {
    return refuse("incapacitated", { error: `${enemy.displayName} is ${held} and loses its action this turn.`, refused: "rules" });
  }
  if (!encounter) {
    return { ok: true };
  }
  if (isSurprised(encounter, enemy.id, kind === "reaction" || kind === "legendary")) {
    return refuse(
      "surprised",
      { error: `${enemy.displayName} is surprised and does nothing in the first round. It acts from round 2.`, refused: "rules" },
    );
  }
  if (!encounter.orderReady) {
    return refuse(
      "no_initiative",
      { error: `Initiative is still being rolled, so ${enemy.displayName} cannot act yet. Roll initiative for every character first.`, retry: true },
    );
  }
  if (kind === "bonus" && enemyBonusThisRound(encounter as BonusHolder, enemy.id)) {
    return refuse(
      "already_acted",
      { error: `${enemy.displayName} has already taken its bonus action this round (round ${encounter.round}). Its action is separate.`, retry: true },
    );
  }
  if (kind === "action" && enemyActedThisRound(encounter, enemy.id)) {
    return refuse(
      "already_acted",
      { error: `${enemy.displayName} has already taken its action this round (round ${encounter.round}). It acts again next round; legendary actions and reactions are separate.`, retry: true },
    );
  }
  return { ok: true };
}
