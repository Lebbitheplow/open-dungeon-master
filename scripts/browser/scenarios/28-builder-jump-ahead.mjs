// The builder's diamonds jump ahead: a stored build opens on its summary
// (backlog F3), and back on its first step Save changes is still there, and a diamond ahead whose gates all pass can be tapped,
// so fixing one pick never means pressing Continue through every step
// between. The library edit is a native screen in the app too.
import { check, eventually, sleep } from "../lib.mjs";

const visible = (page, root, text) =>
  page.locator(`${root}a, ${root}button`).filter({ hasText: text }).locator("visible=true");

export default {
  name: "builder-jump-ahead",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    await t.open(`/characters/${ids.library}/edit`);
    const first = page.locator(`${root}button[aria-label^="Back to step 1"]`).locator("visible=true");
    await eventually(() => first.count(), { timeoutMs: 30_000, label: "the first diamond from the summary" });
    await t.tap(first.first());
    const name = page.locator(`${root}section[data-active] input[aria-label="Name"]`).locator("visible=true").first();
    await name.waitFor({ state: "visible", timeout: 30_000 });

    // A stored build owes nothing, so Save sits beside Continue on step 1.
    const save = visible(page, root, /^Save changes$/);
    await eventually(() => save.count(), { timeoutMs: 15_000, label: "Save changes on the first step" });
    await t.shot("save-on-step-1");

    // The fifth diamond (spells and gear) is reachable from the first.
    const ahead = page.locator(`${root}button[aria-label^="Go to step 5"]`).locator("visible=true");
    await eventually(async () => (await ahead.count()) && ahead.first().isEnabled(), {
      timeoutMs: 15_000,
      label: "the step 5 diamond, enabled",
    });
    await t.tap(ahead.first());
    await sleep(400);
    const current = page.locator(`${root}button[aria-current="step"]`).locator("visible=true");
    const label = await current.first().getAttribute("aria-label");
    check(/^Step 5:/.test(label ?? ""), `the jump lands on step 5 (${label})`);
    // And straight back by the first diamond.
    await t.tap(page.locator(`${root}button[aria-label^="Back to step 1"]`).locator("visible=true").first());
    await sleep(400);
    const back = await current.first().getAttribute("aria-label");
    check(/^Step 1:/.test(back ?? ""), `the first diamond goes back to step 1 (${back})`);
    await t.shot("jumped");
  },
};
