import type { Stub } from "./model.ts";
import { commonWords, compareNames, foldName } from "../language/text-logic.ts";

// Mentions and the names still to be written, after WorldForge's mentions
// and stubs modules (by Smoebo). Pure.

export type Named = { ref: string; name: string; aliases: string[] };

// ---- mentions ----
//
// An entry's text links every other entry it names: exact case, whole words
// by Unicode letters (so "Élodie" is found and "José" is not inside
// "Joséphine"),
// the longest name first (so "Arvendeth Keep" beats "Arvendeth"), names under
// three letters skipped, the entry itself left out. When two entries share a
// name the first one wins.

export type Segment = { text: string; ref?: string };

export function mentionSegments(text: string, named: Named[], selfRef = ""): Segment[] {
  if (!text) return [];
  const handles: Array<{ handle: string; ref: string }> = [];
  for (const entry of named) {
    if (entry.ref === selfRef) continue;
    for (const handle of [entry.name, ...entry.aliases]) {
      if (handle.length >= 3) handles.push({ handle, ref: entry.ref });
    }
  }
  if (!handles.length) return [{ text }];
  handles.sort((a, b) => b.handle.length - a.handle.length);
  const byHandle = new Map<string, string>();
  for (const { handle, ref } of handles) if (!byHandle.has(handle)) byHandle.set(handle, ref);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${[...byHandle.keys()].map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}_])`, "gu");
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) out.push({ text: text.slice(last, match.index) });
    out.push({ text: match[0], ref: byHandle.get(match[0]) });
    last = match.index! + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

// ---- names still to be written ----
//
// A stub is a name that deserves an entry it does not have yet. The scan
// reads the world's text for runs of capitalised words that name nothing
// known: a run of two or more words counts at once ("Vale of Sorrows"), a
// single word needs two sightings, one of them mid-sentence, because a
// capital at the start of a sentence is how most languages write, not a
// name. Nothing is stored until the DM keeps or dismisses a hit, and a
// dismissed name never comes back.
//
// It reads structure, the same way in every language: a run's first word
// at a sentence start ("The", "Puis", "Il") stays only if the world also
// capitalises it mid-sentence ("in New York"); a single word the world
// writes in lower case somewhere ("captain", "ponte") is a common word, not
// a name; and a lower-case word joins two capitalised ones ("of", "della",
// "von") once the world writes it between two different pairs of them, its
// own names included.

const CAPITAL = "\\p{Lu}[\\p{L}\\p{M}\\p{N}'\u2019-]*";
const capital = new RegExp(`(?<![\\p{L}\\p{N}])${CAPITAL}`, "gu");
const LINKED = new RegExp(`(?<![\\p{L}\\p{N}])(${CAPITAL}) (\\p{Ll}[\\p{L}\\p{M}]*) (?=(${CAPITAL}))`, "gu");

// The lower-case words the world writes between two different pairs of
// capitalised words.
function connectorsIn(texts: readonly string[]): Set<string> {
  const pairs = new Map<string, Set<string>>();
  for (const text of texts) {
    for (const [, before, word, after] of text.matchAll(LINKED)) {
      const seen = pairs.get(word) ?? new Set<string>();
      seen.add(`${before}\u0000${after}`);
      pairs.set(word, seen);
    }
  }
  return new Set([...pairs].filter(([, seen]) => seen.size >= 2).map(([word]) => word));
}

function atSentenceStart(text: string, index: number): boolean {
  for (let j = index - 1; j >= 0; j -= 1) {
    const c = text[j];
    if (c === "\n") return true;
    if (/["'\u201C\u2018\u00AB\u00BB\u201E\u2039\u203A\u00A1\u00BF(\[\u2014\s]/u.test(c)) continue;
    return /[.!?:\u2026]/u.test(c);
  }
  return true;
}

const handlesOf = (named: Named[]) =>
  named.flatMap((entry) => [entry.name, ...entry.aliases]).map(foldName).filter(Boolean);
const wordSubset = (container: string, part: string) => ` ${container} `.includes(` ${part} `);

export function stubScan(texts: string[], named: Named[], stubs: Stub[]): Array<{ name: string; count: number }> {
  const handles = handlesOf(named);
  const known = new Set([...handles, ...stubs.map((stub) => foldName(stub.name))]);
  const common = commonWords(texts);
  const connectors = connectorsIn([...texts, ...named.flatMap((entry) => [entry.name, ...entry.aliases]), ...stubs.map((stub) => stub.name)]);
  const joiner = connectors.size ? `(?: (?:${[...connectors].join("|")}))?` : "";
  const run = new RegExp(`(?<![\\p{L}\\p{N}])${CAPITAL}(?:${joiner} ${CAPITAL})*`, "gu");
  const midCapitals = new Set(
    texts.flatMap((text) => [...text.matchAll(capital)].filter((match) => !atSentenceStart(text, match.index)).map((match) => match[0])),
  );
  const tally = new Map<string, { name: string; count: number; mid: boolean }>();
  for (const text of texts) {
    for (const match of text.matchAll(run)) {
      const parts = match[0].replace(/['\u2019]s$/u, "").replace(/['\u2019-]+$/u, "").split(" ");
      const atStart = atSentenceStart(text, match.index);
      let stripped = false;
      if (parts.length > 1 && atStart && !midCapitals.has(parts[0])) {
        parts.shift();
        stripped = true;
      }
      while (parts.length > 1 && connectors.has(parts[0])) {
        parts.shift();
        stripped = true;
      }
      const name = parts.join(" ");
      if (!name) continue;
      const low = foldName(name);
      const seen = tally.get(low) ?? { name, count: 0, mid: false };
      seen.count += 1;
      if (stripped || !atStart) seen.mid = true;
      tally.set(low, seen);
    }
  }
  const out: Array<{ name: string; count: number }> = [];
  for (const [low, seen] of tally) {
    const words = low.split(" ").filter((word) => !connectors.has(word));
    if (words.length <= 1) {
      const word = words[0] ?? "";
      if (word.length < 3 || common.has(word) || seen.count < 2 || !seen.mid) continue;
    }
    if (known.has(low) || handles.some((handle) => wordSubset(handle, low) || wordSubset(low, handle))) continue;
    out.push({ name: seen.name, count: seen.count });
  }
  return out.sort((a, b) => b.count - a.count || compareNames(a.name, b.name));
}

// The entry that now answers to a stub's name, if one does: the stub is
// done and can be cleared.
export function stubResolved(stub: Stub, named: Named[]): Named | null {
  const low = foldName(stub.name);
  return named.find((entry) => [entry.name, ...entry.aliases].some((handle) => foldName(handle) === low)) ?? null;
}
