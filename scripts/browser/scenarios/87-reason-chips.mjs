// Issue 460: after a fix to an AI turn the table offers one optional row of
// reason chips. Here the fix is a narration edit (no reload). The strip is
// said by a polite status without taking focus, is reached with Tab, and one
// chip saves the reason on the fix's ledger row (read back from Admin's
// export). A second edit's strip is ignored: the composer still takes
// typing, presses beside the strip pass through it, it leaves by itself and
// the fix stays recorded with no reason. The seed gives each viewport its
// own table of two passages from finished AI turns (Chip Table).
import { createHash } from "node:crypto";
import { check, eventually, sleep } from "../lib.mjs";

const hashed = (id) => createHash("sha256").update(`odm-narrator-quality:${id}`).digest("hex").slice(0, 16);

export default {
  name: "reason-chips",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const table = ids.chipTables[viewport];
    await t.open(`/campaigns/${table.id}`);
    await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });

    const strip = page.locator(`${root}[data-correction-chips]`);
    const status = page.locator(`${root}[data-correction-status]`).first();
    const chipFocused = () => page.evaluate(() => Boolean(document.activeElement?.closest("[data-correction-chips]")));

    // The lead edits a passage: the pencil from sm up, the passage's menu on
    // a phone. Returns the ledger row the edit wrote.
    const edit = async (index, from, to) => {
      const found = page.locator(`${root}.session-dm`).filter({ hasText: from }).locator("visible=true").first();
      await eventually(() => found.count(), { timeoutMs: 30_000, label: `the passage "${from.slice(0, 24)}..."` });
      // Its words go once the editor opens, so it is held by a mark of its own.
      await found.evaluate((element, mark) => element.setAttribute("data-scenario-passage", mark), String(index));
      const passage = page.locator(`${root}[data-scenario-passage="${index}"]`).first();
      await passage.scrollIntoViewIfNeeded();
      if (viewport === "desktop") {
        await passage.hover();
        await t.tap(passage.getByRole("button", { name: "Edit this narration" }));
      } else {
        await t.tap(passage.getByRole("button", { name: "Passage actions" }));
        const row = page.getByRole("menuitem", { name: /^Edit\b/ }).locator("visible=true").first();
        await eventually(() => row.count(), { label: "Edit in the passage's menu" });
        await t.tap(row);
      }
      const box = passage.locator("textarea").first();
      await box.waitFor({ state: "visible", timeout: 15_000 });
      await box.fill(to);
      // Every wait starts before the click.
      const saved = page.waitForResponse(
        (response) => response.url().includes(`/messages/${table.messageIds[index]}/edit`) && response.request().method() === "POST",
        { timeout: 30_000 },
      );
      // A failed press is reported as itself, not as the wait it strands.
      saved.catch(() => {});
      await t.tap(passage.getByRole("button", { name: /^\s*Save\s*$/ }));
      const answer = await saved;
      check(answer.ok(), `the edit answered ${answer.status()}`);
      const corrections = (await answer.json()).corrections ?? [];
      check(corrections.length === 1, `the edit recorded ${corrections.length} fixes, not one`);
      await eventually(async () => (await passage.innerText()).includes(to), { label: "the edited passage" });
      await eventually(() => strip.locator("visible=true").count(), { label: "the reason chips after the fix" });
      return corrections[0];
    };

    // The fix's row as Admin's export carries it.
    const recorded = async (turnId) => {
      const response = await api.get(`${base}/api/admin/narrator-quality?export=1`);
      check(response.ok(), `the export answered ${response.status()}`);
      const file = await response.json();
      const turn = hashed(turnId);
      const fixes = [
        ...(file.turns.find((row) => row.turn === turn)?.corrections ?? []),
        ...file.earlierCorrections.filter((row) => row.turn === turn),
      ];
      check(fixes.length === 1 && fixes[0].kind === "narration_edit", `the turn holds ${fixes.length} fixes (${fixes.map((row) => row.kind).join(", ")})`);
      return fixes[0];
    };

    // ---- a fix, and a reason for it ----
    await edit(0, "names a price twice what the sign says", "The toll keeper squints at the cart and names the price on the sign.");
    check(!(await chipFocused()), "the strip took focus");
    await eventually(async () => /Fix saved/.test((await status.textContent()) ?? ""), { label: "the strip's announcement" });
    check((await status.getAttribute("aria-live")) === "polite", "the strip's status is not a polite live region");
    const group = strip.locator('[role="group"]').first();
    check((await group.getAttribute("aria-label")) === "Why the fix", "the chips' group is not named");
    check((await strip.locator('[aria-modal="true"], [role="dialog"], [role="alertdialog"]').count()) === 0, "the strip is a dialog");
    const labels = await strip.locator("button[data-correction-reason]").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-correction-reason")));
    check(labels.join(",") === "wrong_rule,wrong_number,wrong_target,story,changed_mind", `the chips are ${labels.join(", ")}`);
    await t.shot("chips");

    // Tab from the top of the page reaches the chips.
    await page.evaluate(() => {
      const body = document.body;
      body.setAttribute("tabindex", "-1");
      body.focus();
      body.removeAttribute("tabindex");
    });
    let reached = null;
    for (let press = 0; press < 30 && !reached; press += 1) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => document.activeElement?.closest("[data-correction-reason]")?.getAttribute("data-correction-reason") ?? null);
    }
    check(reached === "wrong_rule", `Tab reached ${reached ?? "no chip"} first, not Wrong rule`);

    const posted = page.waitForResponse((response) => response.url().includes(`/api/campaigns/${table.id}/corrections`) && response.request().method() === "POST", { timeout: 30_000 });
    let picked;
    if (viewport === "desktop") {
      // The keyboard picks it.
      picked = "wrong_rule";
      await page.keyboard.press("Enter");
    } else {
      picked = "wrong_number";
      await t.tap(strip.locator('button[data-correction-reason="wrong_number"]'));
    }
    const reasonAnswer = await posted;
    check(reasonAnswer.ok(), `saving the reason answered ${reasonAnswer.status()}`);
    check((await reasonAnswer.json()).changed === 1, "the reason changed no row");
    await eventually(() => strip.locator("[data-correction-saved]").locator("visible=true").count(), { label: "the strip's thanks" });
    await eventually(async () => (await strip.count()) === 0, { label: "the strip leaving after the thanks" });
    const first = await recorded(table.turnIds[0]);
    check(first.reason === picked, `the fix's reason is ${first.reason}, not ${picked}`);

    // ---- a fix whose strip is ignored ----
    await edit(1, "a dog noses through the gap", "Behind him the gate creaks open a hand's width, and a goat noses through the gap.");
    check(!(await chipFocused()), "the second strip took focus");
    // A press beside the strip lands on the page under it.
    const passesThrough = await strip.first().evaluate((wrapper) => {
      const panel = wrapper.querySelector('[role="group"]').getBoundingClientRect();
      const x = Math.max(2, panel.left - 6);
      const hit = document.elementFromPoint(x, panel.top + panel.height / 2);
      return Boolean(hit) && !wrapper.contains(hit);
    });
    check(passesThrough, "a press beside the strip hits the strip");
    const composer = page.locator(`${root}[data-tour="composer-input"] textarea`).locator("visible=true").first();
    await eventually(() => composer.count(), { label: "the composer" });
    await t.tap(composer);
    await composer.fill("I pay the toll and keep walking.");
    check((await composer.inputValue()) === "I pay the toll and keep walking.", "the composer did not take typing while the strip showed");
    check((await strip.locator("visible=true").count()) === 1, "the strip left when the composer was used");
    await t.shot("ignored");
    // Left alone, it goes by itself (15 seconds) and focus stays put.
    await eventually(async () => (await strip.count()) === 0, { timeoutMs: 25_000, label: "the ignored strip leaving by itself" });
    check(await composer.evaluate((element) => element === document.activeElement), "focus moved off the composer");
    await sleep(300);
    const second = await recorded(table.turnIds[1]);
    check(second.reason === null, `the ignored fix has the reason ${second.reason}`);
    await composer.fill("");
  },
};
