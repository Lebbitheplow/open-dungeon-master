// Issue #429, where a player meets it: the builder's backstory asks whom the
// character serves, and says the DM reads all of it.
import { check, eventually, sleep } from "../lib.mjs";

export default {
  name: "backstory-hint",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;

    await t.open(`/characters/${ids.library}/edit`);
    await page.locator(`${root}[data-finish-summary]`).locator("visible=true").first().waitFor({ state: "visible", timeout: 30_000 });
    // An edit opens on the summary (backlog F3), the step the backstory is on.
    const backstory = page.locator(`${root}textarea[aria-label="Backstory"]`).locator("visible=true").first();
    await eventually(() => backstory.count(), { label: "the Backstory field on the last step" });
    await backstory.scrollIntoViewIfNeeded();
    await sleep(600);
    const said = (await page.locator("body").textContent()) ?? "";
    check(/whom do they serve/.test(said), "the backstory asks whom the character serves");
    check(/the DM reads all of it/.test(said), "and says the DM reads all of it");
    check((await backstory.getAttribute("maxlength")) === "2000", "the backstory is held to 2000 characters");
    await t.shot("backstory");
  },
};
