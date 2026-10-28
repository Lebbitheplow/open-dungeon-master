// Issue 563: the console's two new fields, where a person running the table
// meets them. On the Gone Table the lead, its DM, moves the party with "Who
// goes" naming Kael alone: the party splits (a moment a companion holding a
// plan slips away), and the result says who went and who stayed. A deed's
// form has "Spoke against it", the party's own who objected, beside "Others
// who saw it". Both are chip pickers like the console's others: a named
// group, each character a pressable chip.
import { check, eventually, openPanelTab, untilStill } from "../lib.mjs";

export default {
  name: "party-split",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const table = ids.gone[viewport];
    await t.open(`/campaigns/${table.id}`);
    await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
    await openPanelTab(t, "dm");
    const tab = async (name) => {
      const button = page.locator(`${root}[data-tour="dm-console-tabs"] button`).filter({ hasText: new RegExp(`^${name}$`, "i") }).locator("visible=true").first();
      await eventually(() => button.count(), { timeoutMs: 30_000, label: `the console's ${name} tab` });
      await t.tap(button);
    };
    const open = async (name) => {
      const button = page.getByRole("button", { name: new RegExp(`^${name}`) }).locator("visible=true").first();
      await eventually(() => button.count(), { label: name });
      await t.tap(button);
      await untilStill(page);
    };

    // ---- Move the party, naming who goes ----
    await tab("world");
    await open("Move the party");
    const place = page.getByLabel("Place", { exact: true }).locator("visible=true").first();
    await eventually(() => place.count(), { label: "the Place field" });
    await place.fill("The Old Mill");
    const goes = page.getByRole("group", { name: "Who goes" }).locator("visible=true").first();
    await eventually(() => goes.count(), { label: "Who goes, a named group" });
    const kael = goes.getByRole("button", { name: /Kael Ashvale/ });
    check((await kael.getAttribute("aria-pressed")) === "false", "nobody is picked by default: the whole party goes");
    await t.tap(kael);
    check((await kael.getAttribute("aria-pressed")) === "true", "Kael picked");
    const box = await kael.boundingBox();
    check(Boolean(box) && box.height >= 32, `a chip a finger can press (${box?.height}px)`);
    await goes.scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("who-goes");
    const ran = page.waitForResponse((response) => response.url().endsWith("/dm/invoke") && response.request().method() === "POST", { timeout: 30_000 });
    ran.catch(() => {});
    await t.tap(page.getByRole("button", { name: /^\s*Run\s*$/ }).locator("visible=true").first());
    const answer = await ran;
    check(answer.ok(), `Run answered ${answer.status()}: ${await answer.text()}`);
    const body = await answer.json();
    check(/The party has split up: Kael Ashvale went to The Old Mill/.test(body.result?.note ?? ""), `the split, in the result: ${body.result?.note ?? JSON.stringify(body)}`);
    await untilStill(page);
    await t.shot("split");

    // ---- A deed's form: who spoke against it ----
    await tab("social");
    await open("Relationship beat");
    const against = page.getByRole("group", { name: "Spoke against it" }).locator("visible=true").first();
    await eventually(() => against.count(), { label: "Spoke against it, a named group" });
    check((await against.getByRole("button", { name: /Ilse Marrow/ }).count()) > 0, "each character a chip");
    await against.scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("spoke-against");
  },
};
