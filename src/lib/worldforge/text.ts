import type { Stub } from "./model.ts";

// Mentions and the names still to be written, after WorldForge's mentions
// and stubs modules (by Smoebo). Pure.

export type Named = { ref: string; name: string; aliases: string[] };

// ---- mentions ----
//
// An entry's text links every other entry it names: exact case, whole words,
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
  const pattern = new RegExp(`(?<!\\w)(?:${[...byHandle.keys()].map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?!\\w)`, "g");
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
// capital at the start of a sentence is how English works, not a name.
// Nothing is stored until the DM keeps or dismisses a hit, and a dismissed
// name never comes back.

const CONNECTORS = ["of", "the", "and", "de", "du", "von", "van", "der", "el", "al", "la", "le"];
const CONNECTOR_SET = new Set(CONNECTORS);
const RUN = new RegExp(`[A-Z][A-Za-z'\\u2019-]*(?: (?:(?:${CONNECTORS.join("|")}) )?[A-Z][A-Za-z'\\u2019-]*)*`, "g");
const STOPWORDS = new Set(
  (
    "the a an and but or nor for yet so if when while after before then once now here there this that these those he she they it we you i " +
    "his her their its our your my me him them us what who whom whose which where why how all any each every some no not none one two three " +
    "first last next many most much more few other another such only own same than too very can will just should would could may might must " +
    "shall do does did done is are was were be been being have has had in on at by to from with without into onto upon over under about " +
    "above below between through during against among within beyond across behind beside near far until since though although because " +
    "unless whether either neither both also even still already again yes oh ah alas dear sir lady lord king queen captain monday tuesday " +
    "wednesday thursday friday saturday sunday january february march april may june july august september october november december"
  ).split(" "),
);

function atSentenceStart(text: string, index: number): boolean {
  for (let j = index - 1; j >= 0; j -= 1) {
    const c = text[j];
    if (c === "\n") return true;
    if (/["'\u201C\u2018(\[\u2014\s]/.test(c)) continue;
    return /[.!?:]/.test(c);
  }
  return true;
}

const handlesOf = (named: Named[]) =>
  named.flatMap((entry) => [entry.name, ...entry.aliases]).map((handle) => handle.trim().toLowerCase()).filter(Boolean);
const wordSubset = (container: string, part: string) => ` ${container} `.includes(` ${part} `);

export function stubScan(texts: string[], named: Named[], stubs: Stub[]): Array<{ name: string; count: number }> {
  const handles = handlesOf(named);
  const known = new Set([...handles, ...stubs.map((stub) => stub.name.trim().toLowerCase())]);
  const tally = new Map<string, { name: string; count: number; mid: boolean }>();
  for (const text of texts) {
    for (const match of text.matchAll(RUN)) {
      const parts = match[0].replace(/['’]s$/, "").replace(/['’-]+$/, "").split(" ");
      let stripped = false;
      while (parts.length > 1 && (STOPWORDS.has(parts[0].toLowerCase()) || CONNECTOR_SET.has(parts[0].toLowerCase()))) {
        parts.shift();
        stripped = true;
      }
      const name = parts.join(" ");
      if (!name) continue;
      const low = name.toLowerCase();
      const seen = tally.get(low) ?? { name, count: 0, mid: false };
      seen.count += 1;
      if (stripped || !atSentenceStart(text, match.index!)) seen.mid = true;
      tally.set(low, seen);
    }
  }
  const out: Array<{ name: string; count: number }> = [];
  for (const [low, seen] of tally) {
    const words = low.split(" ").filter((word) => !CONNECTOR_SET.has(word));
    if (words.length <= 1) {
      const word = words[0] ?? "";
      if (word.length < 3 || STOPWORDS.has(word) || seen.count < 2 || !seen.mid) continue;
    }
    if (known.has(low) || handles.some((handle) => wordSubset(handle, low) || wordSubset(low, handle))) continue;
    out.push({ name: seen.name, count: seen.count });
  }
  return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// The entry that now answers to a stub's name, if one does: the stub is
// done and can be cleared.
export function stubResolved(stub: Stub, named: Named[]): Named | null {
  const low = stub.name.trim().toLowerCase();
  return named.find((entry) => [entry.name, ...entry.aliases].some((handle) => handle.trim().toLowerCase() === low)) ?? null;
}
