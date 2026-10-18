// An accessibility check over the character builder: axe-core (WCAG 2.1 A
// and AA rules) on every step of a stored build, and on the lineage
// carousel, failing on any serious or critical violation. The steps are
// walked four times: at default settings, with reduced motion, with forced
// colours (Windows High Contrast), and at 200% zoom (half the window, the
// reflow WCAG asks for), and each step change must put focus on the new
// step's heading. The unit suites
// render static markup and never see a missing label, a name a screen reader
// cannot hear or a contrast below 4.5:1; the next art pass could add any of
// them unseen.
import fs from "node:fs";
import { createRequire } from "node:module";
import { check, eventually, sleep } from "../lib.mjs";

const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

async function axeViolations(page, selector) {
  if (!(await page.evaluate(() => Boolean(window.axe)))) {
    await page.addScriptTag({ content: axeSource });
  }
  return page.evaluate(async (scope) => {
    const root = document.querySelector(scope);
    if (!root) return [{ id: "missing-root", impact: "critical", help: `no ${scope}`, nodes: [] }];
    const result = await window.axe.run(root, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    // A run that checked nothing passes nothing either: say so, rather than
    // pass in silence.
    if (!result.passes.length) {
      return [{ id: "nothing-checked", impact: "critical", help: "axe checked no rule here", nodes: [scope] }];
    }
    return result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
      }));
  }, selector);
}

// What axe does not catch: a field caption that names nothing, a tab with no
// panel, or a score summary laid out as loose spans.
async function semantics(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-builder-root] [data-active]") ?? document.querySelector("[data-builder-root]");
    if (!root) return ["no builder root"];
    const problems = [];
    for (const group of root.querySelectorAll('[role="group"][aria-labelledby]')) {
      const caption = document.getElementById(group.getAttribute("aria-labelledby"));
      if (!caption?.textContent?.trim()) problems.push(`a field group's caption is missing or empty (${group.getAttribute("aria-labelledby")})`);
    }
    for (const tab of root.querySelectorAll('[role="tab"]')) {
      const panel = document.getElementById(tab.getAttribute("aria-controls") ?? "");
      if (!panel) problems.push(`a tab without a panel: ${tab.textContent?.trim()}`);
    }
    for (const summary of root.querySelectorAll("table")) {
      if (!summary.querySelector('th[scope="col"]')) problems.push("a table without column headers");
    }
    return problems;
  });
}

// The option picker (backlog B9) from the keyboard: Arrow Down opens it with
// focus in the listbox, arrows move the active option, the open list passes
// axe, and Escape closes it with focus back on the trigger.
async function pickerKeys(page, trigger) {
  const problems = [];
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await sleep(200);
  const state = () =>
    page.evaluate(() => {
      const focused = document.activeElement;
      return {
        role: focused?.getAttribute("role") ?? null,
        active: focused?.getAttribute("aria-activedescendant") ?? null,
        activeIsOption: document.getElementById(focused?.getAttribute("aria-activedescendant") ?? "")?.getAttribute("role") === "option",
        nestedButtons: focused?.getAttribute("role") === "listbox" ? focused.querySelectorAll("button").length : 0,
      };
    });
  const opened = await state();
  if (opened.role !== "listbox") return [`Arrow Down left focus on ${opened.role ?? "a non-listbox"}`];
  if (!opened.activeIsOption) problems.push("the listbox's active descendant is not an option");
  if (opened.nestedButtons) problems.push(`${opened.nestedButtons} buttons inside the listbox`);
  await page.keyboard.press("End");
  const ended = await state();
  await page.keyboard.press("Home");
  const homed = await state();
  if (ended.active === homed.active && ended.active) {
    // A one-option list cannot move; anything longer must.
    const count = await page.locator('[role="listbox"] [role="option"]').count();
    if (count > 1) problems.push("Home and End did not move the active option");
  }
  problems.push(...report("open list", await axeViolations(page, '[role="listbox"]')));
  await page.keyboard.press("Escape");
  await sleep(200);
  const back = await trigger.evaluate((node) => node === document.activeElement && node.getAttribute("aria-expanded") === "false");
  if (!back) problems.push("Escape did not close the list and return focus to the trigger");
  return problems;
}

function report(where, violations) {
  return violations.map((violation) => `${where}: ${violation.id} (${violation.impact}) ${violation.help} at ${violation.nodes.join(", ")}`);
}

export default {
  name: "builder-a11y",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const found = [];
    let pickerChecked = false;

    // Every step of a stored build, reached by its diamond, once per
    // condition. Emulated media survives the reopen; the zoom is the window
    // at half size, put back after.
    const size = page.viewportSize();
    const conditions = [
      { label: "default", media: {} },
      { label: "reduced motion", media: { reducedMotion: "reduce" } },
      { label: "forced colors", media: { forcedColors: "active" } },
      // 200% zoom on a phone would be narrower than the 320 px WCAG reflows
      // to, so the zoom runs on the wider windows only.
      ...(size && size.width / 2 >= 320 ? [{ label: "200% zoom", media: {}, zoom: true }] : []),
    ];
    for (const condition of conditions) {
      await page.emulateMedia({ reducedMotion: null, forcedColors: null, ...condition.media });
      if (condition.zoom && size) await page.setViewportSize({ width: Math.round(size.width / 2), height: Math.round(size.height / 2) });
      // In the app, opening the route already on screen is no fresh load:
      // the walk would start on the last condition's final step. Leave
      // first, as a player would.
      if (condition !== conditions[0]) await t.open("/characters");
      await t.open(`/characters/${ids.library}/edit`);
      await page.locator(`${root}input[aria-label="Name"]`).locator("visible=true").first().waitFor({ state: "visible", timeout: 30_000 });
      for (let step = 1; step <= 6; step += 1) {
        const where = `${condition.label}, step ${step}`;
        if (step > 1) {
          const diamond = page.locator(`${root}button[aria-label^="Go to step ${step}:"]`).locator("visible=true");
          await eventually(async () => (await diamond.count()) && diamond.first().isEnabled(), { timeoutMs: 15_000, label: `the step ${step} diamond` });
          await t.tap(diamond.first());
          await sleep(700);
          // Wizard.tsx moves focus to the new step's title on a step change,
          // so a keyboard or screen reader starts at the top of the step. A
          // step with a card grid then puts the caret in the grid's search
          // box for a keyboard and a mouse (OptionCardGrid, quick win Q12):
          // a labelled field at the top of the step, so it counts too.
          const focused = await eventually(
            () =>
              page.evaluate(
                () =>
                  document.activeElement?.matches(
                    '[data-builder-root] section[data-active] .wizard-step-heading, [data-builder-root] section[data-active] input[type="search"]',
                  ) ?? false,
              ),
            { timeoutMs: 3_000, label: `focus on the step ${step} heading` },
          ).then(() => "", () => page.evaluate(() => {
            const node = document.activeElement;
            return `${node?.tagName.toLowerCase() ?? "nothing"}${node?.className ? `.${String(node.className).split(" ").join(".")}` : ""}`;
          }));
          if (focused) found.push(`${where}: focus is on ${focused}, not the step's heading`);
        }
        found.push(...report(where, await axeViolations(page, "[data-builder-root]")));
        found.push(...(await semantics(page)).map((problem) => `${where}: ${problem}`));
        if (!pickerChecked) {
          const trigger = page.locator(`${root}[data-builder-root] button[aria-haspopup="listbox"]`).locator("visible=true");
          if (await trigger.count()) {
            pickerChecked = true;
            found.push(...(await pickerKeys(page, trigger.first())).map((problem) => `${where} picker: ${problem}`));
          }
        }
      }
      if (condition.zoom && size) await page.setViewportSize(size);
    }
    await page.emulateMedia({ reducedMotion: null, forcedColors: null });
    if (!pickerChecked) found.push("no option picker found on any step");

    // The "Show me" highlight under reduced motion: the global rule cuts the
    // flash to 0.01ms, so the block must keep a still outline instead.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const outline = await page.evaluate(async () => {
      // A block on the open step: one in a hidden step has no outline drawn.
      const target = [...document.querySelectorAll("[data-builder-root] [data-builder-target]")].find(
        (block) => block.getClientRects().length,
      );
      if (!target) return "no visible target";
      target.setAttribute("data-flash", "");
      // A card's own transition runs under the global 0.01ms cap; read the
      // outline once it has settled, a moment in, as a player would see it.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const { outlineStyle, outlineWidth } = getComputedStyle(target);
      target.removeAttribute("data-flash");
      return outlineStyle !== "none" && parseFloat(outlineWidth) > 0 ? "" : `outline ${outlineStyle} ${outlineWidth}`;
    });
    await page.emulateMedia({ reducedMotion: null });
    if (outline) found.push(`Show me highlight is invisible with reduced motion: ${outline}`);

    // The lineage carousel over a new character's Ancestry step.
    await t.open("/characters/new");
    const fresh = page.locator(`${root}button`).filter({ hasText: /^Start fresh$/ }).locator("visible=true");
    if (await fresh.count()) await t.tap(fresh.first());
    const name = page.locator(`${root}input[aria-label="Name"]`).locator("visible=true").first();
    await name.waitFor({ state: "visible", timeout: 30_000 });
    await name.fill("Axe Check");
    // The first step owes a background once none is picked for the player
    // (quick win Q1), so pick one before Continue.
    await t.tap(page.locator(`${root}section[data-active] [data-builder-target="background"] button[aria-haspopup="listbox"]`).locator("visible=true").first());
    await t.tap(page.locator(`${root}[role="option"]`).filter({ hasText: "Soldier" }).locator("visible=true").first());
    await t.tap(page.locator(`${root}button`).filter({ hasText: /^Continue/ }).locator("visible=true").first());
    await sleep(900);
    const details = page.locator(`${root}section[data-active] button[aria-label^="Details"], ${root}section[data-active] .creator-help`).locator("visible=true");
    await eventually(() => details.count(), { timeoutMs: 15_000, label: "a lineage card's details button" });
    await t.tap(details.first());
    await eventually(() => page.locator('[role="dialog"]').count(), { timeoutMs: 10_000, label: "the lineage carousel" });
    await sleep(500);
    found.push(...report("lineage carousel", await axeViolations(page, '[role="dialog"]')));

    if (found.length) await t.shot("violations");
    check(found.length === 0, `no serious or critical accessibility violations:\n  ${found.join("\n  ")}`);
  },
};
