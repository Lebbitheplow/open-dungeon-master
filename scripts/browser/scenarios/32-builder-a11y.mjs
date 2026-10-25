// An accessibility check over the character builder: axe-core (WCAG 2.1 A
// and AA rules) on every step of a stored build, and on the lineage
// carousel, failing on any serious or critical violation. The steps are
// walked four times: at default settings, with reduced motion, with forced
// colours (Windows High Contrast), and at 200% zoom (half the window, the
// reflow WCAG asks for), and each step change must put focus on the new
// step's heading. On the class step it also reads the card faces and text
// sizes (backlog F11 and F17: plainAndReadable, forcedMarks). The unit suites
// render static markup and never see a missing label, a name a screen reader
// cannot hear or a contrast below 4.5:1; the next art pass could add any of
// them unseen.
import { axeViolations, check, eventually, untilStill, upTo } from "../lib.mjs";

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
  await upTo(() => page.evaluate(() => document.activeElement?.getAttribute("role") === "listbox"), 2_000);
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
  const back = await upTo(() => trigger.evaluate((node) => node === document.activeElement && node.getAttribute("aria-expanded") === "false"), 2_000);
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
    await upTo(async () => (await named(values[at])) && (await active()).pressed === "true", 2_000);
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
  await upTo(async () => (await state()).pressed === "true", 2_000);
  if ((await state()).pressed !== "true") problems.push("Enter did not choose the focused card");
  if ((await state()).stops !== 1) problems.push("the grid's tab stop did not follow the arrows");
  await page.keyboard.press("Tab");
  if ((await state()).help !== true) problems.push("Tab from a card did not reach that card's details");
  await page.keyboard.press("Tab");
  if ((await state()).inGrid) problems.push("a second Tab stayed inside the card grid");
  return problems;
}

// Plain card faces (backlog F11) and enlarged text (F17) on the class step:
// no bare die on a card with "Show rules and numbers" off, an ability's code
// only as "INT caster" or a signed bonus and heard as its name, the die after
// the HP words with the switch on and kept on the device, the header's name
// and HP line whole, and the app's 125% interface scale turning the cards
// into a list where two side by side could not hold their text, with the
// footer's buttons whole.
const BARE_DIE = /\bd(?:4|6|8|10|12|20)\b/i;
const LOOSE_CODE = /\b(?:STR|DEX|CON|INT|WIS|CHA)\b(?! (?:[+−-]\d|caster\b))/;
async function plainAndReadable(page, t, viewport) {
  const problems = [];
  const step = "[data-builder-root] section[data-active]";
  const toggle = page.locator(`${step} [role="switch"][aria-label="Show rules and numbers"]`).locator("visible=true").first();
  if (!(await toggle.count())) return ["no Show rules and numbers switch on the class step"];
  if ((await toggle.getAttribute("aria-checked")) !== "false") problems.push("the numbers switch starts on");
  // What the eye reads (the screen-reader-only names left out), and what a
  // screen reader hears (the hidden codes left out).
  const faces = (heard = false) =>
    page.locator(`${step} .creator-card`).evaluateAll((cards, heard) => cards.map((card) => {
      const copy = card.cloneNode(true);
      copy.querySelectorAll(heard ? "[aria-hidden='true']" : ".sr-only").forEach((node) => node.remove());
      // A space after each element, as the eye sees the chips apart.
      copy.querySelectorAll("*").forEach((node) => node.append(" "));
      return copy.textContent.replace(/\s+/g, " ").trim();
    }), heard);
  const off = await faces();
  for (const face of off) {
    if (BARE_DIE.test(face)) problems.push(`a card face shows a bare die with the numbers off: ${face}`);
    if (LOOSE_CODE.test(face)) problems.push(`a card face shows a loose ability code: ${face}`);
  }
  if (!off.some((face) => /\b(?:Very low|Low|Medium|High|Very high) HP\b/.test(face))) problems.push("no class card says its HP in words");
  for (const face of await faces(true)) {
    if (/\b(?:STR|DEX|CON|INT|WIS|CHA)\b/.test(face)) problems.push(`a screen reader hears a bare ability code: ${face}`);
  }
  await t.tap(toggle);
  await upTo(async () => (await toggle.getAttribute("aria-checked")) === "true", 2_000);
  const shown = await faces();
  if (!shown.some((face) => /\bHP, d\d+/.test(face))) problems.push("with the numbers on, no card shows its hit die after its HP");
  // The header keeps the hero's name and the HP line whole, die and all.
  const header = await page.evaluate(() => {
    const cut = (node) => (node ? node.scrollWidth > node.clientWidth + 1 || getComputedStyle(node).display === "none" : true);
    const title = document.querySelector("[data-builder-root] [data-wizard-title]");
    const aside = document.querySelector("[data-builder-root] [data-wizard-aside]");
    return { title: cut(title), aside: cut(aside), line: aside?.textContent ?? "" };
  });
  if (header.title) problems.push("the header cuts the hero's name short");
  if (header.aside || !/HP, d\d+/.test(header.line)) problems.push(`the header's HP line is cut or hidden (${header.line})`);
  if ((await page.evaluate(() => localStorage.getItem("odm:builder-numbers"))) !== "1") problems.push("the numbers switch is not kept on the device");

  // The app's interface scale at its largest (Settings, 125%) sets the root size.
  await page.evaluate(() => (document.documentElement.style.fontSize = "125%"));
  await untilStill(page);
  const layout = await page.evaluate((step) => {
    const grid = document.querySelector(`${step} .creator-grid`);
    const card = grid?.querySelector(".creator-card");
    const img = card?.querySelector(".creator-plate img");
    const footer = [...document.querySelectorAll("[data-builder-root] footer button")].filter((button) => button.getClientRects().length);
    return {
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0,
      thumb: card && img ? img.getBoundingClientRect().width / card.getBoundingClientRect().width : 1,
      clipped: footer.filter((button) => button.scrollWidth > button.clientWidth + 1).map((button) => button.textContent.trim()),
    };
  }, step);
  if (layout.clipped.length) problems.push(`at 125% text the footer cuts ${layout.clipped.join(", ")}`);
  await page.evaluate(() => (document.documentElement.style.fontSize = ""));
  if (viewport === "phone" && (layout.columns !== 1 || layout.thumb > 0.5)) problems.push(`at 125% text on a phone the cards are not a list (${layout.columns} columns)`);
  if (viewport !== "phone" && layout.columns < 2) problems.push(`at 125% text on a wide screen the cards became a list (${layout.columns} column)`);
  return problems;
}

// Text sizes on the open step (F17): nothing visible under the 13px badges,
// and no paragraph of body text under 16px.
async function textSizes(page) {
  const sizes = await page.evaluate(() => {
    const step = "[data-builder-root] section[data-active]";
    const visible = (node) => node.getClientRects().length && node.closest("[aria-hidden='true'], .sr-only") === null;
    const ownText = (node) => [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
    const nodes = [...document.querySelectorAll(`${step} *, [data-builder-root] header *`)].filter((node) => visible(node) && ownText(node));
    const size = (node) => parseFloat(getComputedStyle(node).fontSize);
    const name = (node) => `${node.tagName.toLowerCase()} "${node.textContent.trim().slice(0, 30)}" ${getComputedStyle(node).fontSize}`;
    return {
      small: nodes.filter((node) => size(node) < 13).map(name),
      body: nodes.filter((node) => node.tagName === "P" && !node.classList.contains("eyebrow") && node.textContent.trim().length > 40 && size(node) < 16).map(name),
    };
  });
  return [...sizes.small.map((text) => `text under 13px: ${text}`), ...sizes.body.map((text) => `body text under 16px: ${text}`)];
}

// Forced colours: the chosen card and the current step keep a mark that is
// not a colour the theme chose.
async function forcedMarks(page) {
  const marks = await page.evaluate(() => {
    const chosen = document.querySelector("[data-builder-root] section[data-active] .creator-card[aria-pressed='true']");
    const current = document.querySelector("[data-builder-root] .diamond-step[data-state='current'] .diamond-core");
    const later = document.querySelector("[data-builder-root] .diamond-step:not([data-state='current']):not([data-state='done']) .diamond-core");
    const style = chosen ? getComputedStyle(chosen) : null;
    return {
      chosen: Boolean(chosen),
      outline: style ? `${style.outlineStyle} ${style.outlineWidth}` : "",
      current: current ? getComputedStyle(current).backgroundColor : "",
      later: later ? getComputedStyle(later).backgroundColor : "",
    };
  });
  const problems = [];
  if (!marks.chosen) problems.push("no chosen class card to check");
  else if (!marks.outline.startsWith("solid") || parseFloat(marks.outline.split(" ")[1]) < 2) problems.push(`the chosen card has no outline in forced colours (${marks.outline})`);
  if (marks.later && marks.current === marks.later) problems.push(`the current step looks like a later one in forced colours (${marks.current})`);
  return problems;
}

function report(where, violations) {
  return violations.map((violation) => `${where}: ${violation.id} (${violation.impact}) ${violation.help} at ${violation.nodes.join(", ")}`);
}

export default {
  name: "builder-a11y",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
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
      // Step 1 is the class (backlog F4).
      await page.locator(`${root}section[data-active] [data-builder-target="class"]`).locator("visible=true").first().waitFor({ state: "visible", timeout: 30_000 });
      for (let step = 1; step <= 6; step += 1) {
        const where = `${condition.label}, step ${step}`;
        if (step > 1) {
          const diamond = page.locator(`${root}button[aria-label^="Go to step ${step}:"]`).locator("visible=true");
          await eventually(async () => (await diamond.count()) && diamond.first().isEnabled(), { timeoutMs: 15_000, label: `the step ${step} diamond` });
          await t.tap(diamond.first());
          await untilStill(page);
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
        if (condition.label === "default") {
          found.push(...(await textSizes(page)).map((problem) => `${where}: ${problem}`));
          if (step === 1) found.push(...(await plainAndReadable(page, t, viewport)).map((problem) => `${where}: ${problem}`));
        }
        // The switch was left on under "default"; this condition opened the
        // builder afresh, so it must still be on. It is put back off here.
        if (step === 1 && condition.label === "reduced motion") {
          const toggle = page.locator(`${root}section[data-active] [role="switch"][aria-label="Show rules and numbers"]`).locator("visible=true").first();
          if ((await toggle.getAttribute("aria-checked")) !== "true") found.push(`${where}: the numbers switch did not stay on across a fresh load`);
          else await t.tap(toggle);
        }
        if (step === 1 && condition.label === "forced colors") {
          found.push(...(await forcedMarks(page)).map((problem) => `${where}: ${problem}`));
        }
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
      // outline once it has settled, two frames in, as a player would see it.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const { outlineStyle, outlineWidth } = getComputedStyle(target);
      target.removeAttribute("data-flash");
      return outlineStyle !== "none" && parseFloat(outlineWidth) > 0 ? "" : `outline ${outlineStyle} ${outlineWidth}`;
    });
    await page.emulateMedia({ reducedMotion: null });
    if (outline) found.push(`Show me highlight is invisible with reduced motion: ${outline}`);

    // The lineage carousel over a new character's Ancestry step. The first
    // step is the class (backlog F4): a barbarian owes only its two skills.
    await t.open("/characters/new");
    const fresh = page.locator(`${root}button`).filter({ hasText: /^Start fresh$/ }).locator("visible=true");
    if (await fresh.count()) await t.tap(fresh.first());
    const barbarian = page.locator(`${root}section[data-active] .creator-card[aria-label^="Barbarian"]`).locator("visible=true").first();
    await barbarian.waitFor({ state: "visible", timeout: 30_000 });
    await t.tap(barbarian);
    await t.tap(page.locator(`${root}section[data-active] [data-suggest-skills]`).locator("visible=true").first());
    await t.tap(page.locator(`${root}button`).filter({ hasText: /^Continue/ }).locator("visible=true").first());
    await eventually(() => page.locator(`${root}section[data-active] .creator-card`).locator("visible=true").count(), { timeoutMs: 15_000, label: "the lineage cards" });
    await untilStill(page);
    found.push(...(await gridKeys(page)).map((problem) => `lineage grid: ${problem}`));
    const details = page.locator(`${root}section[data-active] button[aria-label^="About "], ${root}section[data-active] .creator-help`).locator("visible=true");
    await eventually(() => details.count(), { timeoutMs: 15_000, label: "a lineage card's details button" });
    await t.tap(details.first());
    await eventually(() => page.locator('[role="dialog"]').count(), { timeoutMs: 10_000, label: "the lineage carousel" });
    await untilStill(page);
    found.push(...report("lineage carousel", await axeViolations(page, '[role="dialog"]')));

    if (found.length) await t.shot("violations");
    check(found.length === 0, `no serious or critical accessibility violations:\n  ${found.join("\n  ")}`);
  },
};
