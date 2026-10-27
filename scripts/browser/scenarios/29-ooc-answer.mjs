// PR 314: the DM's out-of-character answer to table talk put to it ("@DM
// ...") is an aside. The chronicle reads it as a line, "Dungeon Master:" and
// the words, never as a passage with its drop cap, and the passage after it
// is still the story's newest.
import { check, eventually } from "../lib.mjs";

export default {
  name: "ooc-answer",
  // The chronicle sits beside the board on a wide screen; a phone reaches it
  // through its own tab (03-chronicle is desktop-only for the same reason).
  viewports: ["desktop"],
  async run(t) {
    const { page, root, ids } = t;
    await t.open(`/campaigns/${ids.campaignId}`);
    const log = page.locator(`${root}.cine-chronicle-log`).first();
    await eventually(() => log.count(), { timeoutMs: 30_000, label: "the chronicle" });
    const line = log.locator(".cine-chronicle-line").filter({ hasText: ids.oocAnswer.slice(0, 40) });
    await eventually(() => line.count(), { label: "the DM's answer on the scroll" });
    const text = ((await line.first().textContent()) ?? "").replace(/\s+/g, " ");
    check(text.startsWith("Game Master:"), `the answer is the DM's line (${text.slice(0, 60)})`);
    check(text.includes(ids.oocAnswer), "the answer reads whole");
    const asPassage = log.locator(".cine-chronicle-passage").filter({ hasText: ids.oocAnswer.slice(0, 40) });
    check((await asPassage.count()) === 0, "the answer is not drawn as a passage");
    const question = log.locator(".cine-chronicle-line").filter({ hasText: ids.oocQuestion.slice(0, 30) });
    check((await question.count()) > 0, "the question it answers is on the scroll too");
    // The passage after the answer is still the newest one on the scroll.
    const passages = log.locator(".cine-chronicle-passage");
    const newest = ((await passages.last().textContent()) ?? "").replace(/\s+/g, " ");
    check(newest.includes(ids.paragraphs[0].slice(0, 30)), "the story's last passage is still the newest");
    await line.first().scrollIntoViewIfNeeded().catch(() => undefined);
    await t.shot("ooc-answer");
  },
};
