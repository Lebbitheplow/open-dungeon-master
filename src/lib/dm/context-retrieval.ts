import type { Campaign } from "@/lib/db/campaigns";
import type { CampaignMessage } from "@/lib/db/messages";
import { listLoreWithEmbeddings } from "@/lib/db/lore";
import { listRuleChunksWithEmbeddings } from "@/lib/db/rules";
import { embed, similarityOf } from "@/lib/embeddings";
import { probeCustomContextWindow, storyContextTokens } from "@/lib/model-client";
import { renderLoreForPrompt, type WorldLoreEntry } from "@/lib/dm/world-lore-logic";
import { computeBudgets } from "@/lib/dm/context-budget";
import { selectRuleChunks } from "@/lib/dm/rules-activation-logic";
import { renderHouseRules, renderVariantRules } from "@/lib/dm/rules-logic";
import { computeIdf, fuseRanked, lexicalScore } from "@/lib/dm/fusion-logic";

// Per-turn retrieval for the DM prompt: one MiniLM embed of the current
// moment (latest player messages + scene) is fused with IDF-weighted lexical
// scoring over the enabled house-rule chunks and world-lore entries; only the
// most relevant few ride the prompt. Pinned items skip retrieval entirely.
// Every path tolerates NULL embeddings and an unavailable embedder, so
// retrieval can never break a turn.
//
// This used to be strictly either/or: cosine when an embedding existed and
// keyword overlap only when it did not, which threw the lexical signal away
// on every healthy turn. It also compared cosine similarities and keyword
// fractions against the same 0.3 threshold, two scales that never meant the
// same thing. Both are now handled by rank fusion (src/lib/dm/fusion-logic.ts),
// which reads order rather than magnitude.

// Cosine-only eligibility. Lexical eligibility is any overlap at all, so a
// rare proper noun still qualifies a candidate that cosine would have missed.
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

// Fuses one corpus and returns the picked entries in fused order.
function pickFused<T>(
  entries: Array<{ id: string; text: string; embedding: Buffer | null; value: T }>,
  query: string,
  queryVector: Float32Array | null,
  limit: number,
): T[] {
  if (!entries.length) {
    return [];
  }
  // IDF is computed over this corpus, so "dragon" is rare in a campaign that
  // never mentions dragons and unremarkable in one about nothing else.
  const idf = computeIdf(entries.map((entry) => entry.text));
  const byId = new Map(entries.map((entry) => [entry.id, entry.value]));
  const picked = fuseRanked(
    entries.map((entry) => ({
      id: entry.id,
      lexical: lexicalScore(query, entry.text, idf),
      similarity: similarityOf(queryVector, entry.embedding),
    })),
    { similarityFloor: SIMILARITY_FLOOR, limit },
  );
  return picked
    .map((id) => byId.get(id))
    .filter((value): value is T => value !== undefined);
}

export async function buildTurnRetrieval(
  campaign: Campaign,
  history: CampaignMessage[],
): Promise<TurnRetrieval> {
  // Resolved from the campaign's own provider and model rather than assuming
  // a default window, so the rules budget matches what the backend will
  // actually accept.
  // Ask the endpoint what window it was launched with before budgeting
  // against it. llama.cpp and llama-swap report their -c on /props; anything
  // else misses quietly and the configured or default value stands. Cached
  // per base URL, so this costs one request per process.
  if (campaign.settings.textProvider !== "local") {
    await probeCustomContextWindow(
      campaign.settings.customBaseUrl,
      campaign.settings.customApiKey,
    );
  }
  const contextLimitTokens = storyContextTokens(campaign.settings);
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

      // Pinned chunks and any whose trigger keyword appears in the query are
      // admitted outright; only what is left competes for the retrieval
      // slots. A small enough rules document rides whole and skips retrieval
      // (src/lib/dm/rules-activation-logic.ts).
      const activation = selectRuleChunks(
        rules.map((entry) => entry.chunk),
        query,
        computeBudgets(contextLimitTokens).retrieval,
      );
      const forcedIds = new Set(activation.forced.map((chunk) => chunk.id));
      const pinnedRules = activation.forced;
      const retrievedRules = activation.verbatim
        ? []
        : pickFused(
        rules
          .filter((entry) => !forcedIds.has(entry.chunk.id))
          .map((entry) => ({
            id: entry.chunk.id,
            text: `${entry.chunk.heading} ${entry.chunk.text}`,
            embedding: entry.embedding,
            value: entry.chunk,
          })),
        query,
        queryVector,
        RULES_TOP,
      );
      houseRulesBlock = renderHouseRules(pinnedRules, retrievedRules);

      const pinnedLore = lore.filter((entry) => entry.entry.pinned).map((entry) => entry.entry);
      const retrievedLore = pickFused(
        lore
          .filter((entry) => !entry.entry.pinned)
          .map((entry) => ({
            id: entry.entry.id,
            text: `${entry.entry.title} ${entry.entry.tags.join(" ")} ${entry.entry.body}`,
            embedding: entry.embedding,
            value: entry.entry as WorldLoreEntry,
          })),
        query,
        queryVector,
        LORE_TOP,
      );
      loreBlock = renderLoreForPrompt(pinnedLore, retrievedLore);
    }
  } catch (error) {
    console.error("[context-retrieval] failed", error);
  }
  return { variantRulesBlock, houseRulesBlock, loreBlock };
}
