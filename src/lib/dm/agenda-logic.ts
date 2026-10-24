// A lasting companion's hidden agenda (issue 503 Phase 8), the pure half: a
// secret employer it answers to, and what that employer wants of the party.
// A storyteller secret (src/lib/dm/viewer.ts): the AI reads it so it can
// foreshadow, a person running the table reads it on the Bonds tab, and no
// player, the lead of an AI table included, reads it anywhere.
//
// The employer's order comes on the same agency dice an NPC's session goal
// moves on at a chapter close and a timeskip (npc-logic.ts
// advanceSessionGoal): a driven companion gets it sooner. When it comes it
// breaks the party's trust: the companion is at its breaking point, by the
// employer's order rather than a deed, and the conscience decides what it
// does (departure.ts). An agenda can come from the story arc too: a cast
// member whose arc holds a pending betrayal, who joins the party, brings
// that betrayal with them (arc-logic.ts ArcEvent "betrayal").
//
// Pure, with relative imports only, so scripts/test-agenda.mjs loads it.

import type { NpcPersonality, NpcSessionGoal } from "./npc-logic.ts";
import type { ArcEvent, ArcNpc } from "./arc-logic.ts";

export type Agenda = {
  // Who secretly pays them, in the DM's words ("" when the arc gave the
  // agenda and named no one: their own reasons).
  employer: string;
  // What the employer wants of the party.
  aim: string;
  progress: number;
  target: number;
  // The order has come.
  ordered: boolean;
  // The arc's betrayal event it drives, when it came from the arc.
  eventId: string;
};

export function agendaTarget(personality: NpcPersonality | null): number {
  return personality && personality.drive >= 2 ? 2 : 3;
}

export function newAgenda(input: { employer?: string; aim?: string; eventId?: string }, personality: NpcPersonality | null): Agenda | null {
  const employer = (input.employer ?? "").trim().slice(0, 80);
  const aim = (input.aim ?? "").trim().slice(0, 200);
  if (!employer && !aim) {
    return null;
  }
  return { employer, aim, progress: 0, target: agendaTarget(personality), ordered: false, eventId: (input.eventId ?? "").slice(0, 40) };
}

// The agenda read as a goal, for the agency dice.
export function agendaGoal(agenda: Agenda): NpcSessionGoal {
  return { text: agenda.aim || `serve ${agenda.employer}`, progress: agenda.progress, target: agenda.target };
}

export function employerWords(agenda: Pick<Agenda, "employer">): string {
  return agenda.employer || "a master of their own";
}

// What moved them to their breaking point, for GAME STATE's conscience line.
export function orderCause(agenda: Pick<Agenda, "employer">): string {
  return `an order from ${employerWords(agenda)}`;
}

// The arc's pending betrayal a companion of this name brings with them, as
// an agenda's terms: its cast member's want, else the event's own detail.
export function arcBetrayalFor(
  arc: { cast: readonly ArcNpc[]; events: readonly ArcEvent[] } | null,
  name: string,
  key: (text: string) => string,
): { aim: string; eventId: string } | null {
  if (!arc) {
    return null;
  }
  const member = arc.cast.find((entry) => entry.status === "active" && key(entry.name) === key(name));
  const event = member ? arc.events.find((entry) => entry.kind === "betrayal" && entry.status === "pending" && entry.castId === member.id) : null;
  if (!member || !event) {
    return null;
  }
  return { aim: (member.agenda || event.detail).slice(0, 200), eventId: event.id };
}

// The storyteller's line for a companion with an agenda: hidden, and to be
// foreshadowed, never said.
export function agendaLine(name: string, agenda: Agenda): string {
  const who = agenda.employer ? `secretly answers to ${agenda.employer}` : "keeps a secret purpose of their own";
  const aim = agenda.aim ? `: ${agenda.aim}` : "";
  return agenda.ordered
    ? `- ${name} ${who}${aim}. The order has come and broken their trust in the party; the server has set what they do (GAME STATE says it). Reveal the employer only when the story uncovers it.`
    : `- ${name} ${who}${aim}. Foreshadow it (a coded letter, a meeting slipped away to, a question about the party's plans); never say it or let anyone learn it. The order comes when the server says.`;
}

// For a person running the table, on the Bonds row.
export function agendaWords(agenda: Agenda): string {
  return `${agenda.employer ? `answers to ${agenda.employer}` : "has a secret purpose"}${agenda.aim ? `: ${agenda.aim}` : ""}${agenda.ordered ? " (the order has come)" : ""}`;
}

const num = (value: unknown, fallback = 0) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback);

export function parseAgenda(raw: string): Agenda | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Agenda>;
    const employer = typeof parsed.employer === "string" ? parsed.employer.slice(0, 80) : "";
    const aim = typeof parsed.aim === "string" ? parsed.aim.slice(0, 200) : "";
    if (!employer && !aim) {
      return null;
    }
    return {
      employer,
      aim,
      progress: Math.max(0, num(parsed.progress)),
      target: Math.max(1, Math.min(5, num(parsed.target, 3))),
      ordered: parsed.ordered === true,
      eventId: typeof parsed.eventId === "string" ? parsed.eventId.slice(0, 40) : "",
    };
  } catch {
    return null;
  }
}
