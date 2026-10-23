// "Level up" on a library character opens its build one level up: the title
// says the level it reaches, and Save changes waits while the new level owes
// a pick (a level 3 fighter reaching 4 owes an ability score improvement).
// The build opens on its summary (backlog F3), which names the pick owed.
// The library pages are native screens in the app too.
import { check, eventually } from "../lib.mjs";

const visible = (page, root, text) =>
  page.locator(`${root}a, ${root}button`).filter({ hasText: text }).locator("visible=true");

export default {
  name: "library-level-up",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    await t.open(`/characters/${ids.library}`);
    const level = await eventually(async () => {
      const button = visible(page, root, /Level up to \d+/);
      return (await button.count()) ? button.first() : null;
    }, { label: "the Level up button" });
    // textContent, not innerText: the button is set in capitals by CSS.
    const target = Number(/level up to (\d+)/i.exec((await level.textContent()) ?? "")?.[1]);
    await t.tap(level);
    await page.locator(`${root}[data-finish-summary]`).locator("visible=true").first().waitFor({ state: "visible", timeout: 30_000 });
    await eventually(async () => {
      const text = (await page.locator(`${root}h1, ${root}h2`).allInnerTexts()).join(" ");
      return new RegExp(`reaches level ${target}`, "i").test(text);
    }, { timeoutMs: 15_000, label: `the title naming level ${target}` });
    const body = (await page.locator(root ? root.trim() : "body").first().innerText()).replace(/\s+/g, " ");
    check(new RegExp(`level ${target}`, "i").test(body), `the build opens at level ${target}`);
    await t.shot("levelled");
    // Level 4 brings an ability score improvement, so nothing is saved until
    // it is picked.
    if (target === 4) {
      const save = visible(page, root, /^Save changes$/);
      check((await save.count()) > 0 && (await save.first().getAttribute("aria-disabled")) === "true", "Save changes waits for the new improvement");
      const owed = page.locator(`${root}section[data-active] [data-summary-row="abilities"][data-owed]`).locator("visible=true");
      check((await owed.count()) > 0, "the summary's Abilities row names the improvement owed");
    }
  },
};
