// The build math table (backlog F10) on a stored build: from lg it stands
// beside the steps, open; on a phone it sits under them, folded behind a
// button that says whether it is open. It is a real table with row and
// column headers, its text is 1rem, it passes axe, and a pick that moves
// the numbers is said once, politely, as "Hit points 44, was 28" and how
// many more changed.
import { axeViolations, check, eventually, sleep } from "../lib.mjs";

export default {
  name: "build-math",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const found = [];
    await t.open(`/characters/${ids.library}/edit`);
    // The edit opens on its summary (backlog F3); the name row goes to the
    // identity step, the last before it (backlog F4).
    const nameRow = page.locator(`${root}section[data-active] [data-summary-edit="identity"]`).locator("visible=true");
    await eventually(() => nameRow.count(), { timeoutMs: 30_000, label: "the summary's name row" });
    await t.tap(nameRow.first());
    const name = page.locator(`${root}section[data-active] input[aria-label="Name"]`).locator("visible=true").first();
    await name.waitFor({ state: "visible", timeout: 30_000 });

    const panel = page.locator(`${root}[data-build-math]`).first();
    const table = panel.locator("table");
    const toggle = panel.locator("button[aria-expanded]");
    // creator.css widens the page from 64rem, room for the table beside.
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    if (wide) {
      if (await toggle.isVisible()) found.push("the fold button shows beside the steps");
      await eventually(() => table.isVisible(), { timeoutMs: 15_000, label: "the build math table" });
      const [field, box] = [await name.boundingBox(), await panel.boundingBox()];
      if (!field || !box || box.x < field.x + field.width) found.push("the table is not beside the steps");
    } else {
      if ((await toggle.getAttribute("aria-expanded")) !== "false") found.push("the table is not folded on a phone");
      if (await table.isVisible()) found.push("the folded table shows");
      const [field, box] = [await name.boundingBox(), await panel.boundingBox()];
      if (!field || !box || box.y < field.y) found.push("the table is not under the steps");
      const target = await toggle.boundingBox();
      if (!target || target.height < 40) found.push(`the fold button is ${target?.height ?? 0}px tall`);
      await t.shot("folded");
      await t.tap(toggle);
      await eventually(() => table.isVisible(), { timeoutMs: 5_000, label: "the opened table" });
      if ((await toggle.getAttribute("aria-expanded")) !== "true") found.push("the opened button does not say so");
    }

    // Row and column headers, and every number the sheet carries.
    const shape = await table.evaluate((node) => ({
      cols: node.querySelectorAll('thead th[scope="col"]').length,
      rowHeads: node.querySelectorAll('tbody th[scope="row"]').length,
      rows: [...node.querySelectorAll("tr[data-row]")].map((row) => row.getAttribute("data-row")),
      smallest: Math.min(
        ...[...node.querySelectorAll("tbody th, tbody td")].map((cell) => parseFloat(getComputedStyle(cell).fontSize)),
      ),
    }));
    if (shape.cols !== 3) found.push(`${shape.cols} column headers, not 3`);
    for (const row of ["ac", "hp", "initiative", "proficiency", "save-str", "save-cha", "skill-athletics", "weapon-Longsword"]) {
      if (!shape.rows.includes(row)) found.push(`no ${row} row`);
    }
    if (shape.rowHeads !== shape.rows.length) found.push("a row without its header");
    if (shape.smallest < 16) found.push(`text at ${shape.smallest}px, under 1rem`);
    const violations = await axeViolations(page, "[data-build-math]");
    found.push(...violations.map((violation) => `${violation.id} (${violation.impact}) ${violation.help} at ${violation.nodes.join(", ")}`));
    await t.shot("table");

    // A level change moves a burst of numbers; one line is said.
    const status = panel.locator('[role="status"]');
    const hpBefore = (await panel.locator('tr[data-row="hp"] td').first().textContent())?.trim();
    // The level is on the class step, the first (backlog F4).
    await t.tap(page.locator(`${root}button[aria-label^="Back to step 1:"]`).locator("visible=true").first());
    const level = page.locator(`${root}section[data-active] button[aria-label="Level"]`).locator("visible=true").first();
    await level.waitFor({ state: "visible", timeout: 15_000 });
    await t.tap(level);
    await t.tap(page.getByRole("menuitemradio", { name: "5", exact: true }).first());
    const said = await eventually(
      async () => {
        const text = (await status.textContent())?.trim() ?? "";
        return text ? text : false;
      },
      { timeoutMs: 8_000, label: "the spoken change" },
    ).catch(() => "");
    const hpAfter = (await panel.locator('tr[data-row="hp"] td').first().textContent())?.trim();
    if (hpAfter === hpBefore) found.push(`hit points stayed ${hpBefore} at level 5`);
    if (!/^Hit points \d+, was \d+\. \d+ more numbers changed\.$/.test(said)) found.push(`said "${said}"`);
    // Time is the check: a second line would follow the burst within this while.
    await sleep(2_000);
    if (((await status.textContent())?.trim() ?? "") !== said) found.push("a second line followed the burst");

    // A new hero has no scores on its first steps: the panel shows the picks
    // so far, the settled numbers and the chosen class's and ancestry's
    // write-ups, where the table will be.
    await t.open("/characters/new");
    const fresh = page.locator(`${root}button`).filter({ hasText: /^Start fresh$/ }).locator("visible=true");
    if (await fresh.count()) await t.tap(fresh.first());
    const cards = page.locator(`${root}section[data-active] .creator-card`).locator("visible=true");
    await eventually(() => cards.count(), { timeoutMs: 30_000, label: "the class cards" });
    await t.tap(page.locator(`${root}section[data-active] .creator-card[aria-label^="Bard"]`).locator("visible=true").first());
    const picks = page.locator(`${root}[data-build-math] [data-picks-so-far]`);
    if (!wide) await t.tap(page.locator(`${root}[data-build-math] button[aria-expanded]`).first());
    await eventually(() => picks.locator('[data-picked="class"]').isVisible(), { timeoutMs: 10_000, label: "the class in the picks" }).catch(() =>
      found.push("the chosen class is not in the panel"),
    );
    const settled = await picks.evaluate((node) => [...node.querySelectorAll("tr[data-row]")].map((row) => row.getAttribute("data-row")));
    for (const row of ["proficiency", "hit-die", "save-proficiencies"]) {
      if (!settled.includes(row)) found.push(`no settled ${row} row before scores`);
    }
    // On to the ancestry step, where the chosen lineage joins the class. The
    // step holds until the class's skills are picked; the step's own
    // suggestion picks them.
    const suggest = page.locator(`${root}section[data-active] button`).filter({ hasText: /^Suggest the rest$/ }).locator("visible=true");
    await eventually(() => suggest.count(), { timeoutMs: 10_000, label: "the skills' Suggest the rest" });
    await t.tap(suggest.first());
    await t.tap(page.locator(`${root}button`).filter({ hasText: /^Continue/ }).locator("visible=true").first());
    const elf = page.locator(`${root}section[data-active] .creator-card[aria-label^="Elf (High)"]`).locator("visible=true");
    await eventually(() => elf.count(), { timeoutMs: 15_000, label: "the lineage cards" });
    await t.tap(elf.first());
    await eventually(() => picks.locator('[data-picked="ancestry"]').isVisible(), { timeoutMs: 10_000, label: "the ancestry in the picks" }).catch(() =>
      found.push("the chosen ancestry is not in the panel"),
    );
    const picked = await picks.evaluate((node) => ({
      rows: [...node.querySelectorAll("tr[data-row]")].map((row) => row.getAttribute("data-row")),
      smallest: Math.min(...[...node.querySelectorAll("tbody th, tbody td")].map((cell) => parseFloat(getComputedStyle(cell).fontSize))),
    }));
    for (const row of ["ancestry-bonuses", "speed"]) {
      if (!picked.rows.includes(row)) found.push(`no settled ${row} row once an ancestry is chosen`);
    }
    if (picked.smallest < 16) found.push(`picks text at ${picked.smallest}px, under 1rem`);
    found.push(
      ...(await axeViolations(page, "[data-build-math]")).map(
        (violation) => `picks: ${violation.id} (${violation.impact}) ${violation.help} at ${violation.nodes.join(", ")}`,
      ),
    );
    await t.shot("picks");

    if (found.length) await t.shot("problems");
    check(found.length === 0, `the build math table:\n  ${found.join("\n  ")}`);
  },
};
