// PRs #258 and #259: a list's load state is code, not prose. The Story panel
// of a table whose snapshot carried no chapter shows Chapter 1 once it exists
// (its creation is published to the table), and the workshop shelf with
// nothing on it shows its empty state alone; neither page shows
// "(loadError ?" as text, the way both did before #258.
import { check, eventually } from "../lib.mjs";

const LEAK = /\(loadError \?|: loaded \?|: null\)/;

export default {
  name: "empty-states",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    await t.open(`/campaigns/${ids.quietId}`);
    await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the quiet table's stage" });
    const storyTab = page.locator(`${root}[data-tour="tab-story"]`).locator("visible=true").first();
    await eventually(() => storyTab.count(), { timeoutMs: 30_000, label: "the Story tab" });
    await t.tap(storyTab);
    // The seeded table has no chapter row; the panel's own read creates
    // Chapter 1 and the table hears of it, so the open chapter is listed.
    // The heading is CSS-uppercased, so the text is read, not the rendering.
    const section = () => page.locator(`${root}.motion-tab`).locator("visible=true").first();
    const sectionText = () => section().evaluate((node) => node.textContent ?? "").catch(() => "");
    await eventually(async () => /chapter 1 in progress/i.test(await sectionText()), { timeoutMs: 30_000, label: "Chapter 1 in the Story panel" });
    const story = await sectionText();
    check(!LEAK.test(story), `the Story panel shows no conditional as text (${story.slice(0, 120).replace(/\s+/g, " ")})`);
    await t.shot("story");

    // The lead owns no workshop, so the shelf is its empty state.
    await t.open("/workshop");
    await eventually(async () => /No workshops yet/.test(await page.locator("body").innerText()), { timeoutMs: 30_000, label: "the workshop shelf's empty state" });
    const shelf = await page.evaluate(() => document.body.textContent ?? "");
    check(!LEAK.test(shelf), "the workshop shelf shows no conditional as text");
    await t.shot("workshop");
  },
};
