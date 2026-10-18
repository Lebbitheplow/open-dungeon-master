import type { ArcTrace } from "./arc-relevance.ts";
import type { LoreTrace } from "./world-lore-logic.ts";
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

// The reply reserve grows with the window (issue #120). A fixed 2,048 was
// sized for a short narration; a thinking model (Qwen3.6 on llama-server)
// spends several thousand tokens reasoning before its first tool call, and
// the turn loop adds tool results and state updates to the same window for
// up to MAX_MODEL_CALLS calls. One eighth of the window, never under the
// base reserve and never over this cap: 8K on a 64K window, the base on
// 16K.
export const MAX_RESPONSE_RESERVE_TOKENS = 8_192;
export const RESPONSE_RESERVE_SHARE = 1 / 8;

export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / CHARS_PER_TOKEN);
}

export function responseReserveTokens(contextWindowTokens: number): number {
  const window = Number.isFinite(contextWindowTokens) && contextWindowTokens > 0 ? contextWindowTokens : DEFAULT_CONTEXT_TOKENS;
  return Math.min(
    MAX_RESPONSE_RESERVE_TOKENS,
    Math.max(RESPONSE_RESERVE_TOKENS, Math.floor(window * RESPONSE_RESERVE_SHARE)),
  );
}

// The limit the message blocks are packed against: the model's window less
// the tool definitions, which ride on every call and were never budgeted
// (issue #120: 70 tools came to ~27K tokens of a 64K window, so the packed
// prompt left a local model ~1K to answer in and it stopped mid-thought),
// less the part of the reply reserve above the base that usableTokens
// already takes off. Pass the result wherever contextLimitTokens is taken.
export function promptWindowTokens(contextWindowTokens: number, toolTokens: number): number {
  const window = Number.isFinite(contextWindowTokens) && contextWindowTokens > 0 ? contextWindowTokens : DEFAULT_CONTEXT_TOKENS;
  const tools = Number.isFinite(toolTokens) && toolTokens > 0 ? toolTokens : 0;
  const reserveAboveBase = responseReserveTokens(window) - RESPONSE_RESERVE_TOKENS;
  // No floor: a window smaller than its tool set has no room for the
  // blocks, and saying so here is what lets the whole-request fit
  // (src/lib/dm/request-fit.ts) refuse it with the real numbers. A floor
  // used to grant a nominal allowance the window did not have, so the trace
  // showed a limit larger than the window itself (the context audit's F01).
  return Math.max(0, window - tools - reserveAboveBase);
}

// What a block is for. Drives both the packing order and how the inspector
// groups rows, and keeps the "which of these may be dropped" decision in one
// place rather than scattered through the prompt builder.
export type BlockKind =
  | "safety" // lines and veils: a hard block, ordered first so it is cached
  | "contract" // the engine boundary: never dropped, at any budget
  | "rules" // system rules, genre, encounter and companion rules
  | "sky" // the date, the hour and the weather: one line
  | "state" // the live game-state block (sheets, encounter, location)
  | "factions" // standing per faction, DM-only power and goals
  | "quests" // the written quest log with its ticks
  | "shop" // the shelves at the party's place, while a shop is open
  | "retrieval" // house rules and world lore pulled for this moment
  | "chapters" // sealed chapter summaries
  | "history" // the transcript
  | "tools"; // the tool definitions: not packed, taken off the window first

// Floors for the small blocks docs/vtt-parity-implementation-plan.md
// section 15 adds, as shares of the remainder so the allocation keeps its
// proportions at any window: each is guaranteed its slice before the
// transcript takes the rest, and donates what it does not use like every
// other kind. On a 16K window these come to about 60, 180, 180 and 240
// tokens.
export const SECTION_SHARES = { sky: 0.004, factions: 0.012, quests: 0.012, shop: 0.016 } as const;

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
  // What the story arc render chose this turn (issue #301): the planned
  // events shown or held back, with reasons, and the beat window. Absent on
  // turns taken before it was recorded and on campaigns without an arc.
  arc?: ArcTrace;
  // The world lore entries this turn kept and held back, with the reason
  // for each and the block's measured budget (issue #305). Absent on turns
  // taken before it was recorded and on campaigns without lore.
  lore?: LoreTrace;
  // The house-rule sections the prompt showed, and the always-on ones it
  // left out for room (src/lib/dm/rules-logic.ts renderHouseRulesWithTrace).
  houseRules?: { shown: string[]; omitted: string[] };
  // What the turn changed for the table's model, one line each (issue #383,
  // src/lib/dm/model-tuning-logic.ts). Absent when nothing was changed.
  tuning?: string[];
  // Where the transcript sits in the turn's messages: lines [historyStart,
  // historyEnd) may be dropped oldest first when a later call must be fitted
  // again, and the turn's own calls and results start at promptMessages
  // (src/lib/dm/request-fit.ts). Absent on turns taken before it was kept.
  shape?: { historyStart: number; historyEnd: number; promptMessages: number };
  // Which tools the turn's calls were offered (src/lib/dm/tool-profiles.ts):
  // for the compact profile, the groups the players' words opened when the
  // turn began, all the groups offered then, and those more_tools opened.
  profile?: { name: "full" | "lean" | "compact"; intent?: string[]; groups?: string[]; opened?: string[] };
  // How much of this turn's opening prompt matches the previous turn's from
  // the first token on (src/lib/dm/request-fit.ts sharedPrefixTokens): the
  // most a server's prompt cache could reuse. Compare with the cached input
  // the backend reports on the calls.
  prefix?: { sharedTokens: number; promptTokens: number };
  // Lines no summary covers that the prompt left out for want of room: the
  // rolling compaction folds them next (src/lib/dm/compaction.ts), so play
  // that fell out of the window is in a summary rather than in nothing.
  historyEvicted?: number;
  // Every model call the turn made, as it was sized and as the backend
  // reported it (the context audit's F09): the prompt grows call by call as
  // tool results come back, and this is where that shows.
  calls?: CallTrace[];
};

export type CallTrace = {
  index: number;
  // What the call was for: the turn's own calls, or the guard's rewrite, the
  // whisper backstop, the tools-closed rescue...
  task: string;
  windowTokens: number;
  // The fitted request by the estimate, tools included, and the tools alone.
  promptTokens: number;
  toolTokens: number;
  toolCount: number;
  // The reply cap it went out with.
  outputTokens: number;
  // Lines left out and messages cut short to fit, when any were.
  dropped: number;
  clipped: number;
  // What the backend reported; absent when it said nothing.
  reportedInputTokens?: number;
  cachedInputTokens?: number;
  outputTokensUsed?: number;
  // Sent past a window the endpoint never reported, uncapped (model.ts).
  windowAssumed?: true;
  reasoningTokens?: number;
  durationMs?: number;
  firstTokenMs?: number;
  finishReason?: string;
  error?: string;
};

// Allocation ported from NarrativeEngine-P's computeBudgets
// (src/services/payload/budgets.ts, MIT). Two structural choices there are
// worth keeping rather than approximating:
//
// 1. Retrieved rules come OFF THE TOP of the whole limit, and everything else
//    splits what remains. Retrieval is the one block whose size is driven by
//    how much the operator wrote rather than by how the campaign is going, so
//    capping it first stops a long rules document from distorting every other
//    share.
// 2. History is the RESIDUAL, not a fixed share. NE-P's percentages
//    deliberately sum to less than the remainder (25 + 40 + 10 = 75%) and it
//    fits history into whatever is left. That degrades in the right
//    direction: a quiet scene with little state spends the slack on
//    transcript automatically.
//
// ODM's block kinds map onto NE-P's like this:
//   retrieval <- rulesBudget   (house rules and world lore, off the top)
//   rules     <- stable        (system prompt, genre, encounter/companion rules)
//   state     <- world         (the game-state block: sheets, NPCs, facts, arc)
//   chapters  <- volatile      (approximate: NE-P folds sealed chapters into
//                               its history LOD renderer, which ODM does not
//                               have yet, so they take the volatile slot)
//   history   <- residual
export const RETRIEVAL_SHARE_OF_LIMIT = 0.1;

// Shares of what is left after retrieval is taken off the top. NE-P's
// shallow-context numbers; it also has a deep-context variant (15/60/10) for
// when an archive search ran, which ODM has no equivalent of yet.
export const REMAINDER_SHARE = {
  rules: 0.25,
  state: 0.4,
  chapters: 0.1,
} as const;

// A guaranteed slice of the state budget for the NPC roster, carved out of
// the state share the way NE-P carves its NPC floor out of `world`, so lore
// and fact pressure can never starve the actors actually in the scene. NE-P
// notes that on an 8K context this is roughly 400 tokens, which is the right
// order for one or two NPCs in a single scene.
//
// ODM assembles the whole game-state block as one string today, so this is
// not yet enforced as a separate sub-budget; it is recorded here because it
// is the reason `state` gets the largest single share.
export const NPC_FLOOR_SHARE_OF_REMAINDER = 0.05;

// Order blocks are admitted in. The contract is first and unconditional; the
// rest descend by how badly the turn breaks without them. History is packed
// last precisely because it is the one kind that degrades gracefully: losing
// the oldest lines costs less than losing the character sheets.
export const PACK_ORDER: BlockKind[] = [
  "safety",
  "contract",
  "rules",
  "sky",
  "state",
  "factions",
  "quests",
  "shop",
  "retrieval",
  "chapters",
  "history",
];

// A limit of 0 is a window with no room left (promptWindowTokens); only an
// absent one falls back to the default.
export function usableTokens(contextLimitTokens?: number | null): number {
  const limit =
    typeof contextLimitTokens === "number" && Number.isFinite(contextLimitTokens) && contextLimitTokens >= 0
      ? contextLimitTokens
      : DEFAULT_CONTEXT_TOKENS;
  return Math.max(0, limit - RESPONSE_RESERVE_TOKENS);
}

// The most transcript a turn's prompt carries, however large the window.
// History is the residual (the shares the rules and the state did not use
// pass to it, as packBlocks donates), but a 128K window is not filled with
// transcript just because it could be: every token is prefilled again on
// every turn, and a smaller deliberate prompt answers sooner. Older play is
// what the summaries and recall_story are for. DM_HISTORY_MAX_TOKENS sets it.
export const HISTORY_MAX_TOKENS = 8_192;

export function historyCeilingTokens(): number {
  const raw = Number.parseInt(process.env.DM_HISTORY_MAX_TOKENS ?? "", 10);
  return Number.isFinite(raw) && raw >= 512 ? raw : HISTORY_MAX_TOKENS;
}

// What the transcript may take: its own share, plus what the always-included
// rules, state and chapter shares left unused, never past what the window
// leaves after those blocks, and never past the ceiling above.
export function historyAllowanceTokens(contextLimitTokens: number | null | undefined, fixedTokens: number): number {
  const budgets = computeBudgets(contextLimitTokens);
  const unclaimed = Math.max(0, budgets.rules + budgets.state + budgets.chapters - fixedTokens);
  const room = usableTokens(contextLimitTokens) - fixedTokens;
  return Math.max(0, Math.min(room, Math.max(budgets.history, Math.min(budgets.history + unclaimed, historyCeilingTokens()))));
}

export function computeBudgets(contextLimitTokens?: number | null): Record<BlockKind, number> {
  const usable = usableTokens(contextLimitTokens);
  const retrieval = Math.floor(usable * RETRIEVAL_SHARE_OF_LIMIT);
  const remainder = usable - retrieval;

  const rules = Math.floor(remainder * REMAINDER_SHARE.rules);
  const state = Math.floor(remainder * REMAINDER_SHARE.state);
  const chapters = Math.floor(remainder * REMAINDER_SHARE.chapters);

  const floor = (kind: keyof typeof SECTION_SHARES) => Math.floor(remainder * SECTION_SHARES[kind]);
  const sky = floor("sky");
  const factions = floor("factions");
  const quests = floor("quests");
  const shop = floor("shop");
  const floors = sky + factions + quests + shop;
  return {
    // The table's lines are a hard block like the contract: a limit the
    // table set is never the thing that falls out of the window.
    safety: Number.POSITIVE_INFINITY,
    // The contract is never budgeted against: it is a few hundred tokens and
    // dropping it would let the model start inventing dice results, which is
    // the single failure this whole system exists to prevent.
    contract: Number.POSITIVE_INFINITY,
    retrieval,
    rules,
    sky,
    state,
    factions,
    quests,
    shop,
    chapters,
    // The residual, following NE-P: whatever the other kinds did not claim
    // goes to the transcript. Never negative, however the shares are tuned.
    history: Math.max(0, remainder - rules - state - chapters - floors),
    // Never packed: the tool definitions come off the window before any
    // share is computed (promptWindowTokens), so they hold no share here.
    tools: 0,
  };
}

// The NPC roster's guaranteed slice of the state budget. Exposed so the NPC
// roster builder can honor it once ODM budgets the game-state block's parts
// separately rather than assembling it as one string.
export function npcFloorTokens(contextLimitTokens?: number | null): number {
  const usable = usableTokens(contextLimitTokens);
  const remainder = usable - Math.floor(usable * RETRIEVAL_SHARE_OF_LIMIT);
  return Math.floor(remainder * NPC_FLOOR_SHARE_OF_REMAINDER);
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
      const isContract = kind === "contract" || kind === "safety";
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

// The transcript a summary already covers is left out before the budget
// applies: a closed chapter is owned by its summary in GAME STATE
// (src/lib/dm/chapter-close.ts), and the open chapter's compacted start by
// the rolling summary (src/lib/dm/compaction.ts), so sending those messages
// too only says the same thing twice. recall_story still finds their scenes.
// The newest covered messages stay: three exchanges carry the scene across
// the seam, so the turn after a chapter closes still reads what it answers.
export const SUMMARY_SEAM_FLOOR = 6;

// Entries in ascending seq order; coveredSeq is the newest message a summary
// covers, or null when none does.
export function cutCoveredHistory<T extends { seq: number }>(
  entries: readonly T[],
  coveredSeq: number | null,
): { kept: T[]; cut: number } {
  const covered = coveredSeq === null ? 0 : entries.filter((entry) => entry.seq <= coveredSeq).length;
  const cut = Math.max(0, covered - SUMMARY_SEAM_FLOOR);
  return { kept: entries.slice(cut), cut };
}

// The least of the newest line a prompt keeps, in characters, however
// little room is left: under this a move says nothing usable.
export const NEWEST_LINE_FLOOR_CHARS = 1_200;

// Cuts a line to `maxChars`, keeping both ends with a marked gap: what a long
// move ends on (the question, the name) is what the turn answers.
export function clipLine(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) {
    return clean;
  }
  const marker = (skipped: number) => ` [... ${skipped.toLocaleString("en-US")} characters left out to fit the model's window ...] `;
  const room = Math.max(0, maxChars - marker(clean.length).length);
  const head = Math.round(room * 0.3);
  const tail = room - head;
  const skipped = clean.length - head - tail;
  return `${clean.slice(0, head).trimEnd()}${marker(skipped)}${clean.slice(clean.length - tail).trimStart()}`;
}

export function fitHistory(entries: HistoryEntry[], allowanceTokens: number): HistoryFit & { clipped: boolean } {
  const kept: HistoryEntry[] = [];
  let tokens = 0;
  let clipped = false;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const cost = estimateTokens(entry.text);
    if (tokens + cost > allowanceTokens) {
      // The newest line is always kept: a prompt with no transcript answers
      // nothing. When it alone is over the allowance it is cut to fit,
      // keeping its ends and saying so, rather than sent whole past the
      // window (the context audit's F01).
      if (!kept.length) {
        const text = clipLine(entry.text, Math.max(NEWEST_LINE_FLOOR_CHARS, allowanceTokens * CHARS_PER_TOKEN));
        clipped = text !== entry.text.trim();
        kept.unshift({ ...entry, text });
        tokens += estimateTokens(text);
      }
      break;
    }
    kept.unshift(entry);
    tokens += cost;
  }
  return { kept, dropped: entries.length - kept.length, tokens, clipped };
}
