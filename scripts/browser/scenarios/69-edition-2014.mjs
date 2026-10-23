// Issue #502, one ruleset. A wizard saved as the 2024 Goliath with the
// 2024-only Elementalism: her sheet says the cantrip is not cast here, and
// her builder says she now has the 2014 Goliath's traits. An Orc's Primal
// Intuition offers only its seven skills. An apothecary's shelf names how
// magic is priced, and the term opens on the 2014 values.
import { check, eventually } from "../lib.mjs";

const PRIMAL_INTUITION = ["Animal Handling", "Insight", "Intimidation", "Medicine", "Nature", "Perception", "Survival"];

export default {
  name: "edition-2014",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const visible = (selector) => page.locator(`${root}${selector}`).locator("visible=true");

    const editBuild = async (id) => {
      await t.open(`/characters/${id}`);
      return {
        async open() {
          await t.tap(await eventually(async () => {
            const edit = visible("a, button").filter({ hasText: /^\s*Edit build\s*$/ });
            return (await edit.count()) ? edit.first() : null;
          }, { label: "the Edit build button" }));
          await visible("[data-finish-summary]").first().waitFor({ state: "visible", timeout: 30_000 });
          const diamond = visible('button[aria-label$=": Ancestry"]').first();
          await eventually(() => diamond.count(), { label: "the Ancestry step's diamond" });
          await t.tap(diamond);
          const current = visible('button[aria-current="step"]').first();
          await eventually(async () => (await current.getAttribute("aria-label"))?.endsWith(": Ancestry"), { label: "on the Ancestry step" });
        },
      };
    };

    // The sheet: Elementalism is listed, and said to be from the 2024 rules.
    const ysolde = await editBuild(ids.revised);
    const spellNote = visible('[role="note"]').filter({ hasText: "Elementalism is from the 2024 rules" });
    await eventually(() => spellNote.count(), { timeoutMs: 30_000, label: "the sheet's note on Elementalism" });
    check(/pick a 2014 cantrip in its place/.test((await spellNote.first().textContent()) ?? ""), "the note asks for a 2014 cantrip");
    await spellNote.first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);
    await t.shot("sheet-spell-note");

    // The builder: the 2024 Goliath is read as the 2014 one, and says so.
    await ysolde.open();
    const speciesNote = visible('[role="note"]').filter({ hasText: "made with the 2024 rules" });
    await eventually(() => speciesNote.count(), { label: "the builder's note on the 2024 Goliath" });
    const said = (await speciesNote.first().textContent()) ?? "";
    check(/Goliath/.test(said) && /2014 Goliath/.test(said), "the note names the Goliath and its 2014 traits");
    check(/ability scores stay as they were/.test(said), "and says the scores stay");
    await speciesNote.first().scrollIntoViewIfNeeded();
    await t.shot("builder-species-note");

    // The Orc's skill picks: only Primal Intuition's seven.
    const grask = await editBuild(ids.orc);
    await grask.open();
    const picks = visible('[data-builder-target="racialSkills"]').first();
    await eventually(() => picks.count(), { label: "the Orc's skill picks" });
    await picks.scrollIntoViewIfNeeded();
    // His stored picks come back as they were, none of them dropped.
    const held = await Promise.all([1, 2].map(async (n) => ((await picks.getByRole("button", { name: `Skill proficiency ${n}` }).textContent()) ?? "").trim()));
    check(held.includes("Survival") && held.includes("Medicine"), `the stored picks are kept (${held.join(", ")})`);
    check((await page.getByText(/Stored picks are no longer on offer/).count()) === 0, "no stored pick was dropped");
    const first = picks.getByRole("button", { name: "Skill proficiency 1" });
    await t.tap(first);
    const options = page.locator('[role="menuitemradio"]').locator("visible=true");
    await eventually(async () => (await options.count()) > 1, { label: "the skill list open" });
    const labels = (await options.allTextContents()).map((text) => text.trim()).filter((text) => text && text !== "Choose a skill...");
    check(labels.length > 0, "the list offers skills");
    const outside = labels.filter((label) => !PRIMAL_INTUITION.includes(label));
    check(outside.length === 0, `every offered skill is one of Primal Intuition's seven (also offered: ${outside.join(", ")})`);
    await t.shot("orc-skill-list");
    await page.keyboard.press("Escape");

    // The apothecary's shelf: How magic is priced, on the 2014 values.
    await t.open(`/campaigns/${ids.curioTableId}`);
    const line = visible(".session-sysline").filter({ hasText: `${ids.curioShop} is open.` });
    await eventually(() => line.count(), { timeoutMs: 30_000, label: "the apothecary's line in the chat" });
    await t.tap(line.first().getByRole("button", { name: "Browse wares" }));
    const shop = visible("[data-shop-id][data-spotlight]");
    await eventually(() => shop.count(), { timeoutMs: 30_000, label: "the Market on the apothecary" });
    const term = shop.first().getByRole("button", { name: /How magic is priced/ });
    await eventually(() => term.count(), { label: "How magic is priced on the shelf" });
    const box = await term.first().boundingBox();
    check(box !== null && (t.viewport !== "phone" || box.height >= 40), `the term is a finger-sized target on a phone (${box?.height}px)`);
    await t.tap(term.first());
    const explained = page.locator("[role=dialog], [role=tooltip], [data-radix-popper-content-wrapper]").filter({ hasText: "uncommon 500 gp" }).locator("visible=true");
    await eventually(() => explained.count(), { label: "the term's explanation" });
    check(/Legendary items and artifacts are never for sale/.test((await explained.first().textContent()) ?? ""), "it says legendary items are never for sale");
    await page.waitForTimeout(900);
    await t.shot("magic-prices");
    await page.keyboard.press("Escape");

    // The workshop's species form: a pick of skills can name the ones it
    // picks among, as the Orc's does, shown only once there is a pick.
    const { base, api } = t;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Species ${Date.now().toString(36)}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const workshopId = (await made.json()).workshop.id;
    await t.open(`/workshop/${workshopId}?system=homebrew`);
    const kinds = visible('[data-tour="homebrew-kinds"]').first();
    await eventually(() => kinds.isVisible(), { timeoutMs: 30_000, label: "the kinds of homebrew" });
    await t.tap(kinds.getByRole("radio", { name: /^Species/ }));
    const fresh = visible('[data-tour="homebrew-new"]').first();
    await eventually(() => fresh.isVisible(), { timeoutMs: 10_000, label: "New" });
    await t.tap(fresh);
    const editor = page.getByRole("dialog").last();
    const trains = editor.getByRole("button", { name: /What it trains/ });
    await eventually(() => trains.count(), { timeoutMs: 20_000, label: "the species form's training group" });
    if ((await trains.first().getAttribute("aria-expanded")) !== "true") await t.tap(trains.first());
    const pickedFrom = editor.getByText("Picked from (none ticked: any skill)");
    check((await pickedFrom.count()) === 0, "no skill list before there is a pick");
    const raise = editor.getByRole("button", { name: "Raise Skills of the player's choice" });
    await t.tap(raise);
    await t.tap(raise);
    await eventually(() => pickedFrom.isVisible(), { label: "the skill list once there is a pick" });
    const insight = pickedFrom.locator("xpath=..").getByRole("button", { name: "insight" });
    await t.tap(insight);
    await eventually(async () => (await insight.getAttribute("aria-pressed")) === "true", { label: "insight ticked" });
    await pickedFrom.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await t.shot("species-skill-list");
  },
};
