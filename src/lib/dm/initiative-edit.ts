import type { OrderEntry } from "@/lib/db/encounters";

// Editing the initiative order by hand: reorder, insert, delay, remove,
// and step the pointer in either direction.
//
// Human DMs misclick, and a table has always been able to say "wait, go
// back". Nothing else in the engine can move the pointer backwards:
// advanceOrder only ever walks forward, because the AI DM has no reason to
// undo itself. So the whole edit lives here as a pure function over
// {order, turnIndex, round}, and the route saves whatever comes back.
//
// What this deliberately does NOT do is un-run the world. Rewinding the
// pointer moves the pointer; it does not restore hit points, un-tick a
// condition, or refill a movement budget, because undoing what happened is
// what the audit trail and audit/revert-turn are for. Saying so plainly
// beats a rewind that silently half-works.
//
// Pure by design (type-only import, no I/O) so scripts/test-initiative-
// edit.mjs can drive it directly.

export type InitiativeState = {
  order: OrderEntry[];
  turnIndex: number;
  round: number;
};

export type InitiativeEdit =
  // Nudge one combatant one slot up or down the order.
  | { op: "move"; id: string; direction: "up" | "down" }
  // Take a combatant out of the fight's order. The creature itself is
  // untouched: an enemy dropped from the order is still on the board.
  | { op: "remove"; id: string }
  // A named slot the DM runs themselves: a guard captain who joined the
  // brawl, a swarm counted as one thing. The id comes from the caller so
  // this module stays deterministic.
  | { op: "insert"; id: string; name: string; initiative: number }
  // Ready or delay: the combatant gives up their place and acts at the
  // bottom of the round.
  | { op: "delay"; id: string }
  // Put the pointer on this combatant.
  | { op: "goto"; id: string }
  // Previous or next turn.
  | { op: "step"; direction: "back" | "forward" }
  // Correct a rolled initiative and re-sort around it.
  | { op: "set-initiative"; id: string; initiative: number };

export type InitiativeOutcome = { state: InitiativeState; note: string } | { error: string };

export const NPC_ENTRY_PREFIX = "npc:";
export const ENTRY_NAME_MAX = 40;
export const MIN_INITIATIVE = -20;
export const MAX_INITIATIVE = 50;

export function orderEntryId(entry: OrderEntry): string {
  if (entry.kind === "pc") {
    return entry.characterId;
  }
  return entry.kind === "enemy" ? entry.enemyId : entry.npcId;
}

// The pointer rests only on player characters. Everything else in the order
// is the DM's to run and the engine walks past it, which is already how
// enemies work (src/lib/dm/encounter-logic.ts).
function isStop(entry: OrderEntry | undefined): boolean {
  return entry?.kind === "pc";
}

function indexOfEntry(order: OrderEntry[], id: string): number {
  return order.findIndex((entry) => orderEntryId(entry) === id);
}

// Walk to the nearest combatant the pointer may rest on, in `step`
// direction. Wrapping past either end moves the round with it, so a rewind
// off the top of round 3 lands at the bottom of round 2.
function settle(
  state: InitiativeState,
  step: 1 | -1,
  { evenIfValid }: { evenIfValid: boolean },
): InitiativeState {
  const { order } = state;
  if (!order.some((entry) => entry.kind === "pc")) {
    return { ...state, turnIndex: 0 };
  }
  if (!evenIfValid && isStop(order[state.turnIndex])) {
    return state;
  }
  let index = state.turnIndex;
  let round = state.round;
  for (let taken = 0; taken < order.length; taken += 1) {
    index += step;
    if (index >= order.length) {
      index = 0;
      round += 1;
    } else if (index < 0) {
      index = order.length - 1;
      round = Math.max(1, round - 1);
    }
    if (isStop(order[index])) {
      return { order, turnIndex: index, round };
    }
  }
  return { ...state, turnIndex: Math.max(0, Math.min(order.length - 1, state.turnIndex)) };
}

// Reorders keep the pointer on the combatant it was on, not on the slot
// number, so nudging someone past the current turn does not hand the turn to
// a different person.
function keepingPointer(
  state: InitiativeState,
  rebuild: (order: OrderEntry[]) => OrderEntry[],
): InitiativeState {
  const currentId = state.order[state.turnIndex]
    ? orderEntryId(state.order[state.turnIndex])
    : null;
  const order = rebuild([...state.order]);
  const found = currentId ? indexOfEntry(order, currentId) : -1;
  const turnIndex = found >= 0 ? found : Math.min(state.turnIndex, Math.max(0, order.length - 1));
  return settle({ order, turnIndex, round: state.round }, 1, { evenIfValid: false });
}

export function applyInitiativeEdit(
  state: InitiativeState,
  edit: InitiativeEdit,
): InitiativeOutcome {
  if (edit.op === "step") {
    if (!state.order.length) {
      return { error: "There is no initiative order to step through." };
    }
    const next = settle(state, edit.direction === "back" ? -1 : 1, { evenIfValid: true });
    if (next.turnIndex === state.turnIndex && next.round === state.round) {
      return { error: "There is nobody else in the order to hand the turn to." };
    }
    const name = next.order[next.turnIndex]?.name ?? "the next combatant";
    return {
      state: next,
      note:
        edit.direction === "back"
          ? `The DM stepped the initiative back to ${name}.`
          : `The DM moved the initiative on to ${name}.`,
    };
  }

  if (edit.op === "insert") {
    const name = edit.name.trim().slice(0, ENTRY_NAME_MAX);
    if (!name) {
      return { error: "A combatant needs a name." };
    }
    if (indexOfEntry(state.order, edit.id) >= 0) {
      return { error: "That combatant is already in the order." };
    }
    const initiative = clampInitiative(edit.initiative);
    const entry: OrderEntry = { kind: "npc", npcId: edit.id, name, initiative };
    // Slots by count, below anyone already tied with it, which is where a
    // late arrival goes at a real table.
    const next = keepingPointer(state, (order) => {
      const at = order.findIndex((other) => other.initiative < initiative);
      const insertAt = at === -1 ? order.length : at;
      order.splice(insertAt, 0, entry);
      return order;
    });
    return { state: next, note: `${name} joins the order at initiative ${initiative}.` };
  }

  const index = indexOfEntry(state.order, edit.id);
  if (index < 0) {
    return { error: "That combatant is not in the initiative order." };
  }
  const subject = state.order[index];

  if (edit.op === "move") {
    const target = edit.direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= state.order.length) {
      return { error: `${subject.name} is already at the ${edit.direction === "up" ? "top" : "bottom"}.` };
    }
    const next = keepingPointer(state, (order) => {
      const [moved] = order.splice(index, 1);
      order.splice(target, 0, moved);
      return order;
    });
    return { state: next, note: `${subject.name} moves ${edit.direction} the order.` };
  }

  if (edit.op === "remove") {
    if (state.order.length === 1) {
      return { error: "The last combatant cannot be taken out of the order." };
    }
    const next = keepingPointer(state, (order) => {
      order.splice(index, 1);
      return order;
    });
    return { state: next, note: `${subject.name} leaves the initiative order.` };
  }

  if (edit.op === "delay") {
    // Delaying drops the combatant to the bottom of the round and gives them
    // a count below everyone, so the order stays sorted and a later insert
    // still lands above them.
    const lowest = state.order.reduce(
      (min, entry) => Math.min(min, entry.initiative),
      state.order[0].initiative,
    );
    const delayed = { ...subject, initiative: clampInitiative(lowest - 1) };
    const rebuild = (order: OrderEntry[]) => {
      order.splice(index, 1);
      order.push(delayed);
      return order;
    };
    if (index !== state.turnIndex) {
      return {
        state: keepingPointer(state, rebuild),
        note: `${subject.name} delays to the bottom of the round.`,
      };
    }
    // The combatant who delayed was the one acting, so there is no entry to
    // hold the pointer on: it goes to whoever was standing behind them,
    // which is the slot they just vacated.
    const order = rebuild([...state.order]);
    const next = settle(
      { order, turnIndex: Math.max(0, index - 1), round: state.round },
      1,
      { evenIfValid: true },
    );
    return { state: next, note: `${subject.name} delays to the bottom of the round.` };
  }

  if (edit.op === "set-initiative") {
    const initiative = clampInitiative(edit.initiative);
    const next = keepingPointer(state, (order) => {
      order.splice(index, 1);
      const at = order.findIndex((other) => other.initiative < initiative);
      order.splice(at === -1 ? order.length : at, 0, { ...subject, initiative });
      return order;
    });
    return { state: next, note: `${subject.name} now acts on initiative ${initiative}.` };
  }

  // goto
  if (!isStop(subject)) {
    return {
      error: `The turn only rests on player characters; ${subject.name} is yours to run whenever you like.`,
    };
  }
  if (index === state.turnIndex) {
    return { error: `It is already ${subject.name}'s turn.` };
  }
  return {
    state: { ...state, turnIndex: index },
    note: `The DM gave the turn to ${subject.name}.`,
  };
}

function clampInitiative(value: number): number {
  const rounded = Math.round(Number(value));
  if (!Number.isFinite(rounded)) {
    return 10;
  }
  return Math.min(MAX_INITIATIVE, Math.max(MIN_INITIATIVE, rounded));
}
