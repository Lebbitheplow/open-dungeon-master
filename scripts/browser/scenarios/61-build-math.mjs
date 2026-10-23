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
    // first step, where the name and the level are.
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
    const level = page.locator(`${root}button[aria-label="Level"]`).locator("visible=true").first();
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
    await sleep(2_000);
    if (((await status.textContent())?.trim() ?? "") !== said) found.push("a second line followed the burst");

    if (found.length) await t.shot("problems");
    check(found.length === 0, `the build math table:\n  ${found.join("\n  ")}`);
  },
};
