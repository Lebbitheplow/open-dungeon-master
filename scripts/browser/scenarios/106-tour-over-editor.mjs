// The test bench of 2026-10-30: the Encounters tour came back after End the
// tour, and again after the fight was saved. A tour step that opens the
// encounter editor opens a modal sheet, and a modal sheet sets
// pointer-events: none on the page's body. The tour's card inherited it, so
// a click on End the tour or Next fell through to the editor behind the
// card; the tour stayed, and showed again once the editor closed. Here the
// tour is walked to a step that opens the editor and then driven with the
// pointer, the way a person does: Next moves on, End the tour closes it,
// and closing the editor does not bring it back.
import { check, eventually, upTo } from "../lib.mjs";

const TOUR = '[role="dialog"][aria-label="Guided tour"]';

export default {
  name: "tour-over-editor",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Tour over editor ${Date.now().toString(36)}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    const card = page.locator(TOUR);
    const stepOf = () => card.evaluateAll((cards) => cards[0]?.getAttribute("data-tour-step") ?? null);
    try {
      await t.open(`/workshop/${id}?system=encounters`);
      const help = page.locator(`${root}[data-tour="system-help"]`).locator("visible=true").first();
      await eventually(() => help.isVisible(), { timeoutMs: 30_000, label: "Help" });
      await help.click();
      const start = page.getByRole("dialog").getByRole("button", { name: "Tour Encounters", exact: true });
      await eventually(() => start.isVisible(), { timeoutMs: 10_000, label: "the Tour Encounters button" });
      await start.click();
      await eventually(() => card.count(), { timeoutMs: 15_000, label: "the Encounters tour opening" });

      // To the roster step, whose prepare opens the encounter editor.
      for (let guard = 0; guard < 20 && (await stepOf()) !== "picker"; guard += 1) {
        const was = await stepOf();
        await page.keyboard.press("ArrowRight");
        await upTo(async () => (await stepOf()) !== was, 1_000);
      }
      check((await stepOf()) === "picker", `the tour reached the roster step (at ${await stepOf()})`);
      const editor = page.getByRole("dialog", { name: "New encounter" });
      await eventually(() => editor.isVisible(), { timeoutMs: 5_000, label: "the encounter editor the step opened" });

      // Next, pressed with the pointer over the open editor, moves on. The
      // card's buttons are found by CSS: the open sheet hides the rest of
      // the page from the accessibility tree, so a role query misses them.
      await card.locator("button", { hasText: /next/i }).click({ timeout: 5_000 });
      await eventually(async () => (await stepOf()) === "map", { timeoutMs: 5_000, label: "Next over the editor moving to the map step" });

      // End the tour, pressed with the pointer, closes it at once.
      await card.locator(`button[aria-label="End the tour"]`).click({ timeout: 5_000 });
      await eventually(async () => (await card.count()) === 0, { timeoutMs: 5_000, label: "End the tour over the editor closing the tour" });

      // The editor the tour opened is the author's to close, and closing it
      // does not bring the tour back.
      check(await editor.isVisible(), "the editor stays open for the author");
      await editor.getByRole("button", { name: "Close" }).click();
      await eventually(async () => (await editor.count()) === 0, { timeoutMs: 5_000, label: "the editor closing" });
      check(!(await upTo(() => card.count(), 2_000)), "the tour stays ended once the editor closes");
    } finally {
      await api.delete(`${base}/api/workshops/${id}`).catch(() => {});
    }
  },
};
