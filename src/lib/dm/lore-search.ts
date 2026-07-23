import { getDatabase } from "@/lib/db/core";
import { listLoreWithEmbeddings } from "@/lib/db/lore";
import { bufferToVector, cosine, embed } from "@/lib/embeddings";
import { searchScenes } from "@/lib/dm/memory-index";
import { scoreLoreByKeywords } from "@/lib/dm/world-lore-logic";

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
const KEYWORD_FLOOR = 0.34;
const VECTOR_FLOOR = 0.28;

type LoreHit = { source: string; ref: string; text: string; score: number };

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

function keywordScore(query: string, haystack: string): number {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length > 2);
  if (!words.length) {
    return 0;
  }
  const lowered = haystack.toLowerCase();
  let hits = 0;
  for (const word of words) {
    if (lowered.includes(word)) {
      hits += 1;
    }
  }
  return hits / words.length;
}

function scored(
  queryVector: Float32Array | null,
  embedding: Buffer | null,
  fallback: () => number,
): number | null {
  if (queryVector && embedding) {
    const vector = bufferToVector(embedding);
    if (vector) {
      const similarity = cosine(queryVector, vector);
      return similarity >= VECTOR_FLOOR ? similarity : null;
    }
  }
  const score = fallback();
  return score >= KEYWORD_FLOOR ? score : null;
}

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

  const hits: LoreHit[] = [];
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
      const score = scored(queryVector, embedding, () => scoreLoreByKeywords(query, entry));
      if (score !== null) {
        hits.push({
          source: "world lore",
          ref: `${entry.category}: ${entry.title}`,
          text: entry.body.slice(0, TEXT_CLIP),
          score,
        });
      }
    }
  }

  // Server-tracked facts (DM-only facts included; the DM is the caller).
  const factCategories = category === "any" ? null : (FACT_CATEGORY_MAP[category] ?? null);
  const factRows = db
    .prepare(
      `SELECT category, subject, fact, embedding FROM world_facts
       WHERE campaign_id = ? AND status = 'active'`,
    )
    .all(campaignId) as Array<{
    category: string;
    subject: string;
    fact: string;
    embedding: Buffer | null;
  }>;
  for (const row of factRows) {
    if (factCategories && !factCategories.includes(row.category)) {
      continue;
    }
    const score = scored(queryVector, row.embedding, () =>
      keywordScore(query, `${row.subject} ${row.fact}`),
    );
    if (score !== null) {
      hits.push({
        source: "fact",
        ref: `${row.category}${row.subject ? `: ${row.subject}` : ""}`,
        text: row.fact.slice(0, TEXT_CLIP),
        score,
      });
    }
  }

  // Public active party notes (never private notes or pending suggestions).
  const noteRows = db
    .prepare(
      `SELECT title, body, embedding FROM campaign_notes
       WHERE campaign_id = ? AND character_id IS NULL
         AND visibility = 'public' AND status = 'active'`,
    )
    .all(campaignId) as Array<{ title: string; body: string; embedding: Buffer | null }>;
  for (const row of noteRows) {
    const score = scored(queryVector, row.embedding, () =>
      keywordScore(query, `${row.title} ${row.body}`),
    );
    if (score !== null) {
      hits.push({
        source: "party note",
        ref: row.title || "note",
        text: row.body.slice(0, TEXT_CLIP),
        score,
      });
    }
  }

  // Chapter memory: verbatim scenes from the semantic index.
  try {
    const scenes = await searchScenes(campaignId, query);
    for (const scene of scenes.slice(0, 2)) {
      hits.push({
        source: "past chapter",
        ref: `chapter ${scene.chapterIndex}`,
        text: scene.text.slice(0, TEXT_CLIP),
        score: scene.similarity,
      });
    }
  } catch {
    // Chapter memory unavailable; the other sources still answer.
  }

  hits.sort((a, b) => b.score - a.score);
  const results = hits.slice(0, RESULT_LIMIT).map(({ source, ref, text }) => ({
    source,
    ref,
    text,
  }));
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
