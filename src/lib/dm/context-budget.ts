// Pure logic for the DM prompt's context budget.
//
// What this replaces: a single HISTORY_CHAR_BUDGET that trimmed history by
// raw character count and left every other block unbounded. That has two
// problems. Characters are a poor stand-in for tokens, and an unbounded
// block (a long house-rules chunk, a big NPC roster) could crowd out the
// history without anything noticing or reporting it.
//
// Dependency-free so scripts/test-context-budget.mjs can import it directly.

// Characters per token. A rough proxy, not a tokenizer: ODM deliberately
// carries no tokenizer dependency, and the DM runs against whatever local
// model the operator configured, each with its own vocabulary. Four is the
// usual English approximation and errs slightly conservative for prose.
export const CHARS_PER_TOKEN = 4;

// Used when a campaign has no configured context limit. Deliberately modest:
// overshooting a small local model's window truncates the prompt silently at
// the server, which is far worse than packing less.
export const DEFAULT_CONTEXT_TOKENS = 16_384;

// Reserved for the model's own reply plus per-message framing overhead the
// estimate cannot see. Without this the prompt would be allowed to fill the
// entire window and leave no room to answer.
export const RESPONSE_RESERVE_TOKENS = 2_048;

export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / CHARS_PER_TOKEN);
}

// What a block is for. Drives both the packing order and how the inspector
// groups rows, and keeps the "which of these may be dropped" decision in one
// place rather than scattered through the prompt builder.
export type BlockKind =
  | "contract" // the engine boundary: never dropped, at any budget
  | "rules" // system rules, genre, encounter and companion rules
  | "state" // the live game-state block (sheets, encounter, location)
  | "retrieval" // house rules and world lore pulled for this moment
  | "chapters" // sealed chapter summaries
  | "history"; // the transcript

export type BudgetBlock = {
  id: string;
  kind: BlockKind;
  text: string;
};

export type BlockTrace = {
  id: string;
  kind: BlockKind;
  tokens: number;
  included: boolean;
  // Why it was dropped, or why it was always going to be kept.
  reason: string;
  position: number;
};

export type ContextTrace = {
  limitTokens: number;
  promptTokens: number;
  blocks: BlockTrace[];
};

// Share of the usable budget each kind may claim. These are floors, not caps:
// leftover from an under-spent kind flows to whatever is packed after it, so
// a campaign with no lore does not simply waste lore's share.
//
// history gets the largest share because the transcript is what the model is
// actually continuing; starving it produces a DM that has forgotten the last
// five minutes, which reads far worse than one missing a lore entry.
export const KIND_SHARE: Record<Exclude<BlockKind, "contract">, number> = {
  rules: 0.2,
  state: 0.25,
  retrieval: 0.12,
  chapters: 0.08,
  history: 0.35,
};

// Order blocks are admitted in. The contract is first and unconditional; the
// rest descend by how badly the turn breaks without them. History is packed
// last precisely because it is the one kind that degrades gracefully: losing
// the oldest lines costs less than losing the character sheets.
export const PACK_ORDER: BlockKind[] = [
  "contract",
  "rules",
  "state",
  "retrieval",
  "chapters",
  "history",
];

export function usableTokens(contextLimitTokens?: number | null): number {
  const limit =
    typeof contextLimitTokens === "number" && contextLimitTokens > 0
      ? contextLimitTokens
      : DEFAULT_CONTEXT_TOKENS;
  return Math.max(1_024, limit - RESPONSE_RESERVE_TOKENS);
}

export function computeBudgets(contextLimitTokens?: number | null): Record<BlockKind, number> {
  const usable = usableTokens(contextLimitTokens);
  return {
    // The contract is never budgeted against: it is a few hundred tokens and
    // dropping it would let the model start inventing dice results, which is
    // the single failure this whole system exists to prevent.
    contract: Number.POSITIVE_INFINITY,
    rules: Math.floor(usable * KIND_SHARE.rules),
    state: Math.floor(usable * KIND_SHARE.state),
    retrieval: Math.floor(usable * KIND_SHARE.retrieval),
    chapters: Math.floor(usable * KIND_SHARE.chapters),
    history: Math.floor(usable * KIND_SHARE.history),
  };
}

export type PackResult = {
  kept: BudgetBlock[];
  trace: ContextTrace;
};

// Greedy packing in PACK_ORDER. Each kind spends its own share first; a kind
// that comes in under budget donates the remainder to everything after it, so
// the total is respected without any kind being starved by an earlier one.
export function packBlocks(
  blocks: BudgetBlock[],
  contextLimitTokens?: number | null,
): PackResult {
  const budgets = computeBudgets(contextLimitTokens);
  const usable = usableTokens(contextLimitTokens);
  const kept: BudgetBlock[] = [];
  const trace: BlockTrace[] = [];
  let spent = 0;
  let carry = 0;
  let position = 0;

  for (const kind of PACK_ORDER) {
    const ofKind = blocks.filter((block) => block.kind === kind);
    let allowance = budgets[kind] + carry;

    for (const block of ofKind) {
      const tokens = estimateTokens(block.text);
      const isContract = kind === "contract";
      // Two gates: the kind's own allowance and the overall usable window.
      // The second matters when carry has accumulated: without it a late
      // kind could inherit enough donated budget to overrun the model.
      const fitsKind = isContract || tokens <= allowance;
      const fitsTotal = isContract || spent + tokens <= usable;

      if (fitsKind && fitsTotal) {
        kept.push(block);
        spent += tokens;
        allowance -= tokens;
        trace.push({
          id: block.id,
          kind,
          tokens,
          included: true,
          reason: isContract ? "always included" : "fits",
          position: position += 1,
        });
      } else {
        trace.push({
          id: block.id,
          kind,
          tokens,
          included: false,
          reason: !fitsKind
            ? `over the ${kind} budget (${tokens} > ${Math.max(0, allowance)} tokens left)`
            : `over the total context budget (${spent + tokens} > ${usable} tokens)`,
          position: position += 1,
        });
      }
    }

    // Whatever this kind did not spend is donated onward. A kind with nothing
    // to say donates its whole share, which is what lets a lore-free campaign
    // spend more on history rather than wasting the allocation. The contract
    // has an infinite allowance, so it donates nothing rather than infinity.
    carry = Number.isFinite(allowance) ? Math.max(0, allowance) : 0;
  }

  return {
    kept,
    trace: { limitTokens: usable, promptTokens: spent, blocks: trace },
  };
}

// History is the one kind that degrades well, so instead of dropping whole
// blocks it is trimmed newest-first: keep taking messages backward until the
// allowance runs out. Mirrors what the old character-budget walk did, with
// tokens instead of characters and a reported cut point.
export type HistoryEntry = { id: string; text: string };

export type HistoryFit = {
  kept: HistoryEntry[];
  dropped: number;
  tokens: number;
};

export function fitHistory(entries: HistoryEntry[], allowanceTokens: number): HistoryFit {
  const kept: HistoryEntry[] = [];
  let tokens = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const cost = estimateTokens(entry.text);
    // Always keep at least the newest entry: a prompt with no transcript at
    // all is useless, and a single over-long message should be truncated by
    // the model rather than silently vanish.
    if (tokens + cost > allowanceTokens && kept.length > 0) {
      break;
    }
    kept.unshift(entry);
    tokens += cost;
  }
  return { kept, dropped: entries.length - kept.length, tokens };
}
