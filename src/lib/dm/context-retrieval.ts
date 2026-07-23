import type { Campaign } from "@/lib/db/campaigns";
import type { CampaignMessage } from "@/lib/db/messages";
import { listLoreWithEmbeddings } from "@/lib/db/lore";
import { listRuleChunksWithEmbeddings } from "@/lib/db/rules";
import { bufferToVector, cosine, embed } from "@/lib/embeddings";
import {
  renderLoreForPrompt,
  scoreLoreByKeywords,
  type WorldLoreEntry,
} from "@/lib/dm/world-lore-logic";
import {
  renderHouseRules,
  renderVariantRules,
  scoreRuleByKeywords,
} from "@/lib/dm/rules-logic";

// Per-turn retrieval for the DM prompt: one MiniLM embed of the current
// moment (latest player messages + scene) scores the enabled house-rule
// chunks and world-lore entries; only the most relevant few ride the
// prompt. Pinned items skip retrieval entirely. Every path tolerates NULL
// embeddings (keyword fallback) and an unavailable embedder, so retrieval
// can never break a turn.

const SIMILARITY_FLOOR = 0.3;
const RULES_TOP = 3;
const LORE_TOP = 2;

export type TurnRetrieval = {
  variantRulesBlock: string;
  houseRulesBlock: string;
  loreBlock: string;
};

// The moment to retrieve against: the newest player messages this turn is
// answering, grounded by the current scene label.
function buildQuery(campaign: Campaign, history: CampaignMessage[]): string {
  const playerLines: string[] = [];
  for (let index = history.length - 1; index >= 0 && playerLines.length < 3; index -= 1) {
    const message = history[index];
    if (message.authorType === "player") {
      playerLines.unshift(message.content.slice(0, 400));
    } else if (message.authorType === "dm" && playerLines.length) {
      break;
    }
  }
  return [campaign.scene, ...playerLines].filter(Boolean).join("\n").slice(0, 1_200);
}

function scoreWith(
  queryVector: Float32Array | null,
  embedding: Buffer | null,
  keywordScore: () => number,
): number {
  if (queryVector && embedding) {
    const vector = bufferToVector(embedding);
    if (vector) {
      return cosine(queryVector, vector);
    }
  }
  return keywordScore();
}

export async function buildTurnRetrieval(
  campaign: Campaign,
  history: CampaignMessage[],
): Promise<TurnRetrieval> {
  const variantRulesBlock = renderVariantRules(campaign.gameSettings.variantRules);
  let houseRulesBlock = "";
  let loreBlock = "";
  try {
    const rules = listRuleChunksWithEmbeddings(campaign.id).filter(
      (entry) => entry.chunk.enabled,
    );
    const lore = listLoreWithEmbeddings(campaign.id);
    if (rules.length || lore.length) {
      const query = buildQuery(campaign, history);
      let queryVector: Float32Array | null = null;
      const anyEmbedding =
        rules.some((entry) => entry.embedding) || lore.some((entry) => entry.embedding);
      if (query && anyEmbedding) {
        try {
          [queryVector] = await embed([query]);
        } catch {
          // Embedder unavailable; keyword fallback carries the turn.
        }
      }

      const pinnedRules = rules.filter((entry) => entry.chunk.pinned).map((entry) => entry.chunk);
      const retrievedRules = rules
        .filter((entry) => !entry.chunk.pinned)
        .map((entry) => ({
          chunk: entry.chunk,
          score: scoreWith(queryVector, entry.embedding, () =>
            scoreRuleByKeywords(query, entry.chunk),
          ),
        }))
        .filter((entry) => entry.score >= SIMILARITY_FLOOR)
        .sort((a, b) => b.score - a.score)
        .slice(0, RULES_TOP)
        .map((entry) => entry.chunk);
      houseRulesBlock = renderHouseRules(pinnedRules, retrievedRules);

      const pinnedLore = lore.filter((entry) => entry.entry.pinned).map((entry) => entry.entry);
      const retrievedLore = lore
        .filter((entry) => !entry.entry.pinned)
        .map((entry) => ({
          entry: entry.entry,
          score: scoreWith(queryVector, entry.embedding, () =>
            scoreLoreByKeywords(query, entry.entry),
          ),
        }))
        .filter((entry) => entry.score >= SIMILARITY_FLOOR)
        .sort((a, b) => b.score - a.score)
        .slice(0, LORE_TOP)
        .map((entry) => entry.entry as WorldLoreEntry);
      loreBlock = renderLoreForPrompt(pinnedLore, retrievedLore);
    }
  } catch (error) {
    console.error("[context-retrieval] failed", error);
  }
  return { variantRulesBlock, houseRulesBlock, loreBlock };
}
