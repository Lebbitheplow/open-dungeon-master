// Wait for the table (gameSettings.waitForTable): the pure half. After a
// narration on an open floor the DM's next turn is held until every present
// player has acted or passed, or the table has gone quiet for its timeout,
// and then one turn reads every answer that gathered. Without it the first
// post wakes the DM and the fastest player drives the story.
//
// The clock restarts with every post and pass: what one player says can
// change what the next one does, so a table still talking is never cut off.
//
// Nothing here reads the database or the clock; src/lib/dm/table-wait.ts
// gathers the facts and acts on the decision.

export const TABLE_WAIT_MIN_SECONDS = 15;
export const TABLE_WAIT_MAX_SECONDS = 900;
export const TABLE_WAIT_DEFAULT_SECONDS = 300;

export type TableSeat = { userId: string; name: string };

// What every seat is shown, and what the snapshot carries for a reload.
export type TableWaitView = {
  // Players the DM still waits on, in seat order.
  waitingOn: TableSeat[];
  // Players who acted or passed since the narration.
  answered: Array<TableSeat & { passed: boolean }>;
  // When the held turn fires if nobody else answers, as an ISO time; each
  // answer moves it. Null until the first post: an untouched table has
  // nothing for the DM to read yet.
  deadline: string | null;
};

export type TableWaitInput = {
  // Present players: a live tab or a live agent subscription. Someone who
  // answered counts as present whether or not they still are.
  present: TableSeat[];
  // In-character posts since the window opened, oldest first.
  posts: Array<{ userId: string; name: string; at: number }>;
  // Passes since the window opened, oldest first.
  passes: Array<TableSeat & { at: number }>;
  // When the window opened (the narration landed), so a post made while the
  // DM was still writing does not start a clock that has mostly run out.
  openedAt: number;
  seconds: number;
  now: number;
};

export type TableWaitDecision = {
  view: TableWaitView;
  // Two or more players are at the table (present, or answered this beat):
  // there is a table to gather. With one, a post is answered at once and
  // nothing is shown or waited on.
  gathering: boolean;
  // The held turn should run now: there is something to answer, and either
  // nobody present is left or the time is up.
  fire: boolean;
  // Epoch milliseconds, or null while nothing has been posted.
  deadline: number | null;
};

// Whether a post joins the gathering beat instead of waking the DM. Only an
// open floor gathers. A spotlight takes precedence: its named players answer
// it, the last answer releases it and fires the one coalesced turn as it
// always has, and nothing then waits a second time on the rest of the table.
// The gather opens again only after the next narration on an open floor.
// Table talk, a first action and the setting being off never hold.
export function holdsPostForTable(input: {
  floorBefore: "open" | "spotlight" | "initiative" | "hold";
  kind: "do" | "say" | "ooc";
  isFirstAction: boolean;
  waits: boolean;
}): boolean {
  return input.waits && input.floorBefore === "open" && input.kind !== "ooc" && !input.isFirstAction;
}

export function clampWaitSeconds(seconds: unknown): number {
  const value = Number(seconds);
  if (!Number.isFinite(value)) {
    return TABLE_WAIT_DEFAULT_SECONDS;
  }
  return Math.min(TABLE_WAIT_MAX_SECONDS, Math.max(TABLE_WAIT_MIN_SECONDS, Math.round(value)));
}

export function decideTableWait(input: TableWaitInput): TableWaitDecision {
  const acted = new Map<string, string>();
  for (const post of input.posts) {
    if (!acted.has(post.userId)) {
      acted.set(post.userId, post.name);
    }
  }
  // A pass after a post does not take the post back.
  const passed = new Map<string, string>();
  for (const pass of input.passes) {
    if (!acted.has(pass.userId) && !passed.has(pass.userId)) {
      passed.set(pass.userId, pass.name);
    }
  }
  const seen = new Set<string>();
  const waitingOn: TableSeat[] = [];
  for (const seat of input.present) {
    if (seen.has(seat.userId)) {
      continue;
    }
    seen.add(seat.userId);
    if (!acted.has(seat.userId) && !passed.has(seat.userId)) {
      waitingOn.push(seat);
    }
  }
  const answered = [
    ...[...acted].map(([userId, name]) => ({ userId, name, passed: false })),
    ...[...passed].map(([userId, name]) => ({ userId, name, passed: true })),
  ];
  // The clock runs from the latest answer, a pass included, and only once
  // there is a post for the DM to read.
  const latest = input.posts.length ? Math.max(...[...input.posts, ...input.passes].map((answer) => answer.at)) : null;
  const deadline = latest === null ? null : Math.max(latest, input.openedAt) + clampWaitSeconds(input.seconds) * 1000;
  const fire = deadline !== null && (waitingOn.length === 0 || input.now >= deadline);
  return {
    view: { waitingOn, answered, deadline: deadline === null ? null : new Date(deadline).toISOString() },
    // Whoever answered is at the table this beat, tab open or not.
    gathering: new Set([...seen, ...acted.keys(), ...passed.keys()]).size >= 2,
    fire,
    deadline,
  };
}

// The banner's countdown: seconds under a minute, then minutes.
export function formatLeft(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}
