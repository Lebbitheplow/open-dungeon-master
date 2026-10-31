// A companion's conscience said at the table (issue 615), the pure half:
// which move the table is owed in the story, how the companion's temperament
// shows unease (an open one lets it show, a composed one keeps it in), whether
// a narration said what was owed, the companion's own line when it did not,
// and what each seat's Bonds tab may show. The rim is
// src/lib/dm/conscience-voice.ts.
//
// The Bonds tab used to show every rung to every seat the moment the server
// moved it, while the story on screen said nothing of it (the 0.31.1
// playtest): the demand and deadline were on the cards and in no line of the
// narration. Now a rung is the table's once it is said, by the GM's own words
// or, failing them, by the companion's line the server posts.
//
// Whether a narration said it reads the stored speech (who speaks each quoted
// line, src/lib/dm/speech.ts), never English phrasing, so it reads every table
// language alike. When it cannot tell, it says no, and the line is posted: a
// demand said twice costs less than one never said.
//
// Pure, with relative imports only, so scripts/test-conscience.mjs loads it
// directly.

import { CONSCIENCE_RUNGS, ULTIMATUM, clockDay, rungName, type Conscience, type ConscienceRung, type ConscienceSetting, type Owed } from "./conscience-logic.ts";
import { containsPhrase, searchWords, textKey, words } from "../language/text-logic.ts";

const UNEASY = 1;
const WARNING = 2;

// Composure at or above this keeps unease in (NpcPersonality.composure,
// -3..3, seeded -1..1 for a companion): the even-tempered and the open show
// it, the composed hide it until someone sees through them.
export const KEEPS_IT_IN = 1;

export function concealsUnease(personality: { composure?: number } | null | undefined): boolean {
  return (personality?.composure ?? 0) >= KEEPS_IT_IN;
}

export function rungIndex(rung: ConscienceRung): number {
  return CONSCIENCE_RUNGS.indexOf(rung);
}

// What a move leaves the table owed, and what it has heard. Going up the
// ladder, unease is owed by temperament (or kept in), a warning and an
// ultimatum always, and the breaking point only where the table keeps its
// companions (Talk): elsewhere the server's own departure line says it.
// Going down, nothing is owed and what the table heard follows the rung down.
// `ultimatumSet` is a new ultimatum on this move; `lapsed` the demand whose
// deadline just passed.
export function afterMove(
  conscience: Conscience,
  from: number,
  to: number,
  setting: ConscienceSetting,
  options: { keepsItIn: boolean; ultimatumSet: boolean; lapsed?: string },
): Conscience {
  const told = Math.min(conscience.told, to);
  const cause = conscience.cause && !conscience.causeSecret ? { cause: conscience.cause } : {};
  if (to < from || to === 0) {
    return { ...conscience, told, owed: null, concealed: to === UNEASY ? conscience.concealed : null };
  }
  if (to === from && !options.ultimatumSet) {
    return { ...conscience, told };
  }
  if (to === UNEASY) {
    return options.keepsItIn
      ? { ...conscience, told, owed: null, concealed: conscience.concealed ?? { noticedBy: [], pending: true } }
      : { ...conscience, told, owed: { rung: "uneasy", ...cause }, concealed: null };
  }
  if (to === WARNING) {
    return { ...conscience, told, owed: { rung: "warning", ...cause }, concealed: null };
  }
  if (to === ULTIMATUM) {
    const terms = conscience.ultimatum;
    return {
      ...conscience,
      told,
      owed: { rung: "ultimatum", ...(terms ? { condition: terms.condition, due: terms.due } : {}), ...cause },
      concealed: null,
    };
  }
  return {
    ...conscience,
    told,
    owed: setting === "talk" ? { rung: "breaking", ...(options.lapsed ? { condition: options.lapsed } : {}), ...cause } : null,
    concealed: null,
  };
}

// The owed rung said: the table has heard it, and nothing is owed.
export function heard(conscience: Conscience): Conscience {
  return conscience.owed ? { ...conscience, told: Math.max(conscience.told, rungIndex(conscience.owed.rung)), owed: null } : conscience;
}

// ---- whether a narration said it ----

export type VoiceSpeaker = { kind: string; id: string; name: string };
export type VoicedMessage = {
  content: string;
  speech: readonly { line: string; speaker: VoiceSpeaker }[];
  // The person the whole message is spoken as, when the GM said so.
  speaker?: VoiceSpeaker | null;
};
// The companion: their name, and the ids a line may carry for them (their
// sheet, the row behind it).
export type Voice = { name: string; ids: readonly string[] };

function isThem(speaker: VoiceSpeaker, voice: Voice): boolean {
  return Boolean(speaker.id && voice.ids.includes(speaker.id)) || textKey(speaker.name) === textKey(voice.name);
}

// The words a demand is known by: four letters or more, not one of the
// table language's stop words (src/lib/language/language.ts stopWordsFor,
// passed in so this stays pure), keyed the way a search reads them.
export function keyWords(text: string, stopWords: ReadonlySet<string>): string[] {
  return [...new Set(searchWords(text, stopWords).filter((word) => [...word].length >= 4))];
}

// A key word read in a text: the same word, or one the other starts with
// ("captive" in "captives", "free" in "freed"), at four letters or more.
function wordIn(key: string, said: readonly string[]): boolean {
  return said.some((word) => word === key || (word.length >= 4 && key.length >= 4 && (word.startsWith(key) || key.startsWith(word))));
}

function share(keys: readonly string[], text: string): number {
  const said = words(text).map(textKey);
  return keys.length ? keys.filter((key) => wordIn(key, said)).length / keys.length : 0;
}

// Whether a stretch of prose names the companion: their whole name, or one
// word of a longer name written as a name ("Hollis" for "Sir Hollis").
export function names(text: string, name: string): boolean {
  if (containsPhrase(text, name)) {
    return true;
  }
  const parts = words(name);
  if (parts.length < 2) {
    return false;
  }
  const keys = new Set(parts.filter((part) => [...part].length >= 3 && /^\p{Lu}/u.test(part)).map(textKey));
  return words(text).some((word) => /^\p{Lu}/u.test(word) && keys.has(textKey(word)));
}

// Whether the narration said what is owed. The companion spoke when a stored
// line is theirs (by id or name) or the whole message is spoken as them. A
// warning and a Talk table's breaking point are said when they spoke; open
// unease when they spoke or the narration names them; an ultimatum when what
// they said holds at least half of the demand's key words, or a paragraph
// naming them holds two thirds (a demand with no key word to read is said
// when they spoke).
export function voicedIn(owed: Owed, voice: Voice, message: VoicedMessage, stopWords: ReadonlySet<string>): boolean {
  const theirs = message.speaker && isThem(message.speaker, voice) ? [message.content] : message.speech.filter((entry) => isThem(entry.speaker, voice)).map((entry) => entry.line);
  const spoke = theirs.length > 0;
  if (owed.rung === "uneasy") {
    return spoke || names(message.content, voice.name);
  }
  if (owed.rung !== "ultimatum") {
    return spoke;
  }
  const keys = keyWords(owed.condition ?? "", stopWords);
  if (!keys.length) {
    return spoke;
  }
  if (spoke && share(keys, theirs.join(" ")) >= 0.5) {
    return true;
  }
  return message.content
    .split(/\n+/)
    .some((paragraph) => names(paragraph, voice.name) && share(keys, paragraph) >= 2 / 3);
}

// ---- the companion's own line ----

// When an ultimatum falls due, as a person says it: "by nightfall", "by
// tomorrow morning", "within 3 days". Minutes on the campaign's clock; the
// day cut is the calendar's (src/lib/dm/calendar.ts, 24 hours a day).
export function dueSpoken(now: number, due: number): string {
  if (due <= now) {
    return "now";
  }
  const hour = Math.floor((due % 1440) / 60);
  const days = clockDay(due) - clockDay(now);
  if (days === 0 || (days === 1 && hour < 4)) {
    return hour < 4 ? "before this night is out" : hour < 6 ? "by dawn" : hour < 11 ? "by morning" : hour < 14 ? "by midday" : hour < 17 ? "by the end of the afternoon" : hour < 21 ? "by nightfall" : "before this night is out";
  }
  if (days === 1) {
    return hour < 6 ? "by dawn tomorrow" : hour < 11 ? "by tomorrow morning" : hour < 14 ? "by midday tomorrow" : hour < 17 ? "by tomorrow afternoon" : hour < 21 ? "by nightfall tomorrow" : "by tomorrow night";
  }
  return `within ${Math.max(2, Math.round((due - now) / 1440))} days`;
}

const upperFirst = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

// A line inside quotation marks the transcript reads as one (speech-prose.ts
// QUOTE): no quotation marks of its own and no line break.
function sayable(text: string): string {
  return text.replace(/[“”"«»„]/g, "'").replace(/\s+/g, " ").trim();
}

// What the companion says when the GM did not: the issue's own shape for an
// ultimatum ("Free the prisoners. By nightfall, or I am done with this
// company."), and for the rest a plain line of the rung, naming the deed when
// the table saw it.
export function fallbackLine(owed: Owed, due: string): string {
  const cause = owed.cause ? sayable(owed.cause) : "";
  switch (owed.rung) {
    case "ultimatum": {
      const demand = sayable(owed.condition ?? "").replace(/[\s.,;:]+$/, "");
      const said = demand ? `${upperFirst(demand)}${/[!?]$/.test(demand) ? "" : "."} ` : "";
      return `${said}${upperFirst(due)}, or I am done with this company.`;
    }
    case "warning":
      return cause ? `${upperFirst(cause)}: I will not stand for it again. That stops now.` : "I will not stand for what this company has been doing. It stops now.";
    case "breaking":
      return `${owed.condition ? "The time I gave you is gone. " : ""}I can no longer stand with this company. I stay, but do not take it for faith in any of you.`;
    default:
      return cause ? `${upperFirst(cause)}. I do not like it, and I will not pretend I do.` : "I do not like what we are doing, and I will not pretend I do.";
  }
}

// What a character who noticed is told, in a whisper to their player alone.
export function uneaseWhisper(observer: string, companion: string): string {
  return `${observer} catches something in ${companion}: a jaw set too hard, a silence where a word belonged. ${companion} is uneasy with the party and keeps it in. Only you noticed.`;
}

// ---- what each seat sees ----

export type ConscienceViewer = { storyteller: boolean; characterIds: readonly string[] };

export type LadderSight = {
  rung: ConscienceRung;
  // The ultimatum's terms may be shown.
  terms: boolean;
  // For whoever runs the story: what the table has not heard yet, and unease
  // kept in, with who noticed it.
  unheard: boolean;
  hidden: boolean;
  noticedBy: string[];
  // For a player: one of their own characters noticed unease kept in.
  noticed: boolean;
};

// What one seat's Bonds tab shows of a companion standing on `rung`. Whoever
// runs the story sees the truth; a player sees what the table has heard
// (their characters know nothing else), unease kept in only when one of their
// own characters noticed it, and an ultimatum's terms once it was said. A
// held plan stays a storyteller secret the same way: its rung was never said.
export function viewFor(viewer: ConscienceViewer, conscience: Conscience, rung: number): LadderSight {
  const keptIn = Boolean(conscience.concealed) && rung === UNEASY;
  if (viewer.storyteller) {
    return {
      rung: rungName(rung),
      terms: Boolean(conscience.ultimatum),
      unheard: Boolean(conscience.owed),
      hidden: keptIn,
      noticedBy: keptIn ? [...(conscience.concealed?.noticedBy ?? [])] : [],
      noticed: false,
    };
  }
  const noticed = keptIn && (conscience.concealed?.noticedBy ?? []).some((id) => viewer.characterIds.includes(id));
  const shown = Math.max(Math.min(rung, conscience.told), noticed ? UNEASY : 0);
  return {
    rung: rungName(shown),
    terms: Boolean(conscience.ultimatum) && shown >= ULTIMATUM,
    unheard: false,
    hidden: false,
    noticedBy: [],
    noticed: noticed && shown === UNEASY,
  };
}
