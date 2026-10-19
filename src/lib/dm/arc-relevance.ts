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

import { searchWords, textKey } from "../language/text-logic.ts";

export type SceneCues = {
  location?: string;
  scene?: string;
  npcs?: string[];
  enemies?: string[];
  // The newest player line, so "we head for the lighthouse" surfaces the
  // lighthouse before the party arrives.
  recent?: string;
  // The table language's stop list (src/lib/language/language.ts
  // stopWordsFor): the words too common to tell one event from another. Passed
  // in, not looked up, because arc-logic.ts reaches the browser and the
  // stemmer module must not.
  stopWords: ReadonlySet<string>;
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

type CueTerms = { phrases: string[]; words: Set<string>; stopWords: ReadonlySet<string> };

// The scene as search terms: whole names (a place or a person) count more
// than loose words, because "Marla" in a trigger is a stronger signal than
// "road".
export function cueTerms(cues: SceneCues): CueTerms {
  const phrases = [cues.location ?? "", ...(cues.npcs ?? []), ...(cues.enemies ?? [])]
    .map((phrase) => textKey(phrase))
    .filter((phrase) => phrase.length >= 3);
  const loose = new Set<string>();
  for (const source of [cues.location, cues.scene, cues.recent, ...(cues.npcs ?? []), ...(cues.enemies ?? [])]) {
    for (const word of searchWords(source ?? "", cues.stopWords)) {
      loose.add(word);
    }
  }
  return { phrases: [...new Set(phrases)], words: loose, stopWords: cues.stopWords };
}

export function scoreEvent(event: EventLike, terms: CueTerms): { score: number; matched: string[] } {
  const text = textKey(`${event.name} ${event.trigger} ${event.detail} ${event.castName ?? ""}`);
  const matched: string[] = [];
  let score = 0;
  for (const phrase of terms.phrases) {
    if (text.includes(phrase)) {
      score += 3;
      matched.push(phrase);
    }
  }
  const seen = new Set(matched.flatMap((phrase) => searchWords(phrase, terms.stopWords)));
  for (const word of new Set(searchWords(text, terms.stopWords))) {
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
  // With no scene to read, every event scores nothing and act order decides.
  const terms = cues ? cueTerms(cues) : null;
  const pending = events
    .map((event, index) => ({ event, index, ...(terms ? scoreEvent(event, terms) : { score: 0, matched: [] }) }))
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
