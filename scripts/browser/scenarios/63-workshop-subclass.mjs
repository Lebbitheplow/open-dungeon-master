// A subclass of one's own, from the Workshop to a character
// (docs/workshop-creator-import-audit-2026-10-22.md, its closing journey),
// on desktop and phone, on the website and in the app's own screens:
//
//   - made in Homebrew with a feature at its class's subclass level, kept,
//     and the editor then says where it is offered: under Fighter, from
//     level 3, at tables its author runs;
//   - offered in the character builder under From Homebrew for a level 3
//     fighter, and choosing it grants its feature;
//   - renamed in Homebrew, and the builder offers it under its new name;
//   - where a table leaves a player's own subclass out, the builder says so
//     beside the subclass list (the table's answer is mocked, as
//     55-import-owed mocks its; scripts/test-workshop-references.mjs holds
//     the server to it).
import { check, eventually, sleep } from "../lib.mjs";

export default {
  name: "workshop-subclass",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = `${t.viewport}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const subclass = `Bog Knight ${stamp}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Subclass ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const workshopId = (await made.json()).workshop.id;
    let entryId = null;
    try {
      // ---- made and kept in Homebrew ----
      await t.open(`/workshop/${workshopId}?system=homebrew`);
      const kinds = page.locator(`${root}[data-tour="homebrew-kinds"]`).locator("visible=true").first();
      await eventually(() => kinds.isVisible(), { timeoutMs: 30_000, label: "the kinds of homebrew" });
      await t.tap(kinds.getByRole("radio", { name: /^Subclasses/ }));
      const fresh = page.locator(`${root}[data-tour="homebrew-new"]`).locator("visible=true").first();
      await eventually(() => fresh.isVisible(), { timeoutMs: 10_000, label: "New" });
      await t.tap(fresh);
      const editor = page.getByRole("dialog").last();
      await eventually(() => editor.getByRole("button", { name: /Add a feature/ }).isVisible(), { timeoutMs: 20_000, label: "the subclass form" });
      await editor.getByLabel("Name", { exact: true }).fill(subclass);
      await t.tap(editor.getByRole("button", { name: /Add a feature/ }));
      await editor.getByLabel("Feature name").last().fill("Bog Ward");
      await editor.getByLabel("What it does").last().fill("Marsh terrain costs you no extra movement.");
      const keep = editor.locator('[data-tour="homebrew-save"]');
      await t.tap(keep);
      const kept = await eventually(
        async () => {
          const body = await (await api.get(`${base}/api/homebrew?kind=archetype`)).json().catch(() => ({ entries: [] }));
          return (body.entries ?? []).find((entry) => entry.name === subclass) ?? null;
        },
        { timeoutMs: 15_000, label: "the subclass on the shelf" },
      );
      entryId = kept.id;
      check(kept.data.classSlug === "fighter", `the subclass sits under the fighter (${kept.data.classSlug})`);
      const features = Object.values(kept.data.levels ?? {}).flat().map((feature) => feature.n);
      check(features.includes("Bog Ward"), `the feature was kept (${features.join(", ")})`);
      // Once kept, the editor says where it is offered.
      const where = editor.locator('[data-testid="homebrew-availability"]');
      await eventually(() => where.isVisible(), { timeoutMs: 10_000, label: "where it is offered" });
      const said = (await where.textContent()) ?? "";
      check(/under Fighter in the character builder from level 3/.test(said), `the editor names the class and level: ${said}`);
      check(/owner, DM or assistant DM/.test(said), "the editor says whose tables offer it");
      await sleep(900);
      await t.shot("subclass-kept");
      for (let attempt = 0; attempt < 3 && (await page.getByRole("dialog").count()); attempt += 1) {
        await page.keyboard.press("Escape");
        await sleep(300);
      }

      // ---- chosen in the builder at the class's subclass level ----
      await t.open("/characters/new");
      const startFresh = page.locator(`${root}button`).filter({ hasText: /^Start fresh$/ }).locator("visible=true");
      if (await startFresh.count()) await t.tap(startFresh.first());
      const name = page.locator(`${root}input[aria-label="Name"]`).locator("visible=true").first();
      await name.waitFor({ state: "visible", timeout: 30_000 });
      await name.fill(`Marsh Squire ${stamp}`);
      await t.tap(page.getByRole("button", { name: "Level" }).locator("visible=true").first());
      await t.tap(page.getByRole("menuitemradio", { name: "3", exact: true }).locator("visible=true").first());
      // The steps before the class are answered as a player would: a
      // background, then a lineage, each step's own "Fill what's left"
      // taking any pick it still owes.
      const fill = async () => {
        const button = page.locator(`${root}button`).filter({ hasText: /^\s*Fill what's left\s*$/ }).locator("visible=true");
        // The bar leaves with a fade once nothing is owed, so a press that
        // finds it already going is not a failure.
        if (await button.count()) {
          await button.first().click({ timeout: 3_000 }).catch(() => {});
          await sleep(400);
        }
      };
      const next = page.locator(`${root}button`).filter({ hasText: /^Continue/ }).locator("visible=true").first();
      await t.tap(page.locator(`${root}section[data-active] [data-builder-target="background"] button[aria-haspopup="listbox"]`).locator("visible=true").first());
      await t.tap(page.locator(`${root}[role="option"]`).filter({ hasText: "Soldier" }).locator("visible=true").first());
      await sleep(600);
      await t.tap(next);
      const lineages = page.locator(`${root}section[data-active] .creator-card`).locator("visible=true");
      await eventually(() => lineages.count(), { timeoutMs: 20_000, label: "the lineage cards" });
      const search = page.locator(`${root}section[data-active] input[type="search"]`).locator("visible=true").first();
      for (const query of ["tiefling", "half-orc", "human"]) {
        await search.fill(query);
        await sleep(300);
        if ((await lineages.count()) >= 1) break;
      }
      await t.tap(lineages.first());
      await search.fill("");
      await fill();
      await t.tap(next);
      const fighter = page.locator(`${root}section[data-active] .creator-card`).filter({ hasText: /^\s*Fighter/ }).locator("visible=true").first();
      await eventually(() => fighter.count(), { timeoutMs: 20_000, label: "the fighter card" });
      await t.tap(fighter);
      const picker = page.locator(`${root}section[data-active] [data-builder-target="subclass"] button[aria-haspopup="listbox"]`).locator("visible=true").first();
      await eventually(() => picker.count(), { timeoutMs: 15_000, label: "the subclass list" });
      await t.tap(picker);
      const option = page.locator(`${root}[role="option"]`).filter({ hasText: subclass }).locator("visible=true").first();
      await eventually(() => option.count(), { timeoutMs: 15_000, label: "the workshop subclass offered" });
      const listed = (await page.locator(`${root}[role="listbox"]`).locator("visible=true").first().textContent()) ?? "";
      check(/From Homebrew/.test(listed), "the subclass is listed under From Homebrew");
      await t.tap(option);
      const gained = page.locator(`${root}section[data-active]`).getByText("Bog Ward", { exact: true }).first();
      await eventually(() => gained.isVisible(), { timeoutMs: 10_000, label: "the subclass's feature granted at level 3" });
      await sleep(900);
      await t.shot("subclass-chosen");

      // ---- renamed: the builder offers it under its new name ----
      // (The characters that hold it follow the rename; scripts/test-
      // workshop-references.mjs holds the server to that.)
      const renamed = await api.patch(`${base}/api/homebrew/${entryId}`, { data: { name: `Fen Knight ${stamp}` } });
      check(renamed.ok(), "the rename is kept");
      check(typeof (await renamed.json()).carried?.characters === "number", "the rename says what it carried");

      // ---- a table that leaves a player's own subclass out says so ----
      await page.route(/\/api\/content\/archetypes\?/, async (route) => {
        const response = await route.fetch();
        const body = await response.json().catch(() => ({}));
        await route.fulfill({ response, json: { ...body, unadmitted: ["Player Marsh Knight"] } });
      });
      // A class picked again asks for its subclasses again.
      const rogue = page.locator(`${root}section[data-active] .creator-card`).filter({ hasText: /^\s*Rogue/ }).locator("visible=true").first();
      await eventually(() => rogue.count(), { timeoutMs: 15_000, label: "the rogue card" });
      await t.tap(rogue);
      await t.tap(page.locator(`${root}section[data-active] .creator-card`).filter({ hasText: /^\s*Fighter/ }).locator("visible=true").first());
      const renamedPicker = page.locator(`${root}section[data-active] [data-builder-target="subclass"] button[aria-haspopup="listbox"]`).locator("visible=true").first();
      await eventually(() => renamedPicker.count(), { timeoutMs: 15_000, label: "the subclass list again" });
      await t.tap(renamedPicker);
      await eventually(() => page.locator(`${root}[role="option"]`).filter({ hasText: `Fen Knight ${stamp}` }).locator("visible=true").count(), { timeoutMs: 15_000, label: "the subclass offered under its new name" });
      await page.keyboard.press("Escape");
      const note = page.locator(`${root}section[data-active] [data-testid="table-scope-unadmitted"]`).locator("visible=true").first();
      await eventually(() => note.count(), { timeoutMs: 15_000, label: "the left-out note beside the subclass list" });
      check(/Your own Player Marsh Knight is not offered at this table/.test((await note.textContent()) ?? ""), "the note names the subclass and why");
      await sleep(600);
      await t.shot("subclass-left-out");
      await page.unroute(/\/api\/content\/archetypes\?/);
    } finally {
      if (entryId) await api.delete(`${base}/api/homebrew/${entryId}?purge=1`).catch(() => {});
      await api.delete(`${base}/api/workshops/${workshopId}`).catch(() => {});
    }
  },
};
