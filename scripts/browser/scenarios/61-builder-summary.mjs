// Backlog F3: editing a character opens on a summary, one row per step,
// with focus on its heading. A row's Edit goes to its step, and "Back to
// summary" comes back with focus on that row. A pick still owed is said in
// words with a Fix that lands on its field. A new build ends on the same
// summary, with its save button there. Nothing here is saved.
import { check, eventually, sleep } from "../lib.mjs";

const visible = (page, root, text) =>
  page.locator(`${root}button`).filter({ hasText: text }).locator("visible=true");

const currentStep = async (page, root) =>
  (await page.locator(`${root}button[aria-current="step"]`).locator("visible=true").first().getAttribute("aria-label")) ?? "";

async function onStep(page, root, number, label) {
  await eventually(async () => new RegExp(`^Step ${number}:`).test(await currentStep(page, root)), {
    timeoutMs: 10_000,
    label: `step ${number}${label ? ` (${label})` : ""}`,
  });
}

const focusMatches = (page, selector) => page.evaluate((selector) => document.activeElement?.matches(selector) ?? false, selector);

export default {
  name: "builder-summary",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const summary = page.locator(`${root}section[data-active] [data-finish-summary]`).locator("visible=true");

    // An edit opens on the summary, its heading focused.
    await t.open(`/characters/${ids.library}/edit`);
    await eventually(() => summary.count(), { timeoutMs: 30_000, label: "the summary on opening an edit" });
    await onStep(page, root, 6, "the summary");
    await eventually(() => focusMatches(page, "[data-builder-root] section[data-active] .wizard-step-heading"), {
      timeoutMs: 5_000,
      label: "focus on the summary heading",
    });
    const rows = await summary.first().locator("h4").allInnerTexts();
    check(rows.length === 6, `one heading per step (${rows.join(", ")})`);
    check(rows[5] === "Finishing touches", `the last row is the finishing touches (${rows[5]})`);
    check(/Every step is complete/.test(await summary.first().locator("xpath=..").innerText()), "a stored build owes nothing");
    check((await visible(page, root, /^Save changes$/).count()) > 0, "Save changes is on the summary");
    check((await visible(page, root, /^Back to summary$/).count()) === 0, "the summary has no Back to summary");
    await t.shot("summary");

    // The step names under the diamonds keep their own row: the step's
    // heading starts clear of them, at 1rem and with the text enlarged,
    // and the names grow with the text.
    const clearance = () =>
      page.evaluate(() => {
        const builder = document.querySelector("[data-builder-root]");
        const names = [...builder.querySelectorAll("[data-diamond-name]")];
        const heading = builder.querySelector("section[data-active] .wizard-step-heading");
        const bottom = Math.max(...names.map((name) => name.getBoundingClientRect().bottom));
        // Printed names side by side must not touch.
        const shown = names.filter((name) => getComputedStyle(name).visibility !== "hidden").map((name) => name.getBoundingClientRect());
        const touching = shown.some((box, index) => index > 0 && box.left < shown[index - 1].right + 2);
        return {
          touching,
          shown: shown.length,
          gap: Math.round(heading.getBoundingClientRect().top - bottom),
          size: parseFloat(getComputedStyle(names[0]).fontSize),
        };
      });
    const plain = await clearance();
    check(!plain.touching, "the step names do not run together");
    check(t.viewport !== "desktop" || plain.shown === 6, `every step name is printed on a desktop (${plain.shown})`);
    check(plain.gap >= 8, `the step heading starts below the step names (${plain.gap}px clear)`);
    await page.evaluate(() => (document.documentElement.style.fontSize = "150%"));
    await sleep(300);
    const enlarged = await clearance();
    await t.shot("summary-enlarged");
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    check(!enlarged.touching && enlarged.shown >= 1, `enlarged, the printed names do not run together (${enlarged.shown} shown)`);
    check(enlarged.gap >= 8, `and with the text enlarged (${enlarged.gap}px clear)`);
    check(enlarged.size > plain.size, `the step names grow with the text (${plain.size}px to ${enlarged.size}px)`);

    // A row goes to its step, and Back to summary returns focus to it.
    await t.tap(page.locator(`${root}section[data-active] [data-summary-edit="calling"]`).first());
    await onStep(page, root, 3, "Class");
    const back = visible(page, root, /^Back to summary$/);
    await eventually(() => back.count(), { timeoutMs: 5_000, label: "Back to summary on the Class step" });
    check((await visible(page, root, /^Save changes$/).count()) > 0, "saving from any step still works");
    await t.tap(back.first());
    await onStep(page, root, 6, "the summary again");
    await eventually(() => focusMatches(page, '[data-summary-edit="calling"]'), { timeoutMs: 5_000, label: "focus back on the Class row" });

    // A level up owes a pick: said in words, with a Fix that lands on it.
    await t.open(`/characters/${ids.library}/edit?levelUp=1`);
    await eventually(() => summary.count(), { timeoutMs: 30_000, label: "the summary of a level up" });
    const owedRow = page.locator(`${root}section[data-active] [data-summary-row][data-owed]`).locator("visible=true");
    await eventually(() => owedRow.count(), { timeoutMs: 15_000, label: "a row with a pick owed" });
    const rowText = await owedRow.first().innerText();
    check(/Still to choose:/.test(rowText), `the owed pick is said in words (${rowText.replace(/\s+/g, " ")})`);
    const fix = owedRow.first().locator("[data-summary-fix]").first();
    const target = await fix.getAttribute("data-summary-fix");
    const rowKey = await owedRow.first().getAttribute("data-summary-row");
    await t.shot("owed");
    await t.tap(fix);
    await eventually(
      () =>
        page.evaluate(
          (target) => Boolean(document.activeElement?.closest(`section[data-active] [data-builder-target="${target}"]`)),
          target,
        ),
      { timeoutMs: 5_000, label: `focus inside the ${target} field` },
    );
    await t.shot("fixed");
    await t.tap(visible(page, root, /^Back to summary$/).first());
    await onStep(page, root, 6, "back from the Fix");
    await eventually(() => focusMatches(page, `[data-summary-edit="${rowKey}"]`), { timeoutMs: 5_000, label: `focus back on the ${rowKey} row` });

    // A new build ends on the same summary, with its save there.
    await t.open("/characters/new");
    const startFresh = visible(page, root, /^Start fresh$/);
    if (await startFresh.count()) await t.tap(startFresh.first());
    const name = page.locator(`${root}section[data-active] input[aria-label="Name"]`).locator("visible=true").first();
    await name.waitFor({ state: "visible", timeout: 30_000 });
    await name.fill(`Summary Check ${t.viewport}`);
    check((await visible(page, root, /^Back to summary$/).count()) === 0, "no Back to summary before the summary is reached");
    const fill = page.locator(`${root}section[data-active] [data-quick-fill]`).locator("visible=true");
    await eventually(() => fill.count(), { timeoutMs: 10_000, label: "Fill what's left" });
    await t.tap(fill.first());
    await eventually(() => page.locator(`${root}[data-quick-readback]`).count(), { timeoutMs: 20_000, label: "the read-back" });
    await t.tap(visible(page, root, /^Keep them$/).first());
    for (let step = 1; step < 6; step += 1) {
      const next = page.locator(`${root}button.wizard-continue`).locator("visible=true").first();
      // A tap during the step wipe can be lost, so tap again until the
      // step moves on.
      await eventually(
        async () => {
          if (new RegExp(`^Step ${step + 1}:`).test(await currentStep(page, root))) return true;
          if (await next.isEnabled()) await t.tap(next);
          await sleep(800);
          return new RegExp(`^Step ${step + 1}:`).test(await currentStep(page, root));
        },
        { timeoutMs: 20_000, label: `Continue from step ${step}` },
      );
      await sleep(300);
    }
    await eventually(() => summary.count(), { timeoutMs: 10_000, label: "the summary at the end of a new build" });
    check(/Every step is complete/.test(await page.locator(`${root}section[data-active]`).first().innerText()), "the filled build owes nothing");
    const done = await page.locator(`${root}button.wizard-continue`).locator("visible=true").first().innerText();
    check(!/^Continue/.test(done.trim()), `the summary's button saves (${done.trim()})`);
    await t.shot("new-build-summary");
    await t.tap(page.locator(`${root}section[data-active] [data-summary-edit="ancestry"]`).first());
    await onStep(page, root, 2, "Ancestry");
    await t.tap(visible(page, root, /^Back to summary$/).first());
    await onStep(page, root, 6, "the new build's summary again");
    await eventually(() => focusMatches(page, '[data-summary-edit="ancestry"]'), { timeoutMs: 5_000, label: "focus back on the Ancestry row" });
  },
};
