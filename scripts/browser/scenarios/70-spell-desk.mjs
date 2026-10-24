// The spell desk (backlog F13) on a stored Life Domain cleric with a full
// prepared list: the step shows the save DC, attack and slots, the prepared
// cap as its sum, and the prepared list beside the book; the filters are the
// kit's pickers, a school written capitalised; the ritual filter keeps only
// rituals; and a tap on a new spell while the list is full asks which one it
// replaces (focus moves to the question, Escape calls it off and gives focus
// back to the tile) and swaps the pair in one action. On a phone every
// filter and swap control is at least 40 px tall.
import { axeViolations, check, eventually } from "../lib.mjs";

export default {
  name: "spell-desk",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const found = [];
    const active = `${root}section[data-active]`;
    await t.open(`/characters/${ids.lifeCleric}/edit`);
    const spellsRow = page.locator(`${active} [data-summary-edit="spells-gear"]`).locator("visible=true");
    await eventually(() => spellsRow.count(), { timeoutMs: 30_000, label: "the summary's spells row" });
    await t.tap(spellsRow.first());
    const desk = page.locator(`${active} [data-spell-desk]`).first();
    await desk.waitFor({ state: "visible", timeout: 30_000 });
    const tile = (name) => page.locator(`${active} li[data-spell="${name}"]`).first();
    await eventually(() => tile("Detect Magic").isVisible(), { timeoutMs: 30_000, label: "the class list's tiles" });

    const numbers = (await desk.locator("[data-casting-numbers]").textContent())?.replace(/\s+/g, " ") ?? "";
    for (const part of ["Spell save DC13", "Spell attack+5", "Slots1st 2"]) {
      if (!numbers.replace(/\s/g, "").includes(part.replace(/\s/g, ""))) found.push(`the casting numbers lack "${part}": ${numbers}`);
    }
    const caps = (await desk.locator("[data-spell-caps]").textContent())?.replace(/\s+/g, " ") ?? "";
    if (!caps.includes("Prepared: Cleric level 1 + WIS +3 = 4")) found.push(`the caps read "${caps}"`);
    const lists = (await desk.locator("[data-chosen-spells]").textContent())?.replace(/\s+/g, " ") ?? "";
    if (!/Prepared 4\/4/.test(lists) || !lists.includes("Sanctuary")) found.push(`the chosen lists read "${lists}"`);
    if (!/Always prepared/.test(lists)) found.push("the domain's spells are not listed beside the prepared ones");

    // A finger-sized control on a phone (AGENTS.md: 40 px); a mouse on a
    // desk keeps the compact sizes.
    const tall = async (locator, what) => {
      if (t.viewport !== "phone") return;
      const box = await locator.boundingBox();
      if (!box || box.height < 40) found.push(`${what} is ${Math.round(box?.height ?? 0)}px tall on a phone, under 40px`);
    };

    // The filters are the kit's pickers, each saying its choice; a school
    // reads capitalised, written so rather than by CSS.
    const filters = page.locator(`${active} [data-spell-filters]`).first();
    const school = filters.locator('button[aria-label^="School:"]').first();
    if ((await school.innerText()).trim() !== "School: any") found.push(`the school picker reads "${(await school.innerText()).trim()}"`);
    await tall(school, "the school picker");
    await t.tap(school);
    const evocation = page.getByRole("menuitemradio", { name: "School: Evocation" }).locator("visible=true").first();
    await eventually(() => evocation.count(), { timeoutMs: 5_000, label: "the school list" }).catch(() =>
      found.push("the school list has no capitalised Evocation"),
    );
    await page.keyboard.press("Escape");

    // The ritual filter keeps only rituals, then clears.
    const ritual = filters.locator('input[type="checkbox"]').first();
    await tall(ritual.locator("xpath=ancestor::label[1]"), "the Rituals only label");
    await t.tap(ritual);
    await eventually(async () => !(await tile("Command").count()), { timeoutMs: 5_000, label: "Command filtered out" }).catch(() =>
      found.push("Rituals only kept Command"),
    );
    if (!(await tile("Detect Magic").isVisible())) found.push("Rituals only hid Detect Magic");
    await t.shot("rituals");
    const clear = filters.locator("button").filter({ hasText: "Clear filters" }).first();
    await tall(clear, "Clear filters");
    await t.tap(clear);
    await eventually(() => tile("Command").isVisible(), { timeoutMs: 5_000, label: "Command back after Clear filters" });

    // A full list asks which spell goes.
    const swap = page.locator(`${active} [data-spell-swap]`);
    const note = (await tile("Detect Magic").textContent()) ?? "";
    if (!/tap to swap in/.test(note)) found.push(`a new spell on a full list says "${note.trim()}"`);
    await t.tap(tile("Detect Magic").locator("button").first());
    await eventually(() => swap.isVisible(), { timeoutMs: 5_000, label: "the swap question" });
    // Focus moves after the question paints: waited for, not slept for, so a
    // slower runner reads the same answer.
    await eventually(() => swap.evaluate((node) => node === document.activeElement || node.contains(document.activeElement)), {
      timeoutMs: 3_000,
      label: "focus in the swap question",
    }).catch(() => found.push("focus did not move to the swap question"));
    const question = (await swap.getAttribute("aria-label")) ?? "";
    if (question !== "Prepared list full. Swap Detect Magic in for:") found.push(`the swap asks "${question}"`);
    found.push(...(await axeViolations(page, "[data-spell-swap]")).map((violation) => `swap: ${violation.id} (${violation.impact}) ${violation.help}`));
    await tall(swap.locator('button[aria-label^="Sanctuary:"]').first(), "a swap choice");
    await tall(swap.locator("button").filter({ hasText: "Cancel" }).first(), "the swap's Cancel");
    await t.shot("swap");
    await page.keyboard.press("Escape");
    await eventually(async () => (await swap.count()) === 0, { timeoutMs: 5_000, label: "Escape closing the swap" });
    await eventually(() => tile("Detect Magic").evaluate((node) => node.contains(document.activeElement)), {
      timeoutMs: 3_000,
      label: "focus back on the tile",
    }).catch(() => found.push("Escape did not give focus back to the tile"));

    await t.tap(tile("Detect Magic").locator("button").first());
    await eventually(() => swap.isVisible(), { timeoutMs: 5_000, label: "the swap question again" });
    await t.tap(swap.locator('button[aria-label^="Sanctuary:"]').first());
    await eventually(async () => (await swap.count()) === 0, { timeoutMs: 5_000, label: "the swap closing" });
    await eventually(async () => (await tile("Detect Magic").getAttribute("data-state")) === "ready", { timeoutMs: 5_000, label: "Detect Magic prepared" }).catch(() =>
      found.push("Detect Magic was not prepared by the swap"),
    );
    if ((await tile("Sanctuary").getAttribute("data-state")) !== "available") found.push("Sanctuary stayed prepared after the swap");
    const after = (await desk.locator("[data-chosen-spells]").textContent())?.replace(/\s+/g, " ") ?? "";
    if (!/Prepared 4\/4/.test(after) || after.includes("Sanctuary")) found.push(`after the swap the lists read "${after}"`);
    found.push(...(await axeViolations(page, "[data-spell-desk]")).map((violation) => `desk: ${violation.id} (${violation.impact}) ${violation.help}`));

    if (found.length) await t.shot("problems");
    check(found.length === 0, `the spell desk:\n  ${found.join("\n  ")}`);
  },
};
