// What the Workshop audit's WA-01, WA-02 and WA-06 fixed, seen on the page
// (the Workshop audit of 2026-10-26), on desktop and phone:
//
//   - WA-06: a species' traits are read paragraph by paragraph, whatever
//     bold each heading uses, and the editor lists the traits the table
//     reads. Mixing an inserted "**_Draconic Ancestry._**" with a typed
//     "**Breath Weapon.**" lost the second.
//   - WA-02: a list says where it stops while it is filled. A background
//     keeps six skills; the seventh chip is off, and a line says why, where
//     a save used to drop the extra without a word.
//   - WA-01: a species offering two cantrips gets two pickers' worth in the
//     builder, both kept, where the builder held one. On a phone the
//     builder's "Continue as" that species stays inside its button.
import { check, eventually, untilStill } from "../lib.mjs";

const visible = (page, root, text) => page.locator(`${root}button`).filter({ hasText: text }).locator("visible=true");

export default {
  name: "homebrew-fidelity",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = `${t.viewport}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Fidelity ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const workshopId = (await made.json()).workshop.id;
    const species = `Emberkin ${stamp}`;
    let speciesId = null;
    const editorFor = async (kind) => {
      const kinds = page.locator(`${root}[data-tour="homebrew-kinds"]`).locator("visible=true").first();
      await eventually(() => kinds.isVisible(), { timeoutMs: 30_000, label: "the kinds of homebrew" });
      await t.tap(kinds.getByRole("radio", { name: new RegExp(`^${kind}`) }));
      await t.tap(page.locator(`${root}[data-tour="homebrew-new"]`).locator("visible=true").first());
      const editor = page.getByRole("dialog").last();
      await eventually(() => editor.locator('[data-tour="homebrew-save"]').isVisible(), { timeoutMs: 20_000, label: `the ${kind} form` });
      return editor;
    };
    const closeEditor = async () => {
      for (let attempt = 0; attempt < 3 && (await page.getByRole("dialog").count()); attempt += 1) {
        await page.keyboard.press("Escape");
        const discard = page.getByRole("button", { name: /^(Discard|Throw it away|Leave)/ });
        if (await discard.count()) await t.tap(discard.first());
        await eventually(async () => (await page.getByRole("dialog").count()) === 0, { timeoutMs: 3_000 }).catch(() => {});
      }
    };
    try {
      await t.open(`/workshop/${workshopId}?system=homebrew`);

      // ---- WA-06: the traits the table reads ----
      const speciesEditor = await editorFor("Species");
      await speciesEditor.getByRole("textbox", { name: /^Traits/ }).first().fill(
        "**_Draconic Ancestry._** You choose a dragon.\n\n**Breath Weapon.** You exhale destructive energy.",
      );
      const read = speciesEditor.locator("[data-species-traits]");
      await eventually(async () => /Draconic Ancestry, Breath Weapon/.test((await read.textContent()) ?? ""), {
        timeoutMs: 10_000,
        label: "both traits read, whichever bold each uses",
      });
      await read.scrollIntoViewIfNeeded();
      await t.shot("species-traits");
      await closeEditor();

      // ---- WA-02: a background's sixth skill is its last ----
      const backgroundEditor = await editorFor("Backgrounds");
      const chips = backgroundEditor.locator("button[aria-pressed]").filter({ hasText: /^(acrobatics|animal handling|arcana|athletics|deception|history|insight)$/i });
      await eventually(async () => (await chips.count()) >= 7, { timeoutMs: 10_000, label: "the skill chips" });
      for (let index = 0; index < 6; index += 1) await t.tap(chips.nth(index));
      await eventually(async () => (await chips.nth(6).isDisabled()), { timeoutMs: 5_000, label: "the seventh skill off once six are picked" });
      const full = backgroundEditor.getByText(/^6 of 6 picked, the most it keeps/);
      await eventually(() => full.isVisible(), { timeoutMs: 5_000, label: "a line says the background keeps six skills" });
      await untilStill(page);
      await t.shot("background-skills");
      await closeEditor();

      // ---- WA-01: a species offering two cantrips, both picked ----
      const saved = await api.post(`${base}/api/homebrew`, {
        data: {
          kind: "race",
          name: species,
          data: {
            asi: [{ attributes: ["Intelligence"], value: 2 }, { attributes: ["Dexterity"], value: 1 }],
            speed: { walk: 30 },
            size: "Medium",
            languages: ["Common"],
            traits: "**_Kindling._** Two small spells come to you as easily as breath.",
            cantripChoice: { list: "wizard", count: 2 },
          },
        },
      });
      check(saved.status() === 201, `the species kept (${saved.status()})`);
      speciesId = (await saved.json()).entry.id;

      await t.open("/characters/new");
      const startFresh = visible(page, root, /^Start fresh$/);
      if (await startFresh.count()) await t.tap(startFresh.first());
      const barbarian = page.locator(`${root}section[data-active] .creator-card[aria-label^="Barbarian"]`).locator("visible=true").first();
      await barbarian.waitFor({ state: "visible", timeout: 30_000 });
      await t.tap(barbarian);
      await t.tap(page.locator(`${root}section[data-active] [data-suggest-skills]`).locator("visible=true").first());
      await t.tap(visible(page, root, /^Continue/).first());
      // Seventy lineages and more: found by its name, as a player would.
      const search = page.locator(`${root}section[data-active]`).getByPlaceholder(/^Search \d+ lineages/).locator("visible=true").first();
      await eventually(() => search.count(), { timeoutMs: 20_000, label: "the lineage search" });
      await search.fill(species);
      const card = page.locator(`${root}section[data-active] .creator-card[aria-label^="${species}"]`).locator("visible=true").first();
      await eventually(() => card.count(), { timeoutMs: 20_000, label: "the homebrew species on the Ancestry step" });
      await card.scrollIntoViewIfNeeded();
      await t.tap(card);
      const section = page.locator(`${root}section[data-active] [data-builder-target="racialCantrip"]`).locator("visible=true").first();
      await eventually(() => section.count(), { timeoutMs: 15_000, label: "the racial cantrip picker" });
      await eventually(async () => /0 of 2 picked/.test((await section.textContent()) ?? ""), { timeoutMs: 15_000, label: "the picker counting none of two" });
      // The cantrips come from the content pack, which a server without one
      // (CI's browser jobs) does not list; the picks are checked where it is.
      const catalog = await api.get(`${base}/api/content/spells?class=wizard&level=0`);
      const packInstalled = catalog.ok() && (await catalog.json()).packInstalled === true;
      if (packInstalled) {
        const offered = section.locator('button[aria-pressed="false"]');
        await eventually(async () => (await offered.count()) >= 2, { timeoutMs: 20_000, label: "the wizard cantrips listed" });
        await t.tap(offered.first());
        await eventually(async () => /1 of 2 picked/.test((await section.textContent()) ?? ""), { timeoutMs: 10_000, label: "one of two picked" });
        await t.tap(section.locator('button[aria-pressed="false"]').first());
        await eventually(async () => /2 of 2 picked/.test((await section.textContent()) ?? ""), { timeoutMs: 10_000, label: "two of two picked" });
        const removes = section.getByRole("button", { name: /^Remove / });
        check((await removes.count()) === 2, `two picks, each with its remove (${await removes.count()})`);
        check((await section.locator('button[aria-pressed="false"]').count()) === 0, "the list closes once both are picked");
      }
      await untilStill(page);
      // "Continue as" a long species name stays inside its button, and the
      // reason it is held keeps a readable width (found running this).
      const go = page.locator(`${root}button.wizard-continue`).locator("visible=true").first();
      const inside = await go.evaluate((button) => {
        const box = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        // On a phone a label too long for the button ends in an ellipsis.
        const cut = window.innerWidth >= 640 || (style.textOverflow === "ellipsis" && style.overflow === "hidden");
        return box.right <= window.innerWidth + 1 && cut;
      });
      check(inside, "the Continue label stays inside its button");
      if (t.viewport === "phone" && (await page.locator(`${root}footer button`).filter({ hasText: /^Back$/ }).locator("visible=true").count())) {
        const back = page.locator(`${root}footer button`).filter({ hasText: /^Back$/ }).locator("visible=true").first();
        const [b, c] = [await back.boundingBox(), await go.boundingBox()];
        check(b && c && Math.abs(b.y - c.y) < 8, "Back and Continue share a row");
      }
      const reason = page.locator(`${root}.wizard-blocker`).locator("visible=true").first();
      if (await reason.count()) check((await reason.evaluate((node) => node.offsetWidth)) >= 160, "the held reason keeps a readable width");
      await t.shot("two-cantrips");
    } finally {
      await closeEditor().catch(() => {});
      if (speciesId) await api.delete(`${base}/api/homebrew/${speciesId}?purge=1`).catch(() => {});
      await api.delete(`${base}/api/workshops/${workshopId}`).catch(() => {});
    }
  },
};
