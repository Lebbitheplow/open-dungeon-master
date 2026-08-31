import {
  listConditions,
  searchFeats,
  searchItems,
  searchMonsters,
  searchSpells,
  type ContentEntry,
} from "@/lib/content";
import { normalizeSettings } from "@/lib/db/settings";
import { requestUtilityMessage } from "@/lib/dm/model";
import { enqueueDmJob } from "@/lib/dm/queue";
import { describeContentEntry, glossaryTerms } from "@/lib/help";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { rulingSources } from "@/lib/reference/rulings";
import {
  DESK_SYSTEM,
  checkCitations,
  clampDeskQuestion,
  deskTerms,
  parseDeskJson,
  renderEvidence,
  selectEvidence,
  type DeskAnswer,
  type DeskSource,
} from "@/lib/reference/desk-logic";

// The research desk's model call: gather, rank, ask once, verify.
//
// The gathering is deliberately dumb and cheap. Content rows are found by
// NAME against the words in the question, which is what the content database
// indexes, and the ranking that decides what actually reaches the model is
// the pure keyword score in desk-logic.ts. No embeddings: the campaign
// memory index exists per campaign and this desk is not in one, and a
// question about a spell almost always contains that spell's name.
//
// Everything the model gets back is checked against what it was given
// before it reaches a person. See desk-logic.ts for why that matters.

// The desk has no campaign, but it shares the one model server with every
// table on this machine, so it queues under a key of its own: desk questions
// serialize against each other and never jump a live narration's queue.
const DESK_QUEUE = "reference-desk";

// Per kind, per term. Small on purpose: the ranking is what picks the
// evidence, and a hundred candidates only makes it slower to be wrong.
const PER_KIND = 4;
const MAX_TERMS = 6;

function entrySource(
  kind: DeskSource["kind"],
  entry: ContentEntry,
  origin: string,
): DeskSource | null {
  const text = describeContentEntry(entry.data);
  if (!text) {
    return null;
  }
  return {
    kind,
    ref: `${kind}:${entry.slug}`,
    name: entry.name,
    text: `${entry.name}. ${text}`,
    origin: entry.source === "homebrew" ? "your homebrew" : origin,
  };
}

// Everything the desk could cite for this question. Deduped by ref, because
// two terms of the same question routinely find the same spell.
function gatherSources(userId: string, question: string): DeskSource[] {
  const byRef = new Map<string, DeskSource>();
  const add = (source: DeskSource | null) => {
    if (source && !byRef.has(source.ref)) {
      byRef.set(source.ref, source);
    }
  };

  // The app's own plain-language rules text. Always offered in full: there
  // are a few dozen terms, and they are the only prose the desk has for a
  // question about the system rather than about a specific row.
  for (const term of glossaryTerms()) {
    add({
      kind: "glossary",
      ref: `glossary:${term.id}`,
      name: term.term,
      text: [term.term, term.short, term.long].filter(Boolean).join(". "),
      origin: "the rules basics",
    });
  }

  // Conditions are a closed list of about fifteen rows, so the whole set is
  // offered rather than searched: "am I prone if I am grappled" names
  // neither condition the way the table spells it.
  for (const entry of listConditions({ userId })) {
    add(entrySource("condition", entry, "SRD condition"));
  }

  for (const term of deskTerms(question).slice(0, MAX_TERMS)) {
    const options = { q: term, userId, limit: PER_KIND };
    for (const entry of searchSpells(options)) {
      add(entrySource("spell", entry, "SRD spell"));
    }
    for (const entry of searchMonsters(options)) {
      add(entrySource("monster", entry, "SRD monster"));
    }
    for (const entry of searchItems(options)) {
      add(entrySource("item", entry, "SRD item"));
    }
    for (const entry of searchFeats(options)) {
      add(entrySource("feat", entry, "SRD feat"));
    }
  }

  // The table's own rules, through the same module the browse tab searches,
  // so a ruling the desk can cite is exactly a ruling a DM can find by hand.
  for (const source of rulingSources(userId)) {
    add(source);
  }

  return [...byRef.values()];
}

export type DeskRequest = { userId: string; question: string };

export async function runRulesDesk(
  request: DeskRequest,
): Promise<DeskAnswer | { error: string }> {
  const question = clampDeskQuestion(request.question);
  if (!question) {
    return { error: "Ask a question first." };
  }

  const evidence = selectEvidence(question, gatherSources(request.userId, question));
  let result: DeskAnswer | { error: string } = {
    error: "The model is unavailable; try again shortly.",
  };

  await enqueueDmJob(DESK_QUEUE, async () => {
    // No trackUtilityCall here, unlike ask.ts and lore-check.ts: the tracker
    // publishes a chip into a CAMPAIGN's status strip, and the desk is not in
    // a campaign. There is nowhere for that chip to land.
    const { message, error } = await requestUtilityMessage(
      normalizeSettings(),
      [
        { role: "system", content: DESK_SYSTEM },
        {
          role: "user",
          content: [
            `Question: ${question}`,
            evidence.length
              ? `REFERENCE DATA START\n\n${renderEvidence(evidence)}\n\nREFERENCE DATA END`
              : "REFERENCE DATA START\n\n(nothing on file bears on this question)\n\nREFERENCE DATA END",
          ].join("\n\n"),
        },
      ],
      { timeoutMs: arcTextTimeoutMs() },
    );
    if (error) {
      return;
    }
    const parsed = parseDeskJson(typeof message?.content === "string" ? message.content : "");
    if (!parsed) {
      result = { error: "The model did not answer in a shape the desk could read." };
      return;
    }
    result = checkCitations(parsed, evidence);
  });

  return result;
}

// What the desk WOULD cite, without spending a model call. The panel shows
// this as the question is typed, so a DM can see the desk found nothing
// before they wait on an answer built from nothing.
export function previewSources(userId: string, question: string) {
  const clamped = clampDeskQuestion(question);
  if (!clamped) {
    return [];
  }
  return selectEvidence(clamped, gatherSources(userId, clamped)).map((source) => ({
    kind: source.kind,
    ref: source.ref,
    name: source.name,
    origin: source.origin,
  }));
}
