// "Level up" on a library character opens the level-up sheet (backlog F7):
// only what the new level brings, never the whole builder. The title says
// the level it reaches; a level 3 fighter reaching 4 owes an ability score
// improvement, so the sheet asks for it and its save waits; Choose for me
// fills it; the level table (backlog F8) marks the level held now and the
// new one, scrolling inside its own box on a phone; and Edit the whole
// build opens the full builder instead.
//
// The save is caught before it reaches the library, so Brann stays at his
// level for the scenarios after this one. What the sheet sent goes through
// the same route and rules check on a copy of him, which is then deleted.
// The library pages are native screens in the app too.
import { axeViolations, check, eventually } from "../lib.mjs";

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

    let sent = null;
    const own = new RegExp(`/api/characters/${ids.library}$`);
    const catchSave = async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      sent = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ character: { id: ids.library } }) });
    };
    await page.route(own, catchSave);
    try {
      await t.tap(level);
      const sheet = page.locator(`${root}[data-level-up-sheet]`).locator("visible=true");
      await sheet.first().waitFor({ state: "visible", timeout: 30_000 });
      await eventually(async () => {
        const text = (await page.locator(`${root}h1, ${root}h2`).allInnerTexts()).join(" ");
        return new RegExp(`reaches level ${target}`, "i").test(text);
      }, { timeoutMs: 15_000, label: `the title naming level ${target}` });
      check((await page.locator(`${root}[data-finish-summary]`).count()) === 0, "the sheet, not the whole builder, opens");
      const sheetText = (await sheet.first().innerText()).replace(/\s+/g, " ");
      check(new RegExp(`what level ${target} brings`, "i").test(sheetText), "the sheet says what the level brings");
      check(/hit points/i.test(sheetText), "the sheet names the hit points the level adds");

      // The level table: folded until asked for, then the level held now and
      // the new one, marked in words.
      const toggle = page.locator(`${root}[data-level-up-sheet] button[data-level-table-toggle]`).locator("visible=true");
      check((await toggle.first().getAttribute("aria-expanded")) === "false", "the level table starts folded");
      await t.tap(toggle.first());
      const table = page.locator(`${root}[data-level-up-sheet] table[data-level-table]`);
      await eventually(() => table.first().isVisible(), { timeoutMs: 10_000, label: "the level table, unfolded" });
      check((await table.count()) === 1, "the level table is on the sheet");
      check((await table.locator(`tr[data-level-row="${target}"][data-mark="next"]`).count()) === 1, `level ${target} is marked as the new one`);
      check((await table.locator(`tr[data-level-row="${target - 1}"][data-mark="current"]`).count()) === 1, `level ${target - 1} is marked as the one held`);
      check((await table.locator("thead th[scope=col]").count()) >= 4, "the table has column headers");
      // The table never widens the page: its own box scrolls.
      const widths = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        window: window.innerWidth,
        // What sticks out, when something does: the outermost few.
        wide: [...document.querySelectorAll("body *")]
          .filter((node) => node.getBoundingClientRect().right > window.innerWidth + 1)
          .filter((node) => !node.parentElement || node.parentElement.getBoundingClientRect().right <= window.innerWidth + 1)
          .slice(0, 4)
          .map((node) => `${node.tagName.toLowerCase()}.${String(node.className).split(" ").slice(0, 3).join(".")}`),
      }));
      check(
        widths.page <= widths.window + 1,
        `the page does not scroll sideways (${widths.page} > ${widths.window}: ${widths.wide.join(", ")})`,
      );

      const whole = page.locator(`${root}a[data-level-up-whole]`);
      check(/whole=1/.test((await whole.first().getAttribute("href")) ?? ""), "Edit the whole build opens the full builder");

      const violations = await axeViolations(page, `${root}[data-level-up-sheet]`);
      check(
        violations.length === 0,
        `the sheet passes axe: ${violations.map((entry) => `${entry.id} at ${entry.nodes.join(", ")}`).join("; ")}`,
      );
      await t.shot("sheet");

      if (target === 4) {
        const save = page.locator(`${root}button[data-level-up-save]`).locator("visible=true");
        check((await save.first().getAttribute("aria-disabled")) === "true", "the save waits for the new improvement");
        check((await page.locator(`${root}[data-level-up-sheet] [data-builder-target="asi"]`).count()) === 1, "the improvement is asked on the sheet");
        await t.tap(page.locator(`${root}button[data-level-up-fill]`).locator("visible=true").first());
        await page.locator(`${root}section[aria-label="Picked for you"]`).locator("visible=true").first().waitFor({ state: "visible", timeout: 15_000 });
        await eventually(async () => (await save.first().getAttribute("aria-disabled")) === null, { timeoutMs: 10_000, label: "the save, once the improvement is chosen" });
        await t.shot("chosen");
        // Wait for the save before the tap that sends it.
        const saving = page.waitForRequest((request) => own.test(request.url()) && request.method() === "PATCH", { timeout: 15_000 });
        await t.tap(save.first());
        await saving;
        check(sent?.level === target, `the sheet saves level ${target} (${sent?.level})`);
        const chosen = (sent?.sheet?.asiChoices ?? []).filter(Boolean);
        check(chosen.length >= 1, "the saved build carries the improvement chosen");

        // The same body through the real route and its rules check, on a copy.
        const copy = await t.api.post(`${t.base}/api/characters/${ids.library}/clone`);
        check(copy.ok(), `a copy of the character to check the save on (${copy.status()})`);
        const copyId = (await copy.json()).character?.id;
        try {
          const saved = await t.api.patch(`${t.base}/api/characters/${copyId}`, { data: sent });
          const body = await saved.json().catch(() => ({}));
          check(saved.ok(), `the server takes the level-up sheet's save: ${saved.status()} ${body?.error ?? ""}`);
          check(body?.character?.level === target, `the copy is saved at level ${target}`);
        } finally {
          await t.api.delete(`${t.base}/api/characters/${copyId}`);
        }
      }
    } finally {
      await page.unroute(own, catchSave);
    }
  },
};
