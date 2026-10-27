// Coordinate actions (issue 254): the party stages what its characters mean
// to do in the same moment, outside a fight, and the AI DM resolves the
// whole plan as one beat. Before this the only tools were the spotlight
// (answers posted as they came, counted per player, companions left out) and
// the coalescing of messages that happened to land together.
//
// A phase is opened by whoever steers the story, over the characters it
// names. Each player drafts a line per character they control, can change
// it, and marks it Ready or passes. A companion is not a gate: a player may
// stage a request for it ("cover the exit"), and the DM plays it from its own
// sheet when the plan resolves. Nothing is posted and no DM turn wakes until
// every player's character is Ready or passed, or the lead resolves it with
// whoever is missing passed. The plan is frozen at that moment, posted as
// each character's own action, and one DM turn reads it with the block
// below. The lead may also put the plan in order (issue 292): numbered
// steps, some shared, that every seat sees and the DM resolves in turn.
// Pure, and free of alias imports, so scripts/test-coordination.mjs reads it
// directly.

import { normalizeSequence, type PlanSequence } from "./plan-order.ts";

export type { PlanSequence } from "./plan-order.ts";

export const PLAN_MAX_CHARS = 600;
// A phase nobody has touched for this long lapses on the next read, so a
// table that wandered off is never left unable to act.
export const COORDINATION_IDLE_MS = 2 * 60 * 60 * 1000;

export type CoordinationEntryState = "waiting" | "drafting" | "ready" | "pass";

export type CoordinationEntry = {
  characterId: string;
  name: string;
  // The player who controls the character; null for an AI companion.
  userId: string | null;
  companion: boolean;
  // The draft: what the character means to do, in the player's words, with
  // any "while", "after" or "if" it depends on.
  text: string;
  state: CoordinationEntryState;
  // A companion's staged request: who asked for it.
  requestedBy: string | null;
  updatedAt: string;
  // Its step in an ordered plan (issue 292), from 1; characters sharing a
  // step act at the same time. Absent in a plan with no order, which
  // happens all in one moment as before.
  step?: number;
  // The lead changed the order after this player was Ready: they see where
  // their character now stands and mark it Ready again before it resolves.
  orderChanged?: boolean;
};

export type CoordinationStatus = "drafting" | "resolved" | "cancelled";

export type CoordinationPhase = {
  id: string;
  campaignId: string;
  status: CoordinationStatus;
  openedBy: string;
  prompt: string;
  entries: CoordinationEntry[];
  createdAt: string;
  updatedAt: string;
  // The seq of the first line the resolution posted; the DM's block is read
  // until a narration lands after it.
  resolvedSeq: number | null;
  // Why it ended other than by resolving: "cancelled", "lapsed", "fight".
  outcome: string;
};

// Every player's character has said Ready or passed; companions never wait.
export function humansSettled(phase: Pick<CoordinationPhase, "entries">): boolean {
  return phase.entries.every((entry) => entry.companion || entry.state === "ready" || entry.state === "pass");
}

// Who the plan still waits on, by character name.
export function waitingOn(phase: Pick<CoordinationPhase, "entries">): string[] {
  return phase.entries
    .filter((entry) => !entry.companion && entry.state !== "ready" && entry.state !== "pass")
    .map((entry) => entry.name);
}

const clamp = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, PLAN_MAX_CHARS);

// A player's own character: its draft and its state. Refused for a character
// the player does not control, a companion (staged by request instead), an
// empty Ready, and a phase no longer drafting.
export function stagePlan(
  phase: CoordinationPhase,
  input: {
    characterId: string;
    userId: string;
    text?: string;
    state: "drafting" | "ready" | "pass";
    // The order the player was looking at (orderKey), so a Ready sent as
    // the lead changed it is not taken for the new order unseen.
    orderSeen?: string;
  },
  now: string,
): { phase: CoordinationPhase } | { error: string } {
  if (phase.status !== "drafting") {
    return { error: "This plan has already been resolved or set aside." };
  }
  if (input.state === "ready" && input.orderSeen !== undefined && input.orderSeen !== orderKey(phase)) {
    return { error: "The lead has just changed the order. Look at where your character stands now, then mark it Ready." };
  }
  const entry = phase.entries.find((candidate) => candidate.characterId === input.characterId);
  if (!entry) {
    return { error: "That character is not part of this plan." };
  }
  if (entry.companion) {
    return { error: `${entry.name} is an AI companion; stage a request for them instead.` };
  }
  if (entry.userId !== input.userId) {
    return { error: `Only ${entry.name}'s player stages their part.` };
  }
  const text = input.text === undefined ? entry.text : clamp(input.text);
  if (input.state === "ready" && !text) {
    return { error: `Say what ${entry.name} does before marking it ready, or pass.` };
  }
  return {
    phase: {
      ...phase,
      updatedAt: now,
      entries: phase.entries.map((candidate) =>
        candidate.characterId === entry.characterId
          ? { ...candidate, text, state: input.state, orderChanged: false, updatedAt: now }
          : candidate,
      ),
    },
  };
}

// A player's request for an AI companion ("cover the exit"). Any player in
// the plan may stage one; an empty one withdraws it.
export function stageRequest(
  phase: CoordinationPhase,
  input: { characterId: string; text: string; requestedBy: string },
  now: string,
): { phase: CoordinationPhase } | { error: string } {
  if (phase.status !== "drafting") {
    return { error: "This plan has already been resolved or set aside." };
  }
  const entry = phase.entries.find((candidate) => candidate.characterId === input.characterId);
  if (!entry || !entry.companion) {
    return { error: "Requests are for the AI companions in the plan." };
  }
  const text = clamp(input.text);
  return {
    phase: {
      ...phase,
      updatedAt: now,
      entries: phase.entries.map((candidate) =>
        candidate.characterId === entry.characterId
          ? { ...candidate, text, state: text ? "ready" : "waiting", requestedBy: text ? input.requestedBy : null, updatedAt: now }
          : candidate,
      ),
    },
  };
}

// The plan as it is resolved: whoever had not settled passes, so a lead's
// "resolve now" names the missing rather than waiting on them forever.
export function frozenEntries(phase: Pick<CoordinationPhase, "entries">): CoordinationEntry[] {
  return phase.entries.map((entry) =>
    entry.companion || entry.state === "ready" || entry.state === "pass" ? entry : { ...entry, state: "pass" as const },
  );
}

export function lapsed(phase: Pick<CoordinationPhase, "status" | "updatedAt">, now: number): boolean {
  return phase.status === "drafting" && now - Date.parse(phase.updatedAt) > COORDINATION_IDLE_MS;
}

// ---- the order of a plan (issue 292) ----
//
// The lead may set the order the characters act in: numbered steps, one
// after another, with two or more characters in a step when they act at the
// same time. It is kept on the entries (their step, and the entries in step
// order), so a reload, the DM's frozen block and the posted record all read
// the one order, never the sheet order, the order players readied in, or
// what their words say. A plan with one step, or none, is the old
// everyone-at-once plan.

// The entries' order as steps, or null for a plan with no order.
export function sequenceOf(phase: Pick<CoordinationPhase, "entries">): PlanSequence | null {
  if (!phase.entries.some((entry) => typeof entry.step === "number")) {
    return null;
  }
  const steps = new Map<number, string[]>();
  for (const entry of phase.entries) {
    const step = entry.step ?? Number.MAX_SAFE_INTEGER;
    steps.set(step, [...(steps.get(step) ?? []), entry.characterId]);
  }
  const sequence = [...steps.entries()].sort(([a], [b]) => a - b).map(([, ids]) => ids);
  return sequence.length > 1 ? sequence : null;
}

export function isOrdered(phase: Pick<CoordinationPhase, "entries">): boolean {
  return sequenceOf(phase) !== null;
}

// The order as one string, to tell whether two seats saw the same one.
export function orderKey(phase: Pick<CoordinationPhase, "entries">): string {
  return JSON.stringify(sequenceOf(phase));
}

// The entries laid out in a sequence (null clears the order): step order,
// each with its step number.
export function withSequence(entries: CoordinationEntry[], sequence: PlanSequence | null): CoordinationEntry[] {
  if (!sequence || sequence.length < 2) {
    return entries.map((entry) => {
      const unordered = { ...entry };
      delete unordered.step;
      return unordered;
    });
  }
  const byId = new Map(entries.map((entry) => [entry.characterId, entry]));
  return sequence.flatMap((ids, index) =>
    ids.flatMap((id) => {
      const entry = byId.get(id);
      return entry ? [{ ...entry, step: index + 1 }] : [];
    }),
  );
}

// Who acts before a character, and who alongside it: the part of an order
// its player plans around. Everyone is alongside in a plan with no order.
function placeOf(sequence: PlanSequence | null, all: string[], id: string): string {
  if (!sequence) {
    return `|${[...all].sort().join(",")}`;
  }
  const at = sequence.findIndex((step) => step.includes(id));
  const before = sequence.slice(0, Math.max(0, at)).flat().sort();
  const alongside = [...(sequence[at] ?? [])].sort();
  return `${before.join(",")}|${alongside.join(",")}`;
}

// The lead sets, changes or clears the order. Every player whose character
// was Ready and now acts after or alongside someone else is asked to look
// again: their Ready is taken back and marked, so the plan cannot resolve on
// words written for another order.
export function orderPlan(
  phase: CoordinationPhase,
  sequence: PlanSequence | null,
  now: string,
): { phase: CoordinationPhase } | { error: string } {
  if (phase.status !== "drafting") {
    return { error: "This plan has already been resolved or set aside." };
  }
  const ids = phase.entries.map((entry) => entry.characterId);
  const next = sequence ? normalizeSequence(sequence, ids) : null;
  if (sequence && !next) {
    return { error: "The order must name each character in the plan once." };
  }
  const before = sequenceOf(phase);
  const after = next && next.length > 1 ? next : null;
  const entries = withSequence(phase.entries, after).map((entry) => {
    const moved = placeOf(before, ids, entry.characterId) !== placeOf(after, ids, entry.characterId);
    return moved && !entry.companion && entry.state === "ready"
      ? { ...entry, state: "drafting" as const, orderChanged: true, updatedAt: now }
      : entry;
  });
  return { phase: { ...phase, updatedAt: now, entries } };
}

// Readied characters the lead's last change of order has not been
// confirmed for: the plan is not resolved over them.
export function unconfirmedOrder(phase: Pick<CoordinationPhase, "entries">): string[] {
  return phase.entries.filter((entry) => entry.orderChanged && !entry.companion).map((entry) => entry.name);
}

// Where a character stands in an ordered plan, in words: "step 2 of 3,
// after Nysa, at the same time as Brann".
export function placeWords(phase: Pick<CoordinationPhase, "entries">, characterId: string): string {
  const sequence = sequenceOf(phase);
  if (!sequence) {
    return "everyone acts at once";
  }
  const nameOf = (id: string) => phase.entries.find((entry) => entry.characterId === id)?.name ?? "someone";
  const at = sequence.findIndex((step) => step.includes(characterId));
  if (at < 0) {
    return "";
  }
  const before = at > 0 ? sequence[at - 1].map(nameOf) : [];
  const alongside = sequence[at].filter((id) => id !== characterId).map(nameOf);
  return [
    `step ${at + 1} of ${sequence.length}`,
    ...(before.length ? [`after ${listWords(before)}`] : ["first"]),
    ...(alongside.length ? [`at the same time as ${listWords(alongside)}`] : []),
  ].join(", ");
}

function listWords(names: string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// What the DM reads with the turn the plan wakes: every frozen intention,
// attributed, and how to resolve them.
export function coordinationBlock(phase: Pick<CoordinationPhase, "entries" | "prompt">, playerOf: (userId: string) => string): string {
  if (isOrdered(phase)) {
    return orderedBlock(phase, playerOf);
  }
  const entries = frozenEntries(phase);
  const acting = entries.filter((entry) => !entry.companion && entry.state === "ready" && entry.text);
  const passed = entries.filter((entry) => !entry.companion && entry.state === "pass");
  const asked = entries.filter((entry) => entry.companion && entry.text);
  const helpers = entries.filter((entry) => entry.companion && !entry.text);
  const lines = [
    "COORDINATED ACTIONS: the party staged these together, outside a fight, and they happen in the same moment. Resolve them as ONE scene beat: honor the timing each one states (while, after, if), roll what needs a roll, and let the world and any enemies react where the fiction says they would. Being declared together guarantees no success. If a fight breaks out, start it as usual and say which declarations could not be carried out.",
    ...(phase.prompt ? [`The lead asked: ${phase.prompt}`] : []),
    ...acting.map((entry) => `- ${entry.name} (${entry.userId ? playerOf(entry.userId) : "player"}): ${entry.text}`),
    ...(passed.length ? [`- Passed (do nothing special this moment): ${passed.map((entry) => entry.name).join(", ")}`] : []),
    ...asked.map(
      (entry) =>
        `- ${entry.name} (AI companion, yours to play from their own sheet): asked${entry.requestedBy ? ` by ${entry.requestedBy}` : ""} to ${entry.text}. They act once, in this beat, with their own legal resources.`,
    ),
    ...(helpers.length
      ? [`- ${helpers.map((entry) => entry.name).join(", ")} (AI companion${helpers.length === 1 ? "" : "s"}): may support the plan as they see fit, once, from their own sheet${helpers.length === 1 ? "" : "s"}.`]
      : []),
  ];
  return lines.join("\n");
}

// An ordered plan (issue 292): the same one beat, told step by step, with
// what happens to a later step when an earlier one does not.
function orderedBlock(phase: Pick<CoordinationPhase, "entries" | "prompt">, playerOf: (userId: string) => string): string {
  const entries = frozenEntries(phase);
  const sequence = sequenceOf({ entries }) ?? [];
  const byId = new Map(entries.map((entry) => [entry.characterId, entry]));
  const line = (entry: CoordinationEntry) => {
    if (entry.companion) {
      return entry.text
        ? `- ${entry.name} (AI companion, yours to play from their own sheet): asked${entry.requestedBy ? ` by ${entry.requestedBy}` : ""} to ${entry.text}. They act once, at this step, with their own legal resources.`
        : `- ${entry.name} (AI companion): may support the plan at this step as they see fit, once, from their own sheet.`;
    }
    return entry.state === "ready" && entry.text
      ? `- ${entry.name} (${entry.userId ? playerOf(entry.userId) : "player"}): ${entry.text}`
      : `- ${entry.name}: PASSED, does nothing special at this step. A later step that counted on ${entry.name} cannot rely on it.`;
  };
  const lines = [
    `COORDINATED ACTIONS IN ORDER: the party staged these together, outside a fight, in ${sequence.length} steps set by the party's lead. Resolve them as ONE scene beat, step by step in the order below: characters in the same step act at the same time, and each step begins only once the step before it has played out. Roll what needs a roll at its own step, and let the world and any enemies react or interrupt where the fiction says they would. Being declared together guarantees no success: when a step fails, is interrupted or is passed, decide whether each later step can still happen as written, never carry out a later step that depended on it as though it had worked, and say what that character does instead. If a fight breaks out, stop there, start it as usual, and say which steps were not carried out.`,
    ...(phase.prompt ? [`The lead asked: ${phase.prompt}`] : []),
    ...sequence.flatMap((ids, index) => {
      const members = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
      const together = members.length > 1 ? ", at the same time" : "";
      const heading = index === 0 ? `Step 1 (first${together}):` : `Step ${index + 1} (after step ${index}${together}):`;
      return [heading, ...members.map(line)];
    }),
  ];
  return lines.join("\n");
}

// The table note a fight or a lapse leaves when it sets an unresolved plan
// aside: what was staged and did not happen, in its order when it had one.
export function setAsideNote(phase: Pick<CoordinationPhase, "entries">, reason: "fight" | "lapsed" | "cancelled"): string {
  const staged = phase.entries.filter((entry) => entry.text && (entry.companion || entry.state === "ready" || entry.state === "drafting"));
  const ordered = isOrdered(phase);
  const why =
    reason === "fight"
      ? "A fight began before the party's coordinated plan was resolved"
      : reason === "lapsed"
        ? "The party's coordinated plan sat untouched and lapsed"
        : "The lead set the party's coordinated plan aside";
  return staged.length
    ? `${why}; none of it was carried out (${staged.map((entry) => `${ordered && entry.step ? `step ${entry.step}, ` : ""}${entry.name}: ${entry.text}`).join("; ")}).`
    : `${why}.`;
}

// The table note a resolved plan posts with its lines: who acts together,
// in what order when the lead set one, the companions' requests, the passes.
export function resolvedNote(phase: Pick<CoordinationPhase, "entries">): string {
  const entries = frozenEntries(phase);
  const sequence = sequenceOf({ entries });
  const nameOf = (id: string) => entries.find((entry) => entry.characterId === id)?.name ?? "someone";
  const passed = entries.filter((entry) => !entry.companion && entry.state === "pass").map((entry) => entry.name);
  const asked = entries.filter((entry) => entry.companion && entry.text);
  return [
    sequence
      ? `The party acts in order: ${sequence.map((ids, index) => `${index + 1}. ${listWords(ids.map(nameOf))}${ids.length > 1 ? " together" : ""}`).join("; ")}. The GM resolves the plan as one scene, step by step.`
      : "The party acts together; the GM resolves the plan as one moment.",
    ...asked.map((entry) => `${entry.requestedBy ?? "The party"} asked ${entry.name} to ${entry.text}.`),
    ...(passed.length ? [`Passed: ${passed.join(", ")}.`] : []),
  ].join(" ");
}
