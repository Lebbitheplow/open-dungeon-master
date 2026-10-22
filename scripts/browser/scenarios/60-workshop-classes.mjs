// Workshop classes (PR #477): a class of the table's own is made in the
// workshop's Homebrew, on desktop and phone, on the website and in the app's
// own screens. A new class opens on its defaults (a d8, two saves, the
// subclass level, casting as one control), is kept under a name, comes back
// from the shelf with what was kept, and lists as a class.
import { check, eventually, sleep } from "../lib.mjs";

export default {
  name: "workshop-classes",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Classes ${Date.now().toString(36)}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    const name = `Grove Warden ${t.viewport}${t.app ? " app" : ""}`;
    let entryId = null;
    try {
      await t.open(`/workshop/${id}?system=homebrew`);
      const kinds = page.locator(`${root}[data-tour="homebrew-kinds"]`).locator("visible=true").first();
      await eventually(() => kinds.isVisible(), { timeoutMs: 30_000, label: "the kinds of homebrew" });
      await t.tap(kinds.getByRole("radio", { name: /^Classes/ }));
      const fresh = page.locator(`${root}[data-tour="homebrew-new"]`).locator("visible=true").first();
      await eventually(() => fresh.isVisible(), { timeoutMs: 10_000, label: "New" });
      await t.tap(fresh);

      const editor = page.getByRole("dialog").last();
      // The class form loads when a class is opened (its own chunk).
      await eventually(() => editor.getByText("Hit die", { exact: true }).isVisible(), { timeoutMs: 20_000, label: "the class form" });
      for (const field of ["Picks its subclass at level", "Saving throws", "Skills", "Armor training", "Weapon training", "Spellcasting", "Features by level"]) {
        check(await editor.getByText(field, { exact: true }).first().isVisible(), `the class form shows ${field}`);
      }
      await editor.getByLabel("Name", { exact: true }).fill(name);
      await sleep(900);
      await t.shot("class-editor");
      const keep = editor.locator('[data-tour="homebrew-save"]');
      check(await keep.isEnabled(), "Keep it is enabled for a named class on its defaults");
      await t.tap(keep);

      // Kept on the shelf as a class, with its defaults.
      const kept = await eventually(
        async () => {
          const response = await api.get(`${base}/api/homebrew?kind=class`);
          const body = response.ok() ? await response.json() : { entries: [] };
          return (body.entries ?? []).find((entry) => entry.name === name) ?? null;
        },
        { timeoutMs: 15_000, label: "the class on the shelf" },
      );
      entryId = kept.id;
      check(Number(kept.data.hitDie) === 8, `a new class keeps the d8 default (${kept.data.hitDie})`);
      check(Array.isArray(kept.data.saves) && kept.data.saves.length === 2, "a new class keeps two saving throws");

      // The sheet stays on the class it kept, now saved rather than new.
      await eventually(async () => ((await keep.textContent()) ?? "").trim() === "Save", { timeoutMs: 10_000, label: "the editor on the kept class" });
      // Listed under Classes once the sheet closes, and opened again with
      // what was kept.
      for (let attempt = 0; attempt < 3 && (await page.getByRole("dialog").count()); attempt += 1) {
        await page.keyboard.press("Escape");
        await sleep(300);
      }
      await eventually(() => page.getByRole("dialog").count().then((count) => count === 0), { timeoutMs: 10_000, label: "the editor closing" });
      const row = page.locator(`${root}ul button`, { hasText: name }).first();
      await eventually(() => row.isVisible(), { timeoutMs: 10_000, label: "the class in the list" });
      await t.shot("class-kept");
      await t.tap(row);
      const again = page.getByRole("dialog").last();
      await eventually(() => again.getByText("Hit die", { exact: true }).isVisible(), { timeoutMs: 20_000, label: "the class form again" });
      check((await again.getByLabel("Name", { exact: true }).inputValue()) === name, "the kept class opens under its name");
    } finally {
      if (entryId) await api.delete(`${base}/api/homebrew/${entryId}?purge=1`).catch(() => {});
      await api.delete(`${base}/api/workshops/${id}`).catch(() => {});
    }
  },
};
