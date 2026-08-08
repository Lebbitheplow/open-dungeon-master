import { getDatabase } from "@/lib/db/core";
import { listLoreWithEmbeddings } from "@/lib/db/lore";
import { embed, similarityOf } from "@/lib/embeddings";
import { searchScenes } from "@/lib/dm/memory-index";
import { computeIdf, fuseRanked, lexicalScore } from "@/lib/dm/fusion-logic";

// search_lore: the DM's world-knowledge search. One query runs against
// every canon source at once: the lead's world lore entries, the
// server-tracked fact register, public party notes, and the semantic
// chapter memory. recall_story remains the tool for "what happened in
// chapter N"; this one answers "what is true about X".

export const searchLoreTool = {
  type: "function",
  function: {
    name: "search_lore",
    description:
      "Search the campaign's established canon: world lore, tracked facts, party notes, and past chapters. Use before inventing details about places, factions, history, or NPCs that may already be established.",
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
          description: "Optional filter; 'any' searches everything.",
        },
      },
      required: ["query"],
    },
  },
} as const;

const RESULT_LIMIT = 8;
const TEXT_CLIP = 400;
const VECTOR_FLOOR = 0.28;

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
};

export async function handleSearchLore(
  campaignId: string,
  rawArguments: string,
): Promise<Record<string, unknown>> {
  let args: { query?: unknown; category?: unknown };
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { error: "Invalid arguments." };
  }
  const query = String(args.query ?? "").trim();
  if (!query) {
    return { error: "Give a query describing what to look up." };
  }
  const category = String(args.category ?? "any");

  let queryVector: Float32Array | null = null;
  try {
    [queryVector] = await embed([query]);
  } catch {
    // Keyword fallback carries the search.
  }

  const candidates: LoreCandidate[] = [];
  const db = getDatabase();

  // Lead-authored world lore.
  if (
    category === "any" ||
    ["geography", "factions", "history", "magic", "culture", "religion"].includes(category)
  ) {
    for (const { entry, embedding } of listLoreWithEmbeddings(campaignId)) {
      if (category !== "any" && entry.category !== category) {
        continue;
      }
      candidates.push({
        id: `lore:${entry.id}`,
        source: "world lore",
        ref: `${entry.category}: ${entry.title}`,
        text: entry.body.slice(0, TEXT_CLIP),
        haystack: `${entry.title} ${entry.tags.join(" ")} ${entry.body}`,
        embedding,
      });
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
      text: row.body.slice(0, TEXT_CLIP),
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

  const idf = computeIdf(candidates.map((candidate) => candidate.haystack));
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const results = fuseRanked(
    candidates.map((candidate) => ({
      id: candidate.id,
      lexical: lexicalScore(query, candidate.haystack, idf),
      similarity:
        candidate.similarity !== undefined
          ? candidate.similarity
          : similarityOf(queryVector, candidate.embedding),
    })),
    { similarityFloor: VECTOR_FLOOR, limit: RESULT_LIMIT },
  )
    .map((id) => byId.get(id))
    .filter((candidate): candidate is LoreCandidate => candidate !== undefined)
    .map(({ source, ref, text }) => ({ source, ref, text }));
  if (!results.length) {
    return {
      results: [],
      note: "Nothing established matches. You may invent this detail freely; keep it consistent with what you do know.",
    };
  }
  return {
    results,
    note: "These are established canon; stay strictly consistent with them.",
  };
}
