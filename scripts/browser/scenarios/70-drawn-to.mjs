// Issue 501: "Drawn to", beside Gender in the builder's Identity step and in
// the NPC editor's "On the surface": three chips (Women, Men, Nonbinary
// people) and a short note. A labelled group, each chip a pressed-or-not
// button at a finger's size that works by keyboard, legible by night and by
// day, and clean under axe.
import { axeViolations, check, eventually, sleep } from "../lib.mjs";

async function checkPicker(t, where) {
  const { page, root } = t;
  const picker = page.locator(`${root}[data-attraction-picker]`).locator("visible=true").first();
  await eventually(() => picker.count(), { timeoutMs: 30_000, label: `Drawn to in ${where}` });
  check((await picker.getAttribute("role")) === "group", "a group");
  const women = picker.getByRole("button", { name: /^women$/i });
  const men = picker.getByRole("button", { name: /^men$/i });
  check(await picker.getByRole("button", { name: /^nonbinary people$/i }).count(), "all three chips");
  // The kit's own control height: 40px under a finger, as compact on a desk
  // as the selects beside it.
  for (const chip of [women, men]) {
    const box = await chip.boundingBox();
    check(box && box.height >= (t.touch ? 40 : 36), `a finger-sized chip (${box?.height})`);
  }
  await picker.scrollIntoViewIfNeeded();
  await t.tap(women);
  await eventually(async () => (await women.getAttribute("aria-pressed")) === "true", { label: "Women picked" });
  // By keyboard: Tab to the next chip, Space picks it.
  await women.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await eventually(async () => (await men.getAttribute("aria-pressed")) === "true", { label: "Men picked by keyboard" });
  const note = picker.getByRole("textbox", { name: /drawn to: a note/i });
  await note.fill("only the ones who make them laugh");
  const found = await axeViolations(page, `${root}[data-attraction-picker]`);
  check(!found.length, `axe on Drawn to in ${where}: ${found.map((entry) => `${entry.id}: ${entry.help}`).join("; ").slice(0, 600)}`);
  return picker;
}

export default {
  name: "drawn-to",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, api, base } = t;
    await t.open("/characters/new");
    const picker = await checkPicker(t, "the builder");
    await picker.screenshot({ path: t.shotPath("builder"), animations: "disabled" }).catch(() => {});
    await t.shot("builder-page");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await sleep(300);
    const dayFound = await axeViolations(page, "[data-attraction-picker]");
    check(!dayFound.length, `axe on Drawn to by day: ${dayFound.map((entry) => entry.id).join(", ")}`);
    await picker.screenshot({ path: t.shotPath("builder-day"), animations: "disabled" }).catch(() => {});
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

    const made = await api.post(`${base}/api/workshops`, { data: { title: `Cast ${Date.now().toString(36)}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    try {
      await t.open(`/workshop/${id}?system=cast`);
      const someone = page.locator('[data-tour="cast-new"]').locator("visible=true").first();
      await eventually(() => someone.count(), { timeoutMs: 30_000, label: "Someone new in the cast" });
      await t.tap(someone);
      const editor = await checkPicker(t, "the NPC editor");
      await editor.screenshot({ path: t.shotPath("npc-editor"), animations: "disabled" }).catch(() => {});
      await t.shot("npc-editor-page");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await sleep(300);
      await editor.screenshot({ path: t.shotPath("npc-editor-day"), animations: "disabled" }).catch(() => {});
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    } finally {
      await api.delete(`${base}/api/workshops/${id}`).catch(() => {});
    }
  },
};
