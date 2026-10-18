// Keyboard-first picking and the lineage carousel's words (backlog Q12 and
// Q6), where only a live page shows them: entering the Ancestry step puts
// the caret in the grid's search box for a keyboard and a mouse but leaves a
// touch screen on the step's title; Enter on a lone match chooses it; and a
// step of the carousel says which lineage it reached while the button that
// paged keeps focus. The static checks are scripts/test-builder-search-carousel.mjs.
import { check, eventually, sleep } from "../lib.mjs";

export default {
  name: "builder-search",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root } = t;
    const found = [];

    await t.open("/characters/new");
    const fresh = page.locator(`${root}button`).filter({ hasText: /^Start fresh$/ }).locator("visible=true");
    if (await fresh.count()) await t.tap(fresh.first());
    const name = page.locator(`${root}input[aria-label="Name"]`).locator("visible=true").first();
    await name.waitFor({ state: "visible", timeout: 30_000 });
    await name.fill("Search Check");
    // The first step owes a background once none stands in for the player
    // (quick win Q1), so pick one before Continue.
    await t.tap(page.locator(`${root}section[data-active] [data-builder-target="background"] button[aria-haspopup="listbox"]`).locator("visible=true").first());
    await t.tap(page.locator(`${root}[role="option"]`).filter({ hasText: "Soldier" }).locator("visible=true").first());
    await t.tap(page.locator(`${root}button`).filter({ hasText: /^Continue/ }).locator("visible=true").first());

    const search = page.locator(`${root}section[data-active] input[type="search"]`).locator("visible=true");
    await eventually(() => search.count(), { timeoutMs: 15_000, label: "the lineage search box" });
    await sleep(900);
    const entry = await page.evaluate(() => ({
      fine: matchMedia("(hover: hover) and (pointer: fine)").matches,
      search: document.activeElement?.matches('input[type="search"]') ?? false,
      heading: document.activeElement?.classList.contains("wizard-step-heading") ?? false,
    }));
    if (entry.fine && !entry.search) found.push("a fine pointer entered the step without focus in the search box");
    if (!entry.fine && entry.search) found.push("a touch screen entered the step with focus in the search box (the keyboard would cover the cards)");
    if (!entry.fine && !entry.heading) found.push("a touch screen did not land on the step's title");

    // Enter on a single match chooses it. "tiefling" is one card on the
    // bundled SRD, but a content pack can bring a Tiefling Heritage beside
    // it, so the query is the first card name that matches alone.
    const matches = page.locator(`${root}section[data-active] .creator-card`).locator("visible=true");
    const names = await page.evaluate(() =>
      [...document.querySelectorAll("section[data-active] .creator-card .creator-plate-name")].map((node) => node.textContent?.trim() ?? ""),
    );
    let lone = "";
    for (const query of ["tiefling", ...names.filter(Boolean)]) {
      await search.first().focus();
      await search.first().fill(query);
      await sleep(300);
      if ((await matches.count()) === 1) {
        lone = query;
        break;
      }
    }
    if (lone) {
      await page.keyboard.press("Enter");
      await sleep(300);
      const pressed = await matches.first().getAttribute("aria-pressed");
      if (pressed !== "true") found.push(`Enter on the lone match for "${lone}" did not choose it`);
    } else {
      found.push(`no search among ${names.length} card names matched one card alone`);
    }
    await search.first().fill("");
    await sleep(300);

    // The carousel names where a step landed, and focus stays on Next.
    const details = page.locator(`${root}section[data-active] .creator-help`).locator("visible=true");
    await t.tap(details.first());
    const next = page.locator('[role="dialog"] button[aria-label^="Next: "]');
    await eventually(() => next.count(), { timeoutMs: 10_000, label: "the lineage carousel" });
    const nextName = (await next.getAttribute("aria-label")).replace(/^Next: /, "");
    await next.focus();
    await page.keyboard.press("Enter");
    await sleep(500);
    const after = await page.evaluate(() => ({
      live: document.querySelector('[role="dialog"] .sr-only[aria-live="polite"]')?.textContent ?? "",
      focusNext: document.activeElement?.getAttribute("aria-label")?.startsWith("Next: ") ?? false,
    }));
    if (!after.live.startsWith(`${nextName}, 2 of `)) found.push(`the carousel said "${after.live}" after stepping to ${nextName}`);
    if (!after.focusNext) found.push("focus left the Next button after a step");

    if (found.length) await t.shot("builder-search");
    check(found.length === 0, `keyboard-first picking and the carousel's words:\n  ${found.join("\n  ")}`);
  },
};
