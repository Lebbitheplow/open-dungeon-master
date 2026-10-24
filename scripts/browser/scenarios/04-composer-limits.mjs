// Issue 207 (PR 234): every box a player types into says its limit before
// the server refuses the text. The chronicle's desk and the Hand's composer
// both carry the note.
import { check, eventually } from "../lib.mjs";

export default {
  name: "composer-limits",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    await t.open(`/campaigns/${ids.campaignId}`);
    await eventually(() => page.locator(`${root}.cine-stage`).count(), { label: "the table" });
    // A phone opens a fight on its Battle tab, where no composer shows; the
    // Table tab holds the Hand and its composer. (The first-visit tour used
    // to land there on its way out, which this scenario leaned on.)
    const tableTab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: /^table$/i }).locator("visible=true").first();
    if (await tableTab.count()) {
      await t.tap(tableTab);
    }
    // The desk under the chronicle on the stage, or the Hand's composer
    // elsewhere: whichever is on screen says "Up to N characters".
    const note = await eventually(
      async () => {
        const body = (await page.locator(`${root}.cine-stage`).first().innerText()).replace(/\s+/g, " ");
        return body.match(/Up to [\d,]+ characters/)?.[0] ?? null;
      },
      { timeoutMs: 20_000, label: "a composer's limit note" },
    );
    check(/^Up to 2,000 characters$/.test(note), `the do/say composer says its limit (${note})`);
  },
};
