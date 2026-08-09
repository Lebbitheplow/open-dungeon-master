// Chapter level-of-detail: tier assignment, importance promotion, the
// two-stage budget cascade, and byte-determinism.
import assert from "node:assert/strict";
import {
  DEFAULT_LOD_CONFIG,
  IMPORTANCE_THRESHOLD,
  effectiveAge,
  estimateLodTokens,
  firstSentence,
  renderChapterLod,
} from "../src/lib/dm/chapter-lod.ts";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

const chapter = (index, extra = {}) => ({
  id: `c${index}`,
  index,
  title: `Chapter ${index} title`,
  summary: `Summary sentence one for ${index}. Second sentence with more detail. Third sentence.`,
  ...extra,
});

const many = (count) => Array.from({ length: count }, (_, i) => chapter(i + 1));

check("no chapters renders nothing rather than an empty header", () => {
  const result = renderChapterLod([], 1_000);
  assert.equal(result.text, "");
  assert.equal(result.tokens, 0);
  assert.deepEqual(result.tierById, {});
});

check("a single sealed chapter renders in full", () => {
  const result = renderChapterLod([chapter(1)], 1_000);
  assert.equal(result.tierById.c1, "summary");
  assert.ok(result.text.includes("Second sentence"), "the whole summary is present");
});

check("first sentence extraction falls back sensibly", () => {
  assert.equal(firstSentence("One. Two."), "One.");
  assert.equal(firstSentence("No terminator here"), "No terminator here");
  assert.equal(firstSentence(""), "");
  assert.equal(firstSentence("   "), "");
});

check("the newest N chapters are full summary, the rest synopsis", () => {
  const chapters = many(10);
  const result = renderChapterLod(chapters, 100_000);
  const summaries = Object.values(result.tierById).filter((tier) => tier === "summary");
  assert.equal(summaries.length, DEFAULT_LOD_CONFIG.summaryChapters);
  // Chapters 4..10 are the newest seven.
  assert.equal(result.tierById.c10, "summary");
  assert.equal(result.tierById.c4, "summary");
  assert.equal(result.tierById.c3, "synopsis", "the oldest fall to synopsis");
  assert.equal(result.tierById.c1, "synopsis");
});

check("a high-importance older chapter is promoted over a duller newer one", () => {
  const chapters = many(10);
  // c3 sits just outside the newest seven (effective age 7). The bonus of 2
  // moves it to 5, inside the cutoff, which displaces c4 at age 6. The bonus
  // is deliberately a nudge, not an override: it rescues a chapter near the
  // boundary, it does not drag the oldest chapter back into full detail.
  chapters[2].importance = IMPORTANCE_THRESHOLD;
  const result = renderChapterLod(chapters, 100_000);
  assert.equal(result.tierById.c3, "summary", "importance pulled it into the full tier");
  assert.equal(result.tierById.c4, "synopsis", "and displaced the chapter it outranked");
  const summaries = Object.values(result.tierById).filter((tier) => tier === "summary");
  assert.equal(summaries.length, DEFAULT_LOD_CONFIG.summaryChapters, "still only seven");
});

check("the importance bonus cannot rescue a chapter far past the cutoff", () => {
  const chapters = many(10);
  chapters[0].importance = IMPORTANCE_THRESHOLD;
  const result = renderChapterLod(chapters, 100_000);
  // c1 is nine positions from the end; a bonus of two leaves it at seven,
  // still outside the newest seven. Recency still dominates.
  assert.equal(result.tierById.c1, "synopsis");
});

check("importance below the threshold does not promote", () => {
  const chapters = many(10);
  chapters[0].importance = IMPORTANCE_THRESHOLD - 1;
  const result = renderChapterLod(chapters, 100_000);
  assert.equal(result.tierById.c1, "synopsis");
});

check("effective age subtracts the bonus only for important chapters", () => {
  const ordered = many(3);
  assert.equal(effectiveAge(ordered[2], ordered, 2), 0, "newest is age 0");
  assert.equal(effectiveAge(ordered[0], ordered, 2), 2, "oldest of three is age 2");
  const important = { ...ordered[0], importance: IMPORTANCE_THRESHOLD };
  assert.equal(effectiveAge(important, [important, ordered[1], ordered[2]], 2), 0);
});

check("the cascade demotes every summary before dropping anything", () => {
  const chapters = many(10);
  const full = renderChapterLod(chapters, 100_000);
  // A budget that forces demotion but still fits ten synopses.
  const allSynopsis = renderChapterLod(chapters, 1);
  assert.ok(
    estimateLodTokens(allSynopsis.text) <= estimateLodTokens(full.text),
    "the squeezed render is smaller",
  );
  const tiers = Object.values(allSynopsis.tierById);
  const dropped = tiers.filter((tier) => tier === "dropped").length;
  const summaries = tiers.filter((tier) => tier === "summary").length;
  assert.equal(summaries, 0, "everything demoted before any drop");
  assert.ok(dropped > 0, "then dropping began");
});

check("dropping takes the oldest first", () => {
  const chapters = many(5);
  const result = renderChapterLod(chapters, 1);
  // Whatever survives, the newest must outlive the oldest.
  const survivors = chapters.filter((entry) => result.tierById[entry.id] !== "dropped");
  if (survivors.length) {
    const newestSurvivor = survivors[survivors.length - 1];
    assert.equal(newestSurvivor.id, "c5", "the newest chapter is the last to go");
  }
  assert.equal(result.tierById.c1, "dropped", "the oldest went first");
});

check("a generous budget drops nothing", () => {
  const result = renderChapterLod(many(10), 100_000);
  assert.ok(
    !Object.values(result.tierById).includes("dropped"),
    "nothing is discarded when it all fits",
  );
});

check("rendering is byte-identical across repeated runs", () => {
  const chapters = many(12);
  chapters[2].importance = 9;
  const a = renderChapterLod(chapters, 400);
  const b = renderChapterLod(chapters, 400);
  assert.equal(a.text, b.text, "same input, same bytes");
  assert.deepEqual(a.tierById, b.tierById);
  assert.equal(a.tokens, b.tokens);
});

check("input order does not change the output", () => {
  const chapters = many(8);
  const shuffled = [chapters[5], chapters[0], chapters[7], chapters[2], chapters[1], chapters[3], chapters[4], chapters[6]];
  const inOrder = renderChapterLod(chapters, 100_000);
  const outOfOrder = renderChapterLod(shuffled, 100_000);
  assert.equal(inOrder.text, outOfOrder.text, "sorted internally, so order in does not matter");
});

check("chapters render oldest first in the output", () => {
  const result = renderChapterLod(many(3), 100_000);
  const first = result.text.indexOf("Chapter 1 -");
  const last = result.text.indexOf("Chapter 3 -");
  assert.ok(first >= 0 && last > first, "chronological, so the model reads the story forward");
});

check("a duplicate chapter index still sorts deterministically", () => {
  const a = { id: "zz", index: 2, title: "Z", summary: "Zed happened." };
  const b = { id: "aa", index: 2, title: "A", summary: "Ay happened." };
  const one = renderChapterLod([a, b], 100_000);
  const two = renderChapterLod([b, a], 100_000);
  assert.equal(one.text, two.text, "tie broken by id, not by input order");
});

check("an empty summary degrades to the title rather than a blank line", () => {
  const result = renderChapterLod(
    [chapter(1), { id: "c2", index: 2, title: "Nameless deeds", summary: "" }],
    1,
  );
  if (result.tierById.c2 !== "dropped") {
    assert.ok(result.text.includes("Nameless deeds"));
  }
});

console.log(`chapter-lod: ${passed} tests passed`);
