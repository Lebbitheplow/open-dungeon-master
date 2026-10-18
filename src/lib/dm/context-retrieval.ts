import type { TableLanguage } from "@/lib/schemas/game-settings";
import type { Campaign } from "@/lib/db/campaigns";
import type { CampaignMessage } from "@/lib/db/messages";
import { listLoreWithEmbeddings } from "@/lib/db/lore";
import { canonAdmits } from "@/lib/worldforge/canon";
import { listRuleChunksWithEmbeddings } from "@/lib/db/rules";
import { embed, similarityOf } from "@/lib/embeddings";
import { probeCustomContextWindow, storyContextTokens } from "@/lib/model-client";
import { loreExcerpt, renderLoreBlock, type LoreTrace, type WorldLoreEntry } from "@/lib/dm/world-lore-logic";
import { loreBudgetChars, selectLore, type LoreMoment } from "@/lib/dm/lore-selection";
import { CHARS_PER_TOKEN, computeBudgets, promptWindowTokens } from "@/lib/dm/context-budget";
import { selectRuleChunks } from "@/lib/dm/rules-activation-logic";
import { isNarration } from "@/lib/dm/ooc-question";
import { renderHouseRulesWithTrace, renderVariantRules } from "@/lib/dm/rules-logic";
import { clipKeepingEnds } from "@/lib/dm/ask-logic";
import { createHash } from "node:crypto";
import { computeIdf, fuseRanked, lexicalScore } from "@/lib/dm/fusion-logic";

// Per-turn retrieval for the DM prompt: one local embed of the current
// moment (latest player messages + scene) is fused with IDF-weighted lexical
// scoring over the enabled house-rule chunks and world-lore entries; only the
// most relevant few ride the prompt. Pinned items skip retrieval entirely.
// World lore keeps every close match up to a cap, inside a budget measured
// from the window, and records what it kept and held back for the context
// inspector (issue #305, src/lib/dm/lore-selection.ts).
// Every path tolerates NULL embeddings and an unavailable embedder, so
// retrieval can never break a turn.
//
// This used to be strictly either/or: cosine when an embedding existed and
// keyword overlap only when it did not, which threw the lexical signal away
// on every healthy turn. It also compared cosine similarities and keyword
// fractions against the same 0.3 threshold, two scales that never meant the
// same thing. Both are now handled by rank fusion (src/lib/dm/fusion-logic.ts),
// which reads order rather than magnitude.

const RULES_TOP = 3;

export type TurnRetrieval = {
  variantRulesBlock: string;
  houseRulesBlock: string;
  loreBlock: string;
  // What the lore block kept and held back, and why; absent when the
  // campaign has no lore.
  loreTrace?: LoreTrace;
  // The house-rule sections the block shows, and the always-on ones it left
  // out for room; absent when the table has no house rules.
  rulesTrace?: { shown: string[]; omitted: string[] };
};

// The moment to retrieve against: the newest player messages this turn is
// answering, grounded by the current scene label. The players' words alone
// are the ask, which names the lore they are asking about (lore-selection.ts).
//
// A long move keeps both its ends: what it ends on (the question, the name
// it asks after) is what retrieval most needs, and a cut at the first 400
// characters lost it (the context audit's F12). The newest move gets the most
// room; the bound is kept by giving older moves less, never by cutting the
// newest one's end off.
const MOMENT_NEWEST_CHARS = 900;
const MOMENT_OLDER_CHARS = 300;
const MOMENT_SCENE_CHARS = 200;

export function buildMoment(campaign: Pick<Campaign, "scene">, history: Pick<CampaignMessage, "authorType" | "content" | "speech">[]): LoreMoment {
  const playerLines: string[] = [];
  for (let index = history.length - 1; index >= 0 && playerLines.length < 3; index -= 1) {
    const message = history[index];
    if (message.authorType === "player") {
      const room = playerLines.length ? MOMENT_OLDER_CHARS : MOMENT_NEWEST_CHARS;
      playerLines.unshift(clipKeepingEnds(message.content, room, Math.round(room * 0.4), () => " "));
    } else if (isNarration(message as CampaignMessage) && playerLines.length) {
      break;
    }
  }
  const scene = clipKeepingEnds(campaign.scene ?? "", MOMENT_SCENE_CHARS, MOMENT_SCENE_CHARS, () => "");
  return {
    scene: campaign.scene ?? "",
    ask: playerLines.join("\n"),
    query: [scene, ...playerLines].filter(Boolean).join("\n"),
  };
}

// IDF over a corpus, kept while the corpus is unchanged: the same lore and
// rules are ranked on every turn, and only an edit, a new entry or another
// language changes the weights. Keyed by the documents' own content.
const IDF_CACHE_MAX = 32;
declare global {
  var __odmIdfCache: Map<string, Map<string, number>> | undefined;
}
function cachedIdf(documents: string[], language: TableLanguage): Map<string, number> {
  const cache = (globalThis.__odmIdfCache ??= new Map());
  const hash = createHash("sha1");
  hash.update(language);
  for (const document of documents) {
    hash.update("\u0000");
    hash.update(document);
  }
  const key = hash.digest("hex");
  const known = cache.get(key);
  if (known) {
    return known;
  }
  const idf = computeIdf(documents, language);
  cache.set(key, idf);
  if (cache.size > IDF_CACHE_MAX) {
    cache.delete(cache.keys().next().value as string);
  }
  return idf;
}

// Fuses one corpus and returns the picked entries in fused order.
function pickFused<T>(
  entries: Array<{ id: string; text: string; embedding: Buffer | null; value: T }>,
  query: string,
  queryVector: Float32Array | null,
  limit: number,
  language: TableLanguage,
): T[] {
  if (!entries.length) {
    return [];
  }
  // IDF is computed over this corpus, so "dragon" is rare in a campaign that
  // never mentions dragons and unremarkable in one about nothing else.
  const idf = cachedIdf(entries.map((entry) => entry.text), language);
  const byId = new Map(entries.map((entry) => [entry.id, entry.value]));
  const picked = fuseRanked(
    entries.map((entry) => ({
      id: entry.id,
      lexical: lexicalScore(query, entry.text, idf, language),
      similarity: similarityOf(queryVector, entry.embedding),
    })),
    { limit },
  );
  return picked
    .map((id) => byId.get(id))
    .filter((value): value is T => value !== undefined);
}

// Ask the story endpoint what window it was launched with before anything is
// budgeted against it: the tool profile, the reply reserve and every block
// read it. llama.cpp and llama-swap report their -c on /props; anything else
// misses quietly and the configured or default value stands. Cached per base
// URL and model, so this costs one request per process.
export async function probeStoryWindow(settings: Campaign["settings"]): Promise<void> {
  if (settings.textProvider !== "local") {
    await probeCustomContextWindow(settings.customBaseUrl, settings.customApiKey, settings.customModel);
  }
}

export async function buildTurnRetrieval(
  campaign: Campaign,
  history: CampaignMessage[],
  // What the turn's tool definitions cost, so the rules budget is a share of
  // the same window the prompt is packed against (issue #120).
  toolTokens = 0,
): Promise<TurnRetrieval> {
  // Resolved from the campaign's own provider and model rather than assuming
  // a default window, so the rules budget matches what the backend will
  // actually accept (the turn has asked already; this is the cached answer).
  await probeStoryWindow(campaign.settings);
  const contextLimitTokens = promptWindowTokens(storyContextTokens(campaign.settings), toolTokens);
  const variantRulesBlock = renderVariantRules(campaign.gameSettings.variantRules);
  let houseRulesBlock = "";
  let loreBlock = "";
  let loreTrace: LoreTrace | undefined;
  let rulesTrace: TurnRetrieval["rulesTrace"];
  try {
    const rules = listRuleChunksWithEmbeddings(campaign.id).filter(
      (entry) => entry.chunk.enabled,
    );
    // A retired WorldForge entry is left out of the narrator's lore, by the
    // canon policy every model path shares (src/lib/worldforge/canon.ts).
    const lore = listLoreWithEmbeddings(campaign.id).filter(({ entry }) => !entry.canon || canonAdmits(entry.canon, "play"));
    if (rules.length || lore.length) {
      const moment = buildMoment(campaign, history);
      const { query } = moment;
      // Pinned chunks and any whose trigger keyword appears in the query are
      // admitted outright; only what is left competes for the retrieval
      // slots. A small enough rules document rides whole and skips retrieval
      // (src/lib/dm/rules-activation-logic.ts).
      const retrievalTokens = computeBudgets(contextLimitTokens).retrieval;
      const activation = selectRuleChunks(
        rules.map((entry) => entry.chunk),
        query,
        retrievalTokens,
      );
      const forcedIds = new Set(activation.forced.map((chunk) => chunk.id));
      const rankedRules = activation.verbatim ? [] : rules.filter((entry) => !forcedIds.has(entry.chunk.id));
      const unpinnedLore = lore.filter(({ entry }) => !entry.pinned);

      // The moment is embedded only when something is left to rank by
      // meaning: rules that compete for a slot, or lore that is not pinned.
      // A table whose whole rules document rides and whose lore is all
      // pinned waits on no embedder (the context audit's F12).
      let queryVector: Float32Array | null = null;
      // The players' words alone, for the lore's second meaning check
      // (lore-selection.ts); embedded in the same call.
      let askVector: Float32Array | null = null;
      const anyEmbedding =
        rankedRules.some((entry) => entry.embedding) || unpinnedLore.some((entry) => entry.embedding);
      if (query && anyEmbedding) {
        try {
          const askToo = moment.ask && unpinnedLore.some((entry) => entry.embedding);
          [queryVector, askVector = null] = await embed(askToo ? [query, moment.ask] : [query], { query: true });
        } catch (error) {
          // Embedder unavailable; keyword fallback carries the turn.
          console.error("[context-retrieval] embedding failed", error);
        }
      }

      const pinnedRules = activation.forced;
      const retrievedRules = activation.verbatim
        ? []
        : pickFused(
            rankedRules.map((entry) => ({
              id: entry.chunk.id,
              text: `${entry.chunk.heading} ${entry.chunk.text}`,
              embedding: entry.embedding,
              value: entry.chunk,
            })),
            query,
            queryVector,
            RULES_TOP,
            campaign.gameSettings.tableLanguage,
          );
      // Rendered against the same share the selector judged it by.
      const house = renderHouseRulesWithTrace(pinnedRules, retrievedRules, retrievalTokens * CHARS_PER_TOKEN);
      houseRulesBlock = house.text;
      rulesTrace = { shown: house.shown, omitted: house.omitted };

      if (lore.length) {
        const language = campaign.gameSettings.tableLanguage;
        const entries = lore.map(({ entry, embedding }) => ({ entry: entry as WorldLoreEntry, embedding }));
        const pinnedLore = entries.filter(({ entry }) => entry.pinned).map(({ entry }) => entry);
        const unpinned = entries.filter(({ entry }) => !entry.pinned);
        const byId = new Map(unpinned.map(({ entry }) => [entry.id, entry]));
        const selection = selectLore(
          unpinned.map(({ entry, embedding }) => ({
            id: entry.id,
            title: entry.title,
            tags: entry.tags,
            body: entry.body,
            similarity: similarityOf(queryVector, embedding),
            askSimilarity: similarityOf(askVector, embedding),
          })),
          moment,
          language,
        );
        // A long body shows the passage nearest the moment, scored against
        // the query's own terms the way search_lore's passages are.
        const passageIdf = computeIdf([query], language);
        const rendered = renderLoreBlock({
          pinned: pinnedLore,
          picked: selection.picked.map((pick) => ({ entry: byId.get(pick.id)!, reason: pick.reason })),
          held: selection.held.map((held) => ({ entry: byId.get(held.id)!, reason: held.reason, close: held.close })),
          budget: loreBudgetChars(retrievalTokens, houseRulesBlock.length),
          excerpt: (entry, max) =>
            loreExcerpt(entry, max, query ? (text) => lexicalScore(query, text, passageIdf, language) : undefined),
        });
        loreBlock = rendered.text;
        loreTrace = rendered.trace;
      }
    }
  } catch (error) {
    console.error("[context-retrieval] failed", error);
  }
  return { variantRulesBlock, houseRulesBlock, loreBlock, ...(loreTrace ? { loreTrace } : {}), ...(rulesTrace ? { rulesTrace } : {}) };
}
