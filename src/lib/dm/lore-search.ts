import { campaignLanguage } from "@/lib/db/campaigns";
import { getDatabase } from "@/lib/db/core";
import { listLoreWithEmbeddings } from "@/lib/db/lore";
import { embed, similarityOf } from "@/lib/embeddings";
import { searchScenes } from "@/lib/dm/memory-index";
import { computeIdf, fuseRanked, lexicalScore } from "@/lib/dm/fusion-logic";
import { hasWorldDoc, worldView } from "@/lib/db/world-forge";
import { listPrepCards } from "@/lib/db/prep-cards";
import { getCampaignById } from "@/lib/db/campaigns";
import { bestPassage } from "@/lib/dm/passage";
import { placementOf } from "@/lib/dm/prep-logic";
import { parseRef, typeFor } from "@/lib/worldforge/model";
import { canonAdmits, canonMeaning, eventLine, secretStanding } from "@/lib/worldforge/canon";
import { fieldLines } from "@/lib/worldforge/time";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { accountOf } from "@/lib/worldforge/account";

// search_lore: the DM's world-knowledge search. One query runs against
// every canon source at once: the lead's world lore entries, the
// server-tracked fact register, public party notes, the semantic chapter
// memory, and the prep cards an imported storyboard left (DM-only, issue
// #301). recall_story remains the tool for "what happened in chapter N";
// this one answers "what is true about X".
//
// A long body answers with the passage nearest the query rather than its
// opening (issue #302, src/lib/dm/passage.ts); the whole entry is still one
// read_card or one lore page away.
//
// WorldForge's records follow the canon policy every model path shares
// (src/lib/worldforge/canon.ts, audit WF-14): a retired entry or event is left
// out, and a draft or alternate one answers with a canon line saying what it
// is, so the DM never takes another telling for history. Secrets answer too,
// each saying whether the party has learned it.

export const searchLoreTool = {
  type: "function",
  function: {
    name: "search_lore",
    description:
      "Search the campaign's established canon: world lore, tracked facts, party notes, past chapters, and the DM-only prep cards of an imported storyboard. Call it before inventing details about places, factions, history, or NPCs that may already be established. A long entry answers with the passage nearest the query.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "What to look up about the world, its people, places, or history.",
        },
        category: {
          type: "string",
          enum: [
            "geography",
            "factions",
            "history",
            "magic",
            "culture",
            "religion",
            "npc",
            "location",
            "promise",
            "any",
          ],
          description: "A filter; 'any' searches everything.",
        },
      },
      required: ["query"],
    },
  },
} as const;

const RESULT_LIMIT = 8;
const TEXT_CLIP = 400;

// Fact categories that a tool-call category filter maps onto.
const FACT_CATEGORY_MAP: Record<string, string[]> = {
  npc: ["npc"],
  location: ["location"],
  promise: ["promise"],
  geography: ["location", "world"],
  factions: ["world", "npc"],
  history: ["world", "lore"],
  magic: ["lore", "world"],
  culture: ["lore", "world"],
  religion: ["lore", "world"],
};

// One candidate from any source. Everything competes in a single fused
// ranking: previously each source was scored on whichever scale happened to
// apply (cosine when it had an embedding, a keyword fraction when it did
// not, and searchScenes' own similarity for chapters), then all four were
// sorted against each other as though those numbers meant the same thing.
type LoreCandidate = {
  id: string;
  source: string;
  ref: string;
  text: string;
  // What lexical scoring reads, which is usually wider than the shown text.
  haystack: string;
  embedding: Buffer | null;
  // Pre-computed similarity for sources that already did the cosine work.
  similarity?: number | null;
  // What a WorldForge record that is not canon is (canonMeaning), shown with
  // the result.
  canon?: string;
};

export async function handleSearchLore(
  campaignId: string,
  rawArguments: string,
): Promise<ToolResult> {
  let args: { query?: unknown; category?: unknown };
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { error: "Invalid arguments.", retry: true };
  }
  const query = String(args.query ?? "").trim();
  if (!query) {
    return { error: "Give a query describing what to look up.", retry: true };
  }
  const category = String(args.category ?? "any");

  let queryVector: Float32Array | null = null;
  try {
    [queryVector] = await embed([query], { query: true });
  } catch (error) {
    // Keyword fallback carries the search.
    console.error("[lore-search] embedding failed", error);
  }

  const candidates: LoreCandidate[] = [];
  const db = getDatabase();
  const language = campaignLanguage(campaignId);
  // The passage of a body nearest the query, scored the way the ranking
  // scores (lexical, against the query's own terms); the head when nothing
  // in the body answers.
  const passageIdf = computeIdf([query], language);
  const passage = (body: string) => bestPassage(body, (text) => lexicalScore(query, text, passageIdf, language), TEXT_CLIP);

  // Lead-authored world lore.
  if (
    category === "any" ||
    ["geography", "factions", "history", "magic", "culture", "religion"].includes(category)
  ) {
    for (const { entry, embedding } of listLoreWithEmbeddings(campaignId)) {
      if ((category !== "any" && entry.category !== category) || (entry.canon && !canonAdmits(entry.canon, "play"))) {
        continue;
      }
      candidates.push({
        id: `lore:${entry.id}`,
        source: "world lore",
        ref: `${entry.category}: ${entry.title}`,
        text: passage(entry.body),
        haystack: `${entry.title} ${entry.tags.join(" ")} ${entry.body}`,
        embedding,
        ...(entry.canon ? { canon: canonMeaning(entry.canon) } : {}),
      });
    }
  }

  // The prep cards of an imported storyboard (src/lib/db/prep-cards.ts):
  // DM-only, like the arc they feed, and the DM is the caller. Each says
  // where it stands in the arc, so a card the render held back for room
  // still surfaces when the scene reaches it.
  if (category === "any" || ["history", "geography", "location", "npc"].includes(category)) {
    const arc = getCampaignById(campaignId)?.storyArc ?? null;
    for (const card of listPrepCards(campaignId)) {
      const placement = placementOf(arc, card.cardId);
      const standing =
        placement?.kind === "beat"
          ? `beat ${placement.number}, ${placement.status}`
          : placement?.kind === "event"
            ? `planned event ${placement.id}, ${placement.status}`
            : card.role;
      candidates.push({
        id: `prep:${card.id}`,
        source: "prep card (DM-only storyboard)",
        ref: `${card.title} (${standing}; read_card ${placement?.kind === "event" ? placement.id : placement?.kind === "beat" ? placement.number : `"${card.title}"`} for the whole card)`,
        text: passage(`${card.trigger ? `When: ${card.trigger}\n\n` : ""}${card.body || card.title}${card.cues ? `\n\n${card.cues}` : ""}`),
        haystack: `${card.title} ${card.trigger} ${card.cues} ${card.body}`,
        embedding: null,
      });
    }
  }

  // The table's WorldForge (src/lib/worldforge/model.ts): each entry's
  // article, fields and hidden truth, and the dated events of its history.
  // The DM is the caller, so the hidden truths come too, marked as such; a
  // retired entry is history the world no longer holds to.
  if (category === "any" || ["npc", "location", "factions", "history", "geography", "culture", "religion", "magic"].includes(category)) {
    for (const candidate of worldForgeCandidates(campaignId, category)) {
      candidates.push(candidate);
    }
  }

  // Server-tracked facts (DM-only facts included; the DM is the caller).
  const factCategories = category === "any" ? null : (FACT_CATEGORY_MAP[category] ?? null);
  const factRows = db
    .prepare(
      `SELECT id, category, subject, fact, embedding FROM world_facts
       WHERE campaign_id = ? AND status = 'active'`,
    )
    .all(campaignId) as Array<{
    id: string;
    category: string;
    subject: string;
    fact: string;
    embedding: Buffer | null;
  }>;
  for (const row of factRows) {
    if (factCategories && !factCategories.includes(row.category)) {
      continue;
    }
    candidates.push({
      id: `fact:${row.id}`,
      source: "fact",
      ref: `${row.category}${row.subject ? `: ${row.subject}` : ""}`,
      text: row.fact.slice(0, TEXT_CLIP),
      haystack: `${row.subject} ${row.fact}`,
      embedding: row.embedding,
    });
  }

  // Public active party notes (never private notes or pending suggestions).
  const noteRows = db
    .prepare(
      `SELECT id, title, body, embedding FROM campaign_notes
       WHERE campaign_id = ? AND character_id IS NULL
         AND visibility = 'public' AND status = 'active'`,
    )
    .all(campaignId) as Array<{
    id: string;
    title: string;
    body: string;
    embedding: Buffer | null;
  }>;
  for (const row of noteRows) {
    candidates.push({
      id: `note:${row.id}`,
      source: "party note",
      ref: row.title || "note",
      text: passage(row.body),
      haystack: `${row.title} ${row.body}`,
      embedding: row.embedding,
    });
  }

  // Chapter memory: verbatim scenes from the semantic index, already fused
  // and MMR-diversified in searchScenes. They join the same pool so a
  // transcript excerpt can genuinely outrank a lore entry.
  try {
    const scenes = await searchScenes(campaignId, query);
    for (const scene of scenes) {
      candidates.push({
        id: `scene:${scene.chapterIndex}:${scene.seqStart}`,
        source: "past chapter",
        ref: `chapter ${scene.chapterIndex}`,
        text: scene.text.slice(0, TEXT_CLIP),
        haystack: scene.text,
        embedding: null,
        similarity: scene.similarity || null,
      });
    }
  } catch {
    // Chapter memory unavailable; the other sources still answer.
  }

  const idf = computeIdf(candidates.map((candidate) => candidate.haystack), language);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const results = fuseRanked(
    candidates.map((candidate) => ({
      id: candidate.id,
      lexical: lexicalScore(query, candidate.haystack, idf, language),
      similarity:
        candidate.similarity !== undefined
          ? candidate.similarity
          : similarityOf(queryVector, candidate.embedding),
    })),
    { limit: RESULT_LIMIT },
  )
    .map((id) => byId.get(id))
    .filter((candidate): candidate is LoreCandidate => candidate !== undefined)
    .map(({ source, ref, text, canon }) => ({ source, ref, text, ...(canon ? { canon } : {}) }));
  if (!results.length) {
    return {
      results: [],
      note: "Nothing established matches. You may invent this detail freely; keep it consistent with what you do know.",
    };
  }
  return {
    results,
    // Retrieval has no relevance cut-off (fusion-logic.ts).
    note: "These are established canon, nearest to your query first; some may not concern it. Stay strictly consistent with every one that does. One with a canon line is not established: follow what that line says. If none does, this detail is not established and you may invent it, consistent with what you do know.",
  };
}

const SHELF_CATEGORY: Record<string, string[]> = {
  npc: ["npc"],
  location: ["location", "geography"],
  faction: ["factions"],
  lore: ["history", "magic", "culture", "religion", "geography"],
};

function worldForgeCandidates(campaignId: string, category: string): LoreCandidate[] {
  if (!hasWorldDoc(campaignId)) {
    return [];
  }
  const { doc, entities } = worldView(campaignId);
  const out: LoreCandidate[] = [];
  const inCategory = (shelf: string) => category === "any" || (SHELF_CATEGORY[shelf] ?? []).includes(category);
  for (const entity of entities) {
    if (!canonAdmits(entity.entry.canon, "play") || !inCategory(entity.shelf)) {
      continue;
    }
    const type = typeFor(doc, entity.shelf, entity.entry.typeId);
    const fields = fieldLines(type, entity.entry, doc.calendars, false)
      .map(({ def, text }) => `${def.name}: ${text}`)
      .join("; ");
    const article = accountOf(entity);
    const body = [article, fields, entity.entry.hiddenTruth ? `(secretly: ${entity.entry.hiddenTruth})` : ""].filter(Boolean).join(" ");
    if (!body.trim()) {
      continue;
    }
    out.push({
      id: `world:${entity.ref}`,
      source: "worldforge",
      ref: `${type.name}: ${entity.name}`,
      text: body.slice(0, TEXT_CLIP),
      haystack: `${entity.name} ${entity.aliases.join(" ")} ${entity.entry.aliases.join(" ")} ${entity.tags.join(" ")} ${body}`,
      embedding: null,
      ...(entity.entry.canon !== "canon" ? { canon: canonMeaning(entity.entry.canon) } : {}),
    });
  }
  const nameOf = new Map(entities.filter((entity) => canonAdmits(entity.entry.canon, "play")).map((entity) => [entity.ref, entity.name]));
  if (category === "any" || category === "history") {
    for (const event of doc.events.filter((entry) => canonAdmits(entry.canon, "play"))) {
      const names = event.refs.map((ref) => nameOf.get(ref)).filter(Boolean).join(", ");
      out.push({
        id: `world-event:${event.id}`,
        source: "worldforge timeline",
        ref: eventLine(event, doc.calendars, true),
        text: `${event.body}${names ? ` (involves ${names})` : ""}`.slice(0, TEXT_CLIP),
        haystack: `${event.title} ${event.era} ${event.body} ${names}`,
        embedding: null,
        ...(event.canon !== "canon" ? { canon: canonMeaning(event.canon) } : {}),
      });
    }
  }
  // Secrets, each saying where it stands with the party: one it has learned
  // is established for it, the rest are the DM's alone.
  for (const secret of doc.secrets) {
    const subject = parseRef(secret.subject);
    if (category !== "any" && !(subject && inCategory(subject.shelf))) {
      continue;
    }
    const about = nameOf.get(secret.subject) ?? "";
    const knowers = secret.knownBy.map((ref) => nameOf.get(ref)).filter(Boolean).join(", ");
    out.push({
      id: `world-secret:${secret.id}`,
      source: "worldforge secret",
      ref: `${secret.title}${about ? ` (about ${about})` : ""}`,
      text: `${secretStanding(secret)}.${secret.notes ? ` ${secret.notes}` : ""}${knowers ? ` Known by ${knowers}.` : ""}`.slice(0, TEXT_CLIP),
      haystack: `${secret.title} ${about} ${secret.notes} ${knowers}`,
      embedding: null,
    });
  }
  return out;
}
