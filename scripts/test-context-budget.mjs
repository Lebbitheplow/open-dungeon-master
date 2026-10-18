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
  PACK_ORDER,
  SECTION_SHARES,
  npcFloorTokens,
  cutCoveredHistory,
  fitHistory,
  SUMMARY_SEAM_FLOOR,
  packBlocks,
  usableTokens,
  MAX_RESPONSE_RESERVE_TOKENS,
  promptWindowTokens,
  responseReserveTokens,
  historyAllowanceTokens,
  HISTORY_MAX_TOKENS,
  NEWEST_LINE_FLOOR_CHARS,
  clipLine,
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
  // A limit of 0 is a window with no room left (the tools took it all), not
  // a missing one: no floor pretends otherwise (the context audit's F01).
  assert.equal(usableTokens(0), 0);
  assert.equal(usableTokens(100), 0, "never negative, and no nominal floor");
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
    remainder - budgets.rules - budgets.state - budgets.chapters - budgets.sky - budgets.factions - budgets.quests - budgets.shop,
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

check("history keeps the newest message, cut to fit with both ends, when it alone busts the budget", () => {
  // A prompt with no transcript is useless, and one over-long move sent whole
  // overflows the window: it is kept, clipped at its middle, and says so.
  const long = `START ${filler(9_999)} the question is: who holds the key?`;
  const fit = fitHistory([{ id: "older", text: filler(5) }, { id: "only", text: long }], 10);
  assert.equal(fit.kept.length, 1);
  assert.equal(fit.dropped, 1);
  assert.equal(fit.clipped, true);
  assert.ok(fit.kept[0].text.length <= NEWEST_LINE_FLOOR_CHARS, `clipped to the floor (${fit.kept[0].text.length})`);
  assert.match(fit.kept[0].text, /^START /, "the head is kept");
  assert.match(fit.kept[0].text, /who holds the key\?$/, "the end it asks is kept");
  assert.match(fit.kept[0].text, /characters left out to fit the model's window/, "the cut is marked");
  // Room for it whole: untouched.
  const whole = fitHistory([{ id: "only", text: "short line" }], 10);
  assert.equal(whole.clipped, false);
  assert.equal(whole.kept[0].text, "short line");
});

check("history takes the shares the fixed blocks left, up to the ceiling, never past the window", () => {
  const limit = usableTokens(40_000) + RESPONSE_RESERVE_TOKENS;
  const budgets = computeBudgets(limit);
  // Fixed blocks that used little of their shares donate the rest.
  const light = historyAllowanceTokens(limit, 1_000);
  assert.ok(light > budgets.history, `a quiet table's transcript gets more than its share (${light} > ${budgets.history})`);
  assert.ok(light <= Math.max(budgets.history, HISTORY_MAX_TOKENS), "never past the ceiling");
  // Fixed blocks past their shares: the transcript keeps no more than its share.
  assert.equal(historyAllowanceTokens(limit, budgets.rules + budgets.state + budgets.chapters + 5_000), budgets.history);
  // Fixed blocks that fill the window: nothing is left.
  assert.equal(historyAllowanceTokens(limit, usableTokens(limit)), 0);
  // A huge window keeps its whole share: the ceiling never takes away.
  const huge = computeBudgets(400_000);
  assert.equal(historyAllowanceTokens(400_000, 1_000), huge.history);
});

check("a clipped line keeps both ends and states the gap", () => {
  const text = `${"a".repeat(3_000)}MIDDLE${"b".repeat(3_000)}`;
  const clipped = clipLine(text, 1_000);
  assert.ok(clipped.length <= 1_000, `within the bound (${clipped.length})`);
  assert.ok(clipped.startsWith("aaa") && clipped.endsWith("bbb"));
  assert.ok(!clipped.includes("MIDDLE"));
  assert.equal(clipLine("short", 1_000), "short");
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


// The budget scales with the model's real window, not a fixed default. This
// is the whole reason storyContextTokens exists: a 128K local model and a
// 16K custom endpoint should not get the same history allowance.
{
  const small = computeBudgets(8_192);
  const large = computeBudgets(131_072);
  assert.ok(large.history > small.history * 5, "a bigger window buys much more transcript");
  assert.ok(large.retrieval > small.retrieval, "and more room for lore");
  // Shares stay proportional; only the totals move.
  const smallRatio = small.history / usableTokens(8_192);
  const largeRatio = large.history / usableTokens(131_072);
  assert.ok(Math.abs(smallRatio - largeRatio) < 0.01, "same proportions at any size");
  console.log("context-budget: allocation scales with the configured window");
}

check("the small sections have floors, sit in order, and the lines never drop", () => {
  // docs/vtt-parity-implementation-plan.md section 15.
  const budgets = computeBudgets(16_384);
  const remainder = usableTokens(16_384) - budgets.retrieval;
  assert.equal(budgets.safety, Number.POSITIVE_INFINITY);
  assert.equal(budgets.sky, Math.floor(remainder * SECTION_SHARES.sky));
  assert.equal(budgets.factions, Math.floor(remainder * SECTION_SHARES.factions));
  assert.equal(budgets.quests, Math.floor(remainder * SECTION_SHARES.quests));
  assert.equal(budgets.shop, Math.floor(remainder * SECTION_SHARES.shop));
  assert.ok(budgets.sky > 0 && budgets.shop > budgets.sky);
  assert.ok(PACK_ORDER.indexOf("safety") < PACK_ORDER.indexOf("contract"));
  assert.ok(PACK_ORDER.indexOf("sky") < PACK_ORDER.indexOf("state"));
  assert.ok(PACK_ORDER.indexOf("shop") < PACK_ORDER.indexOf("retrieval"));
  const packed = packBlocks(
    [
      { id: "lines", kind: "safety", text: "x".repeat(2_000) },
      { id: "sky", kind: "sky", text: "Date and time: dusk." },
      // Bigger than the whole window: no donation from the kinds before it
      // can make room, so it is the block that drops.
      { id: "shop", kind: "shop", text: "y".repeat(12_000) },
    ],
    4_000,
  );
  assert.ok(packed.kept.some((block) => block.id === "lines"), "the lines were dropped");
  assert.ok(packed.kept.some((block) => block.id === "sky"));
  assert.ok(!packed.kept.some((block) => block.id === "shop"), "a shop over the window stayed");
});

check("the reply reserve grows with the window, between the base and the cap (issue #120)", () => {
  assert.equal(responseReserveTokens(16_384), RESPONSE_RESERVE_TOKENS, "a 16K window keeps the base reserve");
  assert.equal(responseReserveTokens(32_768), 4_096, "one eighth of a 32K window");
  assert.equal(responseReserveTokens(65_536), MAX_RESPONSE_RESERVE_TOKENS, "64K hits the cap");
  assert.equal(responseReserveTokens(131_072), MAX_RESPONSE_RESERVE_TOKENS, "the cap holds at 128K");
  assert.equal(responseReserveTokens(0), responseReserveTokens(DEFAULT_CONTEXT_TOKENS), "no window means the default");
});

check("the packing window takes the tool definitions and the grown reserve off the model's window", () => {
  // Issue #120's shape: a 64K window and ~27K of tool definitions. Packing
  // against the full window left ~1K for the reply; this leaves the reserve.
  const window = 65_536;
  const tools = 27_246;
  const packed = promptWindowTokens(window, tools);
  assert.equal(
    usableTokens(packed),
    window - tools - responseReserveTokens(window),
    "messages may fill the window less the tools and less the whole reserve",
  );
  assert.ok(computeBudgets(packed).history < computeBudgets(window).history, "the transcript share shrank to make room");
  // No tools: only the reserve above the base comes off.
  assert.equal(usableTokens(promptWindowTokens(window, 0)), window - responseReserveTokens(window));
  // A 16K window keeps the base reserve, so with no tools it packs exactly as before.
  assert.equal(promptWindowTokens(16_384, 0), 16_384);
  assert.equal(usableTokens(promptWindowTokens(16_384, 0)), usableTokens(16_384));
  // Tools larger than the window: no room at all, said plainly, so the
  // whole-request fit refuses the call with the real numbers.
  assert.equal(promptWindowTokens(16_384, 27_246), 0);
  assert.equal(usableTokens(promptWindowTokens(16_384, 27_246)), 0);
  assert.equal(promptWindowTokens(Number.NaN, Number.NaN), promptWindowTokens(DEFAULT_CONTEXT_TOKENS, 0), "bad inputs fall back");
});

check("the transcript a summary covers is left out, but the newest few at the seam", () => {
  const entries = Array.from({ length: 20 }, (_, at) => ({ seq: at * 2 + 1 }));
  assert.equal(SUMMARY_SEAM_FLOOR, 6);
  assert.deepEqual(cutCoveredHistory(entries, null), { kept: entries, cut: 0 }, "no summary, nothing cut");
  assert.deepEqual(cutCoveredHistory(entries, 9), { kept: entries, cut: 0 }, "five covered stay under the floor");
  const cut = cutCoveredHistory(entries, 29);
  assert.equal(cut.cut, 9, "fifteen covered, six kept at the seam");
  assert.deepEqual(cut.kept, entries.slice(9));
  assert.deepEqual(cutCoveredHistory(entries, 39).kept, entries.slice(14), "all covered: only the floor is left");
  assert.equal(cutCoveredHistory([], 39).cut, 0);
});

console.log(`context-budget: ${passed} tests passed`);
