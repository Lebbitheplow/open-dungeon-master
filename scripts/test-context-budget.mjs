// Context budget: token estimation, per-kind allocation with donation,
// greedy packing, drop reasons, and the never-evict guarantee on the engine
// boundary contract.
import assert from "node:assert/strict";
import {
  CHARS_PER_TOKEN,
  DEFAULT_CONTEXT_TOKENS,
  RESPONSE_RESERVE_TOKENS,
  NPC_FLOOR_SHARE_OF_REMAINDER,
  REMAINDER_SHARE,
  RETRIEVAL_SHARE_OF_LIMIT,
  computeBudgets,
  estimateTokens,
  npcFloorTokens,
  fitHistory,
  packBlocks,
  usableTokens,
} from "../src/lib/dm/context-budget.ts";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

const filler = (tokens) => "x".repeat(tokens * CHARS_PER_TOKEN);

check("token estimation is a chars/4 proxy and handles empty text", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2, "rounds up rather than truncating");
});

check("usable budget reserves room for the reply", () => {
  assert.equal(usableTokens(32_000), 32_000 - RESPONSE_RESERVE_TOKENS);
  assert.equal(usableTokens(null), DEFAULT_CONTEXT_TOKENS - RESPONSE_RESERVE_TOKENS);
  assert.equal(usableTokens(0), DEFAULT_CONTEXT_TOKENS - RESPONSE_RESERVE_TOKENS);
  assert.ok(usableTokens(100) >= 1_024, "never goes below a workable floor");
});

check("shares are floored and sum to less than the usable budget", () => {
  const budgets = computeBudgets(32_000);
  const usable = usableTokens(32_000);
  const total =
    budgets.rules + budgets.state + budgets.retrieval + budgets.chapters + budgets.history;
  assert.ok(total <= usable, "allocation never exceeds what is usable");
  assert.equal(budgets.contract, Number.POSITIVE_INFINITY, "the contract is unbudgeted");
  for (const kind of ["rules", "state", "retrieval", "chapters", "history"]) {
    assert.ok(Number.isInteger(budgets[kind]), `${kind} share is an integer`);
    assert.ok(budgets[kind] > 0, `${kind} gets a real share`);
  }
});

check("retrieval is taken off the top of the whole limit", () => {
  // NE-P's structure: the rules budget is a slice of the limit itself, not of
  // what is left after anything else.
  const usable = usableTokens(32_000);
  const budgets = computeBudgets(32_000);
  assert.equal(budgets.retrieval, Math.floor(usable * RETRIEVAL_SHARE_OF_LIMIT));
});

check("the other kinds split the remainder after retrieval", () => {
  const usable = usableTokens(32_000);
  const budgets = computeBudgets(32_000);
  const remainder = usable - budgets.retrieval;
  assert.equal(budgets.rules, Math.floor(remainder * REMAINDER_SHARE.rules));
  assert.equal(budgets.state, Math.floor(remainder * REMAINDER_SHARE.state));
  assert.equal(budgets.chapters, Math.floor(remainder * REMAINDER_SHARE.chapters));
});

check("history is the residual, not a fixed share", () => {
  const usable = usableTokens(32_000);
  const budgets = computeBudgets(32_000);
  const remainder = usable - budgets.retrieval;
  assert.equal(
    budgets.history,
    remainder - budgets.rules - budgets.state - budgets.chapters,
    "whatever the others did not claim",
  );
  assert.ok(budgets.history > 0, "the shares leave real room for transcript");
});

check("state is the largest single share of the remainder", () => {
  // It carries the sheets, the NPC roster and the facts, and the NPC floor is
  // carved out of it.
  const budgets = computeBudgets(32_000);
  assert.ok(budgets.state > budgets.rules);
  assert.ok(budgets.state > budgets.chapters);
});

check("the NPC floor is a real slice of the remainder", () => {
  const usable = usableTokens(32_000);
  const budgets = computeBudgets(32_000);
  const remainder = usable - budgets.retrieval;
  assert.equal(npcFloorTokens(32_000), Math.floor(remainder * NPC_FLOOR_SHARE_OF_REMAINDER));
  assert.ok(npcFloorTokens(32_000) < budgets.state, "the floor fits inside the state share");
});

check("a tiny context still leaves every kind something", () => {
  const budgets = computeBudgets(4_000);
  for (const kind of ["rules", "state", "retrieval", "chapters", "history"]) {
    assert.ok(budgets[kind] >= 0, `${kind} is never negative`);
  }
  assert.ok(budgets.history > 0, "even a small window keeps room for transcript");
});

check("everything that fits is kept, in pack order", () => {
  const { kept, trace } = packBlocks(
    [
      { id: "hist", kind: "history", text: filler(10) },
      { id: "contract", kind: "contract", text: filler(5) },
      { id: "state", kind: "state", text: filler(10) },
    ],
    32_000,
  );
  assert.deepEqual(
    kept.map((block) => block.id),
    ["contract", "state", "hist"],
    "contract first, history last",
  );
  assert.ok(trace.blocks.every((block) => block.included));
  assert.equal(trace.promptTokens, 25);
});

check("the engine boundary contract is never evicted, even at absurd size", () => {
  // A contract far larger than the entire window still rides: dropping it
  // would let the model start inventing dice results.
  const { kept, trace } = packBlocks(
    [
      { id: "contract", kind: "contract", text: filler(50_000) },
      { id: "state", kind: "state", text: filler(10) },
    ],
    8_000,
  );
  assert.ok(
    kept.some((block) => block.id === "contract"),
    "contract survived a budget it does not fit in",
  );
  const contractTrace = trace.blocks.find((block) => block.id === "contract");
  assert.equal(contractTrace.included, true);
  assert.match(contractTrace.reason, /always included/);
});

check("an oversized block is dropped with a reason naming its budget", () => {
  // Sized past the entire usable window, so no amount of donated budget from
  // the earlier kinds can rescue it.
  const { kept, trace } = packBlocks(
    [{ id: "huge-lore", kind: "retrieval", text: filler(usableTokens(32_000) + 500) }],
    32_000,
  );
  assert.equal(kept.length, 0);
  const dropped = trace.blocks[0];
  assert.equal(dropped.included, false);
  assert.match(dropped.reason, /over the retrieval budget/);
  assert.match(dropped.reason, /tokens left/);
});

check("blocks of one kind pack in order until that kind's share runs out", () => {
  const budgets = computeBudgets(32_000);
  // Three retrieval blocks at 60% of the retrieval share each: with no
  // donation from earlier kinds they would be 1 then stop, but rules, state
  // and the contract are empty here so their shares flow forward. Sizing
  // against the donated total keeps the assertion about ordering, not luck.
  const each = Math.floor(budgets.retrieval * 0.6);
  const { kept, trace } = packBlocks(
    [
      { id: "lore-a", kind: "retrieval", text: filler(each) },
      { id: "lore-b", kind: "retrieval", text: filler(each) },
      { id: "lore-c", kind: "retrieval", text: filler(each) },
    ],
    32_000,
  );
  assert.deepEqual(
    kept.map((block) => block.id),
    ["lore-a", "lore-b", "lore-c"],
    "admitted in the order given",
  );
  assert.equal(trace.blocks.length, 3);
});

check("later kinds inherit donated budget, earlier kinds do not", () => {
  const budgets = computeBudgets(32_000);
  // rules is packed second (right after the contract) so it has nothing
  // donated to it yet and is held to its own share.
  const overRulesShare = budgets.rules + 100;
  const rulesOnly = packBlocks(
    [{ id: "rules", kind: "rules", text: filler(overRulesShare) }],
    32_000,
  );
  assert.equal(rulesOnly.kept.length, 0, "no donation available this early");
  assert.match(rulesOnly.trace.blocks[0].reason, /over the rules budget/);

  // The same size in history, which is packed last, fits on donations alone.
  const historyOnly = packBlocks(
    [{ id: "hist", kind: "history", text: filler(overRulesShare) }],
    32_000,
  );
  assert.equal(historyOnly.kept.length, 1, "history inherited the unspent shares");
});

check("an under-spent kind donates its remainder to later kinds", () => {
  const budgets = computeBudgets(32_000);
  // History alone exceeds its own share, but rules/state/retrieval/chapters
  // are empty, so their shares flow forward and it fits.
  const oversizeForHistoryAlone = budgets.history + Math.floor(budgets.rules / 2);
  const { kept } = packBlocks(
    [{ id: "hist", kind: "history", text: filler(oversizeForHistoryAlone) }],
    32_000,
  );
  assert.equal(kept.length, 1, "donated budget let history through");
});

check("donation never lets the total overrun the window", () => {
  const usable = usableTokens(32_000);
  const { kept, trace } = packBlocks(
    [
      { id: "a", kind: "rules", text: filler(Math.floor(usable * 0.5)) },
      { id: "b", kind: "state", text: filler(Math.floor(usable * 0.5)) },
      { id: "c", kind: "history", text: filler(Math.floor(usable * 0.5)) },
    ],
    32_000,
  );
  assert.ok(trace.promptTokens <= usable, "packed total respects the window");
  assert.ok(kept.length < 3, "something had to give");
});

check("the trace records position, tokens, and inclusion for every block", () => {
  const { trace } = packBlocks(
    [
      { id: "one", kind: "rules", text: filler(3) },
      { id: "two", kind: "history", text: filler(4) },
    ],
    32_000,
  );
  assert.equal(trace.blocks.length, 2);
  assert.deepEqual(
    trace.blocks.map((block) => block.position),
    [1, 2],
    "positions are sequential in pack order",
  );
  assert.equal(trace.blocks.find((block) => block.id === "two").tokens, 4);
  assert.equal(trace.limitTokens, usableTokens(32_000));
});

check("history is trimmed oldest-first and reports what it cut", () => {
  const entries = [
    { id: "a", text: filler(10) },
    { id: "b", text: filler(10) },
    { id: "c", text: filler(10) },
  ];
  const fit = fitHistory(entries, 25);
  assert.deepEqual(
    fit.kept.map((entry) => entry.id),
    ["b", "c"],
    "the newest survive",
  );
  assert.equal(fit.dropped, 1);
  assert.equal(fit.tokens, 20);
});

check("history keeps the newest message even when it alone busts the budget", () => {
  // A prompt with no transcript is useless; better to hand the model one
  // over-long message than nothing at all.
  const fit = fitHistory([{ id: "only", text: filler(9_999) }], 10);
  assert.equal(fit.kept.length, 1);
  assert.equal(fit.dropped, 0);
});

check("empty inputs are handled without special-casing at the call site", () => {
  const fit = fitHistory([], 100);
  assert.deepEqual(fit.kept, []);
  assert.equal(fit.dropped, 0);
  const { kept, trace } = packBlocks([], 32_000);
  assert.deepEqual(kept, []);
  assert.equal(trace.promptTokens, 0);
  assert.deepEqual(trace.blocks, []);
});

check("empty blocks cost nothing and still ride", () => {
  const { kept } = packBlocks([{ id: "blank", kind: "rules", text: "" }], 32_000);
  assert.equal(kept.length, 1, "a zero-token block always fits");
});

console.log(`context-budget: ${passed} tests passed`);
