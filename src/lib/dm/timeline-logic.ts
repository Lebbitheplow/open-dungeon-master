// The campaign on one axis (docs/vtt-parity-implementation-plan.md section
// 5.5): chapters as they closed, facts as they were established, the
// sessions on the real calendar, and the world's arcs as they climbed.
// Pure: the route gathers, this orders and labels, the panel draws.

export type TimelineKind = "chapter" | "fact" | "session" | "arc" | "event" | "now";

export type TimelineRow = {
  id: string;
  kind: TimelineKind;
  title: string;
  detail: string;
  // The in-world date when one was recorded, else the real one.
  when: string;
  // What the rows sort on: a chapter's closing sequence, a fact's source
  // sequence, a session's start time as a number, an arc's rung.
  order: number;
  // Rows only the DM seat may read.
  secret?: boolean;
};

export type TimelineSources = {
  chapters: Array<{ id: string; index: number; title: string; summary: string; seqEnd: number | null; clockLabel: string; status: string }>;
  facts: Array<{ id: string; subject: string; fact: string; sourceSeq: number | null; createdAt: string; knownBy?: unknown }>;
  sessions: Array<{ id: string; title: string; startsAt: string; status?: string }>;
  arcs: Array<{ id: string; name: string; rung: number; rungs: string[]; status: string }>;
  // Calendar events (7.2): the fired ones sit where they fired, the ones
  // still to come after now.
  events?: Array<{ id: string; title: string; body: string; when: string; firedSeq: number; fired: boolean; visibility: string }>;
  now: { seq: number; clockLabel: string };
};

const FACT_CAP = 40;

export function buildTimeline(sources: TimelineSources, steersStory: boolean): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const chapter of sources.chapters) {
    if (chapter.status !== "closed") {
      continue;
    }
    rows.push({
      id: `chapter-${chapter.id}`,
      kind: "chapter",
      title: chapter.title || `Chapter ${chapter.index}`,
      detail: firstSentence(chapter.summary),
      when: chapter.clockLabel,
      order: chapter.seqEnd ?? 0,
    });
  }
  for (const fact of sources.facts.slice(-FACT_CAP)) {
    rows.push({
      id: `fact-${fact.id}`,
      kind: "fact",
      title: fact.subject,
      detail: fact.fact,
      when: "",
      order: fact.sourceSeq ?? 0,
    });
  }
  for (const session of sources.sessions) {
    if (session.status === "cancelled") {
      continue;
    }
    const at = Date.parse(session.startsAt);
    rows.push({
      id: `session-${session.id}`,
      kind: "session",
      title: session.title || "Session",
      detail: Number.isFinite(at) ? new Date(at).toLocaleString() : session.startsAt,
      when: "",
      // Sessions sit on the real calendar: the ones already played sort
      // before now, the ones to come after.
      order: Number.isFinite(at) && at <= Date.now() ? sources.now.seq - 1 : sources.now.seq + 1,
    });
  }
  if (steersStory) {
    for (const arc of sources.arcs) {
      if (arc.rung < 0) {
        continue;
      }
      rows.push({
        id: `arc-${arc.id}`,
        kind: "arc",
        title: arc.name,
        detail: arc.rungs[arc.rung] ?? "",
        when: "",
        order: sources.now.seq,
        secret: true,
      });
    }
  }
  for (const event of sources.events ?? []) {
    if (event.visibility === "dm" && !steersStory) {
      continue;
    }
    rows.push({
      id: `event-${event.id}`,
      kind: "event",
      title: event.title,
      detail: event.body,
      when: event.when,
      order: event.fired ? event.firedSeq : sources.now.seq + 1,
      ...(event.visibility === "dm" ? { secret: true } : {}),
    });
  }
  rows.push({
    id: "now",
    kind: "now",
    title: "Now",
    detail: sources.now.clockLabel,
    when: sources.now.clockLabel,
    order: sources.now.seq,
  });
  return rows.sort((a, b) => a.order - b.order || rank(a.kind) - rank(b.kind));
}

function rank(kind: TimelineKind): number {
  return kind === "chapter" ? 0 : kind === "fact" ? 1 : kind === "event" ? 2 : kind === "arc" ? 3 : kind === "now" ? 4 : 5;
}

function firstSentence(text: string): string {
  const match = /^[^.!?]*[.!?]/.exec(text.trim());
  return (match ? match[0] : text.trim()).slice(0, 200);
}
