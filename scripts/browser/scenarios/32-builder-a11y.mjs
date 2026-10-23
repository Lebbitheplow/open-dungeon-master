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
import { axeViolations, check, eventually, sleep } from "../lib.mjs";

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

// One tab stop per group of choices (backlog F16), from the keyboard: the
// method switch and a standard-array row each hold one stop, the arrows and
// Home and End move inside, wrapping, Enter assigns, and Tab leaves the row.
async function arrayKeys(page) {
  const problems = [];
  const active = () =>
    page.evaluate(() => ({
      label: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? null,
      method: document.activeElement?.classList.contains("method-option") ?? false,
      inStrength: Boolean(document.activeElement?.closest('[aria-label="Strength score"]')),
      pressed: document.activeElement?.getAttribute("aria-pressed") ?? null,
    }));
  const stops = (selector) =>
    page.evaluate((selector) => [...document.querySelectorAll(selector)].filter((node) => node.getClientRects().length && node.tabIndex === 0).length, selector);
  const methods = "[data-builder-root] section[data-active] .method-switch .method-option";
  if ((await stops(methods)) !== 1) problems.push(`the method switch has ${await stops(methods)} tab stops, not 1`);
  await page.locator(methods).locator("visible=true").and(page.locator('[tabindex="0"]')).first().focus();
  const before = (await active()).label;
  await page.keyboard.press("ArrowRight");
  const after = await active();
  if (!after.method || after.label === before) problems.push("Arrow Right did not move along the method switch");
  if ((await stops(methods)) !== 1) problems.push("the method switch's tab stop did not follow the arrow");
  // Standard array is the first way; Home reaches it and Enter switches to
  // it if the build used another.
  await page.keyboard.press("Home");
  if ((await active()).pressed !== "true") await page.keyboard.press("Enter");
  // Every row from the keyboard, Strength 15 down to Charisma 8, which also
  // leaves the build a full array, so the later steps stay open.
  const abilities = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];
  const values = [15, 14, 13, 12, 10, 8];
  for (const [at, ability] of abilities.entries()) {
    const row = `[data-builder-root] section[data-active] [role="group"][aria-label="${ability} score"] button`;
    await eventually(async () => (await page.locator(row).locator("visible=true").count()) === 6, { timeoutMs: 5_000, label: `the ${ability} row of the standard array` });
    if ((await stops(row)) !== 1) problems.push(`the ${ability} row has ${await stops(row)} tab stops, not 1`);
    await page.locator(row).locator("visible=true").and(page.locator('[tabindex="0"]')).first().focus();
    const named = async (value) => (await active()).label?.startsWith(`${ability} ${value}`) === true;
    if (at === 0) {
      await page.keyboard.press("End");
      if (!(await named(8))) problems.push(`End went to ${(await active()).label}, not ${ability} 8`);
      await page.keyboard.press("ArrowRight");
      if (!(await named(15))) problems.push(`Arrow Right from the last did not wrap to the first: ${(await active()).label}`);
      await page.keyboard.press("ArrowLeft");
      if (!(await named(8))) problems.push(`Arrow Left from the first did not wrap to the last: ${(await active()).label}`);
    }
    await page.keyboard.press("Home");
    if (!(await named(15))) problems.push(`Home went to ${(await active()).label}, not ${ability} 15`);
    for (let step = 0; step < at; step += 1) await page.keyboard.press("ArrowRight");
    // Enter on the value already held takes it back, so press it twice then.
    if ((await active()).pressed === "true") await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await sleep(150);
    if (!(await named(values[at])) || (await active()).pressed !== "true") problems.push(`Enter did not give ${ability} ${values[at]}: ${(await active()).label}`);
    if (at === 0) {
      await page.keyboard.press("Tab");
      if ((await active()).inStrength) problems.push("Tab stayed inside the Strength row");
    }
  }
  return problems;
}

// The same for a card grid: one stop, arrows across rows and columns, Enter
// chooses, and Tab goes on to that card's ? and then out of the grid.
async function gridKeys(page) {
  const problems = [];
  const cards = "[data-builder-root] section[data-active] .creator-card";
  const state = () =>
    page.evaluate((cards) => {
      const list = [...document.querySelectorAll(cards)].filter((node) => node.getClientRects().length);
      const focused = document.activeElement;
      return {
        stops: list.filter((node) => node.tabIndex === 0).length,
        index: list.indexOf(focused),
        top: focused?.getBoundingClientRect().top ?? 0,
        pressed: focused?.getAttribute("aria-pressed") ?? null,
        help: focused?.classList.contains("creator-help") ? focused.closest(".creator-card-wrap")?.querySelector(".creator-card") === list.find((node) => node.tabIndex === 0) : null,
        inGrid: Boolean(focused?.closest(".creator-card-wrap")),
        count: list.length,
      };
    }, cards);
  const first = await state();
  if (first.stops !== 1) problems.push(`the card grid has ${first.stops} tab stops, not 1`);
  await page.locator(cards).locator("visible=true").and(page.locator('[tabindex="0"]')).first().focus();
  await page.keyboard.press("Home");
  if ((await state()).index !== 0) problems.push("Home did not reach the first card");
  await page.keyboard.press("ArrowRight");
  if ((await state()).index !== 1) problems.push("Arrow Right did not reach the second card");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  if ((await state()).index !== first.count - 1) problems.push("Arrow Left from the first card did not wrap to the last");
  await page.keyboard.press("Home");
  const top = (await state()).top;
  await page.keyboard.press("ArrowDown");
  const down = await state();
  if (down.index <= 0 || down.top <= top) problems.push(`Arrow Down did not reach the row below (card ${down.index})`);
  await page.keyboard.press("Enter");
  await sleep(300);
  if ((await state()).pressed !== "true") problems.push("Enter did not choose the focused card");
  if ((await state()).stops !== 1) problems.push("the grid's tab stop did not follow the arrows");
  await page.keyboard.press("Tab");
  if ((await state()).help !== true) problems.push("Tab from a card did not reach that card's details");
  await page.keyboard.press("Tab");
  if ((await state()).inGrid) problems.push("a second Tab stayed inside the card grid");
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
    let arrayChecked = false;

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
      // An edit opens on the summary (backlog F3); the walk starts at step 1.
      const first = page.locator(`${root}button[aria-label^="Back to step 1"]`).locator("visible=true");
      await eventually(() => first.count(), { timeoutMs: 30_000, label: "the first diamond from the summary" });
      await t.tap(first.first());
      await page.locator(`${root}section[data-active] input[aria-label="Name"]`).locator("visible=true").first().waitFor({ state: "visible", timeout: 30_000 });
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
        // Last on its step, as it may switch the build to the standard array.
        if (!arrayChecked && (await page.locator(`${root}section[data-active] .method-switch`).locator("visible=true").count())) {
          arrayChecked = true;
          found.push(...(await arrayKeys(page)).map((problem) => `${where} standard array: ${problem}`));
        }
      }
      if (condition.zoom && size) await page.setViewportSize(size);
    }
    await page.emulateMedia({ reducedMotion: null, forcedColors: null });
    if (!pickerChecked) found.push("no option picker found on any step");
    if (!arrayChecked) found.push("no method switch found on any step");

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
    await eventually(() => page.locator(`${root}section[data-active] .creator-card`).locator("visible=true").count(), { timeoutMs: 15_000, label: "the lineage cards" });
    found.push(...(await gridKeys(page)).map((problem) => `lineage grid: ${problem}`));
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
