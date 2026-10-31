// A table break: someone at the table needs a few minutes (a coffee, the
// door, a child) and the game should wait for them. Unlike the X-card it is
// not anonymous and not a safety tool: the table is told who paused, play
// stops where it stands, and it picks up exactly there.
//
// The rules here are shared by the routes and the table's own buttons:
// - any person in a seat may pause; an agent program never may;
// - the person who paused, the party lead or the DM may resume; nobody else
//   cuts someone's break short;
// - while the table is paused, only table talk (OOC) goes through: nothing
//   new in play starts (refuseDuringBreak in table-break.ts), a DM turn
//   already running finishes, and prep and corrections to the record stay
//   open, since they move no turn, roll no die and change no floor.

export type TableBreak = {
  // When the break began (ms since the epoch); the banner counts from it.
  at: number;
  // Who paused, by account, and the name the table knows them by.
  userId: string;
  name: string;
};

export function mayResumeBreak(
  tableBreak: Pick<TableBreak, "userId">,
  viewer: { userId: string; isLead: boolean; isDm: boolean },
): boolean {
  return viewer.userId === tableBreak.userId || viewer.isLead || viewer.isDm;
}

// What any refused play reads: an in-character move, a trade, a roll
// resolved, an adjudication, a turn end (refuseDuringBreak).
export function breakRefusal(tableBreak: Pick<TableBreak, "name">): string {
  return `The table is paused: ${tableBreak.name} called a break. Use OOC for table talk until it resumes.`;
}

// "4 min", "1 h 05 min": how long the table has been waiting, for the banner.
export function breakElapsed(fromMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

// The queue's reason for a break. Here, where nothing reads the database, so
// code that only asks whether the queue is held for one (a player's poll
// link, src/lib/agents/webhooks.ts) need not load the break's own module.
export const BREAK_REASON = "table-break";
