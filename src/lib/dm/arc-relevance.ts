// Which planned events the DM is shown this turn (issue #301).
//
// A storyboard can plan far more events than a prompt should carry, and
// the old render took the first four by act hint, so a scene-relevant event
// twelfth in the list never reached the model. This picks the slice: every
// pending event is scored against what the scene is made of (the place, the
// people in it, the fight, the newest line of play), the matches come first,
// the rest follow in act order, and a character budget decides where the
// list stops. What was held back is recorded, with the reason, for the
// Context panel and for the arc render itself (the ids stay reachable
// through read_card).
//
// Pure and alias-free, like arc-logic.ts, so scripts/test-arc-relevance.mjs
// can load it directly. A match never fires an event: the render still says
// these are opportunities, and the DM decides.

import { textKey } from "../language/text-logic.ts";

export type SceneCues = {
  location?: string;
  scene?: string;
  npcs?: string[];
  enemies?: string[];
  // The newest player line, so "we head for the lighthouse" surfaces the
  // lighthouse before the party arrives.
  recent?: string;
};

export type EventLike = {
  id: string;
  name: string;
  detail: string;
  trigger: string;
  actHint: number | null;
  status: string;
  castName?: string;
};

export type EventPick = {
  id: string;
  name: string;
  included: boolean;
  reason: string;
};

// What the arc render decided, kept on the turn's context trace.
export type ArcTrace = {
  events: EventPick[];
  // Main beats rendered against the arc's total (the window around [NOW]).
  beats: { shown: number; total: number };
  // Characters the planned-events list took, and what it was allowed.
  chars: number;
  budgetChars: number;
};

// About 300 tokens of planned events on an ordinary turn, and never more
// than this many lines: a scene has at most a few doors worth naming.
export const RENDER_EVENT_CHARS = 1_200;
export const RENDER_EVENTS_MAX = 6;

const STOP_WORDS = new Set(
  "the a an and or of to in on at by for with from into onto out over under near about after before while when where which who whom whose what that this these those they them their there then than as is are was were be been being have has had do does did not no nor so if but its it he she his her him we us our you your i me my mine party heads head go goes going toward towards back again all any some one two three ask asks say says said tell tells told look looks looking take takes make makes way".split(
    " ",
  ),
);

function words(text: string | undefined): string[] {
  return textKey(text ?? "")
    .split(" ")
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

// The scene as search terms: whole names (a place or a person) count more
// than loose words, because "Marla" in a trigger is a stronger signal than
// "road".
export function cueTerms(cues: SceneCues): { phrases: string[]; words: Set<string> } {
  const phrases = [cues.location ?? "", ...(cues.npcs ?? []), ...(cues.enemies ?? [])]
    .map((phrase) => textKey(phrase))
    .filter((phrase) => phrase.length >= 3);
  const loose = new Set<string>();
  for (const source of [cues.location, cues.scene, cues.recent, ...(cues.npcs ?? []), ...(cues.enemies ?? [])]) {
    for (const word of words(source)) {
      loose.add(word);
    }
  }
  return { phrases: [...new Set(phrases)], words: loose };
}

export function scoreEvent(event: EventLike, terms: { phrases: string[]; words: Set<string> }): { score: number; matched: string[] } {
  const text = textKey(`${event.name} ${event.trigger} ${event.detail} ${event.castName ?? ""}`);
  const matched: string[] = [];
  let score = 0;
  for (const phrase of terms.phrases) {
    if (text.includes(phrase)) {
      score += 3;
      matched.push(phrase);
    }
  }
  const seen = new Set(matched.flatMap((phrase) => words(phrase)));
  for (const word of new Set(words(text))) {
    if (terms.words.has(word) && !seen.has(word)) {
      score += 1;
      matched.push(word);
    }
  }
  return { score, matched };
}

export type EventSelection<T extends EventLike> = {
  included: T[];
  picks: EventPick[];
  chars: number;
};

// The slice. `lineLength` is what rendering an event costs, so the budget
// is counted in the characters the prompt will actually carry.
export function selectPendingEvents<T extends EventLike>(
  events: T[],
  currentAct: number,
  cues: SceneCues | undefined,
  lineLength: (event: T) => number,
  budgetChars = RENDER_EVENT_CHARS,
  maxLines = RENDER_EVENTS_MAX,
): EventSelection<T> {
  const terms = cueTerms(cues ?? {});
  const pending = events
    .map((event, index) => ({ event, index, ...scoreEvent(event, terms) }))
    .filter((entry) => entry.event.status === "pending");
  // Hinted at this act or earlier: due now. No hint: could be any time, so
  // after the due ones. Hinted ahead: that far ahead.
  const distance = (event: EventLike) =>
    event.actHint === null ? 0.5 : Math.max(0, event.actHint - currentAct);
  const ordered = [...pending].sort(
    (a, b) =>
      b.score - a.score ||
      distance(a.event) - distance(b.event) ||
      a.index - b.index,
  );
  const included: T[] = [];
  const picks: EventPick[] = [];
  let used = 0;
  for (const entry of ordered) {
    const { event, score, matched } = entry;
    const cost = lineLength(event);
    const hint =
      event.actHint === null
        ? "no act hint"
        : event.actHint <= currentAct
          ? `hinted at act ${event.actHint}, due`
          : `hinted at act ${event.actHint}, ahead`;
    const match = score > 0 ? `matches the scene (${matched.slice(0, 3).join(", ")})` : "";
    const fits = included.length < maxLines && (used + cost <= budgetChars || included.length === 0);
    if (fits) {
      included.push(event);
      used += cost;
      picks.push({ id: event.id, name: event.name, included: true, reason: match ? `${match}; ${hint}` : hint });
      continue;
    }
    picks.push({
      id: event.id,
      name: event.name,
      included: false,
      reason:
        included.length >= maxLines
          ? `held back: ${maxLines} events already shown${match ? `, though it ${match}` : ""}; ${hint}`
          : `held back: over the ${budgetChars}-character event budget${match ? `, though it ${match}` : ""}; ${hint}`,
    });
  }
  return { included, picks, chars: used };
}
